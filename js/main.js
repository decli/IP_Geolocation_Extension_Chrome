let latestGeoLocation = null;
let latestGeoLocation6 = null;
const lp = new LocalStorageProvider();
const supportedFlagCountries = new Set(['AD', 'BA', 'BY', 'CV', 'ET', 'GN', 'IM', 'KR', 'MD', 'MW', 'PA', 'RU', 'ST', 'TT', 'WS', 'AE', 'BB', 'BZ', 'CW', 'EU', 'GQ', 'IN', 'KW', 'ME', 'MX', 'PE', 'RW', 'SV', 'TV', 'YE', 'AF', 'BD', 'CA', 'CX', 'FI', 'GR', 'IQ', 'KY', 'MF', 'MY', 'PF', 'SA', 'SX', 'TW', 'YT', 'AG', 'BE', 'CC', 'CY', 'FJ', 'GS', 'IR', 'KZ', 'MG', 'MZ', 'PG', 'SB', 'SY', 'TZ', 'ZA', 'AI', 'BF', 'CD', 'CZ', 'FK', 'GT', 'IS', 'LA', 'MH', 'NA', 'PH', 'SC', 'SZ', 'UA', 'ZM', 'AL', 'BG', 'CF', 'DE', 'FM', 'GU', 'IT', 'LB', 'MK', 'NC', 'PK', 'SD', 'TC', 'UG', 'ZW', 'AM', 'BH', 'CG', 'DJ', 'FO', 'GW', 'JE', 'LC', 'ML', 'NE', 'PL', 'SE', 'TD', 'US', 'AN', 'BI', 'CH', 'DK', 'FR', 'GY', 'JM', 'LI', 'MM', 'NF', 'PN', 'SG', 'TF', 'UY', 'AO', 'BJ', 'CI', 'DM', 'GA', 'HK', 'JO', 'LK', 'MN', 'NG', 'PR', 'SH', 'TG', 'UZ', 'AQ', 'BL', 'CK', 'DO', 'GB', 'HN', 'JP', 'LR', 'MO', 'NI', 'PS', 'SI', 'TH', 'VA', 'AR', 'BM', 'CL', 'DZ', 'GD', 'HR', 'KE', 'LS', 'MP', 'NL', 'PT', 'SK', 'TJ', 'VC', 'AS', 'BN', 'CM', 'EC', 'GE', 'HT', 'KG', 'LT', 'MQ', 'NO', 'PW', 'SL', 'TK', 'VE', 'AT', 'BO', 'CN', 'EE', 'GG', 'HU', 'KH', 'LU', 'MR', 'NP', 'PY', 'SM', 'TL', 'VG', 'AU', 'BR', 'CO', 'EG', 'GH', 'IC', 'KI', 'LV', 'MS', 'NR', 'QA', 'SN', 'TM', 'VI', 'AW', 'BS', 'CR', 'EH', 'GI', 'ID', 'KM', 'LY', 'MT', 'NU', 'RE', 'SO', 'TN', 'VN', 'AX', 'BT', 'CT', 'ER', 'GL', 'IE', 'KN', 'MA', 'MU', 'NZ', 'RO', 'SR', 'TO', 'VU', 'AZ', 'BW', 'CU', 'ES', 'GM', 'IL', 'KP', 'MC', 'MV', 'OM', 'RS', 'SS', 'TR', 'WF']);
const CHECK_INTERVAL_MS = 3550;
const REQUEST_TIMEOUT_MS = 7000;
const CHECK_ALARM = 'checkIntervalAlarm';
const CHECK_ALARM_MINUTES = 1;
const BADGE_COLOR = '#000000';

let refreshInFlight = null;
let intervalId = null;

async function getSetting(key, defaultValue) {
    return await lp.isSet(key) ? await lp.get(key) : defaultValue;
}

async function renderBadge(countryCode) {
    const normalizedCode = typeof countryCode === 'string' ? countryCode.toUpperCase() : 'ERR';
    const showText = await getSetting(KEY_SETTINGS_SHOW_TEXT, true);
    const showFlags = await getSetting(KEY_SETTINGS_SHOW_FLAGS, true);
    const iconPath = showFlags && supportedFlagCountries.has(normalizedCode)
        ? `img/flags/48/${normalizedCode}.png`
        : 'img/icon48.png';

    await Promise.all([
        chrome.action.setBadgeText({ text: showText ? normalizedCode : '' }),
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }),
        chrome.action.setIcon({ path: iconPath })
    ]);

    if (typeof chrome.action.setBadgeTextColor === 'function') {
        await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
}

async function checkForLocationChange(geoLocation, ipv6) {
    const previous = ipv6 ? latestGeoLocation6 : latestGeoLocation;
    if (ipv6) {
        latestGeoLocation6 = geoLocation;
    } else {
        latestGeoLocation = geoLocation;
    }

    if (!previous) return;

    const previousIp = previous.get('geoLocation').ipAddress;
    const currentIp = geoLocation.get('geoLocation').ipAddress;
    if (!previousIp || !currentIp || previousIp === currentIp) return;

    const notificationsEnabled = await getSetting(KEY_SETTINGS_NOTIFICATION, true);
    const ipv6NotificationsEnabled = await getSetting(KEY_SETTINGS_NOTIFICATION_IPv6, false);
    if ((!ipv6 && notificationsEnabled) || (ipv6 && ipv6NotificationsEnabled)) {
        const message = `From ${previousIp} to ${currentIp}.`;
        await chrome.notifications.create(`geoLocationAlert${Math.random()}`, {
            type: 'basic',
            iconUrl: 'img/icon128.png',
            title: 'IP Address & Geolocation',
            message: message,
            contextMessage: `IPv${ipv6 ? 6 : 4} changed`
        });
    }
}

async function performRefresh() {
    const badgeIndicator = await getSetting(KEY_SETTINGS_COUNTRY_BADGE, 'auto');
    const [ipv4Result, ipv6Result] = await Promise.allSettled([
        new GeoLocation().fetch({ timeout: REQUEST_TIMEOUT_MS }),
        new GeoLocation6().fetch({ timeout: REQUEST_TIMEOUT_MS })
    ]);
    const ipv4 = fulfilledLocation(ipv4Result);
    const ipv6 = fulfilledLocation(ipv6Result);

    const completed = [];
    if (ipv4) completed.push(checkForLocationChange(ipv4, false));
    if (ipv6) completed.push(checkForLocationChange(ipv6, true));
    await Promise.all(completed);

    // Exactly one badge commit is allowed per completed refresh. This removes
    // the old shared ipv4Error race without changing the ERR semantics.
    const selected = selectBadgeLocation(badgeIndicator, ipv4, ipv6);
    if (selected) {
        const countryCode = selected.geoLocation.get('geoLocation').countryCode;
        if (/^[A-Z]{2}$/.test(countryCode || '')) {
            await renderBadge(countryCode);
            return { ok: true, family: selected.family };
        }
    }

    await renderBadge('ERR');
    return {
        ok: false,
        ipv4Error: ipv4Result.status === 'rejected' ? String(ipv4Result.reason) : null,
        ipv6Error: ipv6Result.status === 'rejected' ? String(ipv6Result.reason) : null
    };
}

function fetchGeoLocation() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = performRefresh().finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

function startInterval() {
    if (!intervalId) {
        intervalId = setInterval(() => void fetchGeoLocation(), CHECK_INTERVAL_MS);
    }
}

function stopInterval() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

async function ensureAlarm() {
    const alarm = await chrome.alarms.get(CHECK_ALARM);
    if (!alarm) {
        await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_ALARM_MINUTES });
    }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.method === 'refresh') {
        fetchGeoLocation()
            .then((result) => sendResponse({ data: result }))
            .catch((error) => sendResponse({ error: String(error) }));
        return true;
    }
    return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM) {
        void fetchGeoLocation();
    }
});

chrome.runtime.onInstalled.addListener(() => {
    void ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    void ensureAlarm();
});

chrome.runtime.onSuspend.addListener(stopInterval);

async function initialize() {
    await renderBadge('...');
    await ensureAlarm();
    startInterval();
    await fetchGeoLocation();
}

void initialize().catch(() => void renderBadge('ERR'));
