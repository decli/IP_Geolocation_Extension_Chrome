const lp = new LocalStorageProvider();
const supportedFlagCountries = new Set(['AD', 'BA', 'BY', 'CV', 'ET', 'GN', 'IM', 'KR', 'MD', 'MW', 'PA', 'RU', 'ST', 'TT', 'WS', 'AE', 'BB', 'BZ', 'CW', 'EU', 'GQ', 'IN', 'KW', 'ME', 'MX', 'PE', 'RW', 'SV', 'TV', 'YE', 'AF', 'BD', 'CA', 'CX', 'FI', 'GR', 'IQ', 'KY', 'MF', 'MY', 'PF', 'SA', 'SX', 'TW', 'YT', 'AG', 'BE', 'CC', 'CY', 'FJ', 'GS', 'IR', 'KZ', 'MG', 'MZ', 'PG', 'SB', 'SY', 'TZ', 'ZA', 'AI', 'BF', 'CD', 'CZ', 'FK', 'GT', 'IS', 'LA', 'MH', 'NA', 'PH', 'SC', 'SZ', 'UA', 'ZM', 'AL', 'BG', 'CF', 'DE', 'FM', 'GU', 'IT', 'LB', 'MK', 'NC', 'PK', 'SD', 'TC', 'UG', 'ZW', 'AM', 'BH', 'CG', 'DJ', 'FO', 'GW', 'JE', 'LC', 'ML', 'NE', 'PL', 'SE', 'TD', 'US', 'AN', 'BI', 'CH', 'DK', 'FR', 'GY', 'JM', 'LI', 'MM', 'NF', 'PN', 'SG', 'TF', 'UY', 'AO', 'BJ', 'CI', 'DM', 'GA', 'HK', 'JO', 'LK', 'MN', 'NG', 'PR', 'SH', 'TG', 'UZ', 'AQ', 'BL', 'CK', 'DO', 'GB', 'HN', 'JP', 'LR', 'MO', 'NI', 'PS', 'SI', 'TH', 'VA', 'AR', 'BM', 'CL', 'DZ', 'GD', 'HR', 'KE', 'LS', 'MP', 'NL', 'PT', 'SK', 'TJ', 'VC', 'AS', 'BN', 'CM', 'EC', 'GE', 'HT', 'KG', 'LT', 'MQ', 'NO', 'PW', 'SL', 'TK', 'VE', 'AT', 'BO', 'CN', 'EE', 'GG', 'HU', 'KH', 'LU', 'MR', 'NP', 'PY', 'SM', 'TL', 'VG', 'AU', 'BR', 'CO', 'EG', 'GH', 'IC', 'KI', 'LV', 'MS', 'NR', 'QA', 'SN', 'TM', 'VI', 'AW', 'BS', 'CR', 'EH', 'GI', 'ID', 'KM', 'LY', 'MT', 'NU', 'RE', 'SO', 'TN', 'VN', 'AX', 'BT', 'CT', 'ER', 'GL', 'IE', 'KN', 'MA', 'MU', 'NZ', 'RO', 'SR', 'TO', 'VU', 'AZ', 'BW', 'CU', 'ES', 'GM', 'IL', 'KP', 'MC', 'MV', 'OM', 'RS', 'SS', 'TR', 'WF']);

const CHECK_INTERVAL_MS = 3550;
const REQUEST_TIMEOUT_MS = 12000;
const CHECK_ALARM = 'checkIntervalAlarm';
const CHECK_ALARM_MINUTES = 1;
const BADGE_COLOR = '#000000';
const PENDING_BADGE_TEXT = '...';
const ERROR_BADGE_TEXT = 'ERR';

let refreshInFlight = null;
let intervalId = null;
let runtimeStatePromise = null;
let lastRefreshStartedAt = 0;

function reportBackgroundFailure(error) {
    console.error('[IP Geolocation] Background operation failed:', error);
}

function addEventListenerIfAvailable(event, listener) {
    if (event && typeof event.addListener === 'function') {
        event.addListener(listener);
    }
}

async function getSetting(key, defaultValue) {
    return await lp.isSet(key) ? await lp.get(key) : defaultValue;
}

function getRuntimeState() {
    if (!runtimeStatePromise) {
        runtimeStatePromise = readRuntimeState().then((state) => {
            lastRefreshStartedAt = Math.max(lastRefreshStartedAt, Number(state.lastRefreshAt) || 0);
            return state;
        });
    }
    return runtimeStatePromise;
}

function describeReading(reading) {
    if (!reading) return 'IP Address & Geolocation';

    const location = [reading.countryName, reading.countryCode].filter(Boolean).join(' ');
    const parts = [`IPv${reading.family} ${reading.ipAddress}`.trim(), location].filter(Boolean);
    if (reading.source === ADDRESS_SOURCE_FALLBACK) {
        // The mainland service answered, so this is the address of the direct
        // connection. Saying so beats presenting it as the proxied exit
        // address that the badge normally shows.
        parts.push('as seen by mainland services');
    }
    return parts.join(' · ');
}

async function renderBadge(badgeText, title) {
    const normalizedCode = typeof badgeText === 'string' ? badgeText.toUpperCase() : ERROR_BADGE_TEXT;
    const showText = await getSetting(KEY_SETTINGS_SHOW_TEXT, true);
    const showFlags = await getSetting(KEY_SETTINGS_SHOW_FLAGS, true);
    const iconPath = showFlags && supportedFlagCountries.has(normalizedCode)
        ? `img/flags/48/${normalizedCode}.png`
        : 'img/icon48.png';

    // Wait for every action write before reporting failure. Otherwise a late
    // write from this render could overwrite the subsequent error indicator.
    const results = await Promise.allSettled([
        chrome.action.setBadgeText({ text: showText ? normalizedCode : '' }),
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }),
        chrome.action.setIcon({ path: iconPath }),
        chrome.action.setTitle({ title: title || 'IP Address & Geolocation' })
    ]);

    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;

    if (typeof chrome.action.setBadgeTextColor === 'function') {
        await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    return { showFlags, showText };
}

async function reportRefreshFailure(error) {
    reportBackgroundFailure(error);
    try {
        // Discard a country that may only have been partially painted. A later
        // successful refresh must be able to commit without fallback holding it.
        const state = await getRuntimeState();
        state.badge = emptyBadgeState();
        await writeRuntimeState(state);
    } catch (stateError) {
        reportBackgroundFailure(stateError);
    }
    try {
        await renderBadge(ERROR_BADGE_TEXT, 'The toolbar could not update. Open the extension to retry.');
    } catch (renderError) {
        reportBackgroundFailure(renderError);
    }
}

function readingOf(geoLocation) {
    if (!geoLocation) return null;

    const location = geoLocation.get('geoLocation');
    return {
        ipAddress: location.ipAddress || '',
        countryCode: location.countryCode || '',
        countryName: location.countryName || '',
        source: location.source || ''
    };
}

async function recordLocationChange(state, geoLocation, ipv6) {
    const current = readingOf(geoLocation);
    if (!current) return;

    const key = ipv6 ? 'ipv6' : 'ipv4';
    const previous = state[key];
    state[key] = current;

    if (!shouldNotifyChange(previous, current)) return;

    const notificationsEnabled = await getSetting(KEY_SETTINGS_NOTIFICATION, true);
    const ipv6NotificationsEnabled = await getSetting(KEY_SETTINGS_NOTIFICATION_IPv6, false);
    if ((!ipv6 && notificationsEnabled) || (ipv6 && ipv6NotificationsEnabled)) {
        try {
            await chrome.notifications.create(`geoLocationAlert${Math.random()}`, {
                type: 'basic',
                iconUrl: 'img/icon128.png',
                title: 'IP Address & Geolocation',
                message: `From ${previous.ipAddress} to ${current.ipAddress}.`,
                contextMessage: `IPv${ipv6 ? 6 : 4} changed`
            });
        } catch (error) {
            console.warn('[IP Geolocation] IP-change notification failed:', error);
        }
    }
}

function badgeCandidate(selected) {
    if (!selected) return null;

    const reading = readingOf(selected.geoLocation);
    if (!/^[A-Z]{2}$/.test(reading.countryCode || '')) return null;
    return Object.assign({ family: selected.family }, reading);
}

async function performRefresh() {
    const state = await getRuntimeState();
    state.lastRefreshAt = lastRefreshStartedAt;

    const badgeIndicator = await getSetting(KEY_SETTINGS_COUNTRY_BADGE, 'auto');
    const [ipv4Result, ipv6Result] = await Promise.allSettled([
        new GeoLocation().fetch({ timeout: REQUEST_TIMEOUT_MS }),
        new GeoLocation6().fetch({ timeout: REQUEST_TIMEOUT_MS })
    ]);
    const ipv4 = fulfilledLocation(ipv4Result);
    const ipv6 = fulfilledLocation(ipv6Result);

    // Exactly one badge commit is allowed per completed refresh. This removes
    // the old shared ipv4Error race without changing the ERR semantics.
    const candidate = badgeCandidate(selectBadgeLocation(badgeIndicator, ipv4, ipv6));
    const decision = evaluateBadgeCommit(state.badge, candidate);
    let display = null;
    if (decision.commit) {
        display = await renderBadge(
            candidate ? candidate.countryCode : ERROR_BADGE_TEXT,
            candidate ? describeReading(candidate) : 'The IP address lookup failed'
        );
    }
    // A selected country becomes committed only after the action APIs succeed.
    state.badge = decision.state;

    await recordLocationChange(state, ipv4, false);
    await recordLocationChange(state, ipv6, true);
    await writeRuntimeState(state);

    if (candidate) {
        return { ok: true, family: candidate.family, source: candidate.source, committed: decision.commit, display };
    }

    return {
        ok: false,
        ipv4Error: ipv4Result.status === 'rejected' ? String(ipv4Result.reason) : null,
        ipv6Error: ipv6Result.status === 'rejected' ? String(ipv6Result.reason) : null
    };
}

function fetchGeoLocation() {
    if (refreshInFlight) return refreshInFlight;

    lastRefreshStartedAt = Date.now();
    refreshInFlight = performRefresh().catch(async (error) => {
        await reportRefreshFailure(error);
        throw error;
    }).finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

// Throttled entry point for triggers that can fire in bursts. The timestamp is
// mirrored into session storage because the service worker is restarted often
// enough that an in-memory guard alone would not survive between two events.
async function requestRefresh(options = {}) {
    if (options.force) return fetchGeoLocation();

    const state = await getRuntimeState();
    const lastStartedAt = Math.max(lastRefreshStartedAt, Number(state.lastRefreshAt) || 0);
    if (!shouldStartRefresh(lastStartedAt, Date.now(), MIN_REFRESH_INTERVAL_MS)) return null;

    return fetchGeoLocation();
}

function refreshInBackground(options) {
    void requestRefresh(options).catch(reportBackgroundFailure);
}

function startInterval() {
    if (!intervalId) {
        intervalId = setInterval(() => refreshInBackground(), CHECK_INTERVAL_MS);
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
    if (alarm && alarm.periodInMinutes === CHECK_ALARM_MINUTES) return;

    if (alarm && typeof chrome.alarms.clear === 'function') {
        await chrome.alarms.clear(CHECK_ALARM);
    }
    await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_ALARM_MINUTES });
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
    if (alarm.name !== CHECK_ALARM) return;

    // The alarm is the only trigger left when the browser sits completely idle,
    // so it also repairs the schedule: a worker that was restarted for this
    // event has no interval yet, and a lost alarm would otherwise stay lost.
    void ensureAlarm().catch(reportBackgroundFailure);
    startInterval();
    refreshInBackground({ force: true });
});

// A Manifest V3 service worker is stopped as soon as it goes idle, which used to
// freeze the poll until the next one-minute alarm and made a proxy switch show
// up on the toolbar minutes late. These events wake the worker again the moment
// the user does something that can involve a different exit address, so the
// badge is refreshed when it is actually being looked at. Every one of them goes
// through the throttle, so browsing cannot produce more requests than the poll.
addEventListenerIfAvailable(chrome.tabs && chrome.tabs.onActivated, () => refreshInBackground());
addEventListenerIfAvailable(chrome.tabs && chrome.tabs.onUpdated, (tabId, changeInfo) => {
    if (changeInfo && changeInfo.status === 'loading') refreshInBackground();
});
addEventListenerIfAvailable(chrome.windows && chrome.windows.onFocusChanged, (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshInBackground();
});

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    // Switching a system proxy on or off usually takes the network down and up
    // again, which is the earliest possible hint that the exit address moved.
    self.addEventListener('online', () => refreshInBackground({ force: true }));
}

chrome.runtime.onInstalled.addListener(() => {
    void ensureAlarm().catch(reportBackgroundFailure);
});

chrome.runtime.onStartup.addListener(() => {
    void ensureAlarm().catch(reportBackgroundFailure);
});

chrome.runtime.onSuspend.addListener(stopInterval);

async function initialize() {
    // A placeholder or alarm failure must never prevent future retry attempts.
    startInterval();
    await ensureAlarm().catch(reportBackgroundFailure);
    const state = await getRuntimeState();

    // Only paint the placeholder when nothing is known yet. The worker restarts
    // on every wake-up event, and resetting a known country code to '...' on
    // each of those restarts would make the toolbar flicker constantly.
    if (!state.badge || !state.badge.countryCode) {
        await renderBadge(PENDING_BADGE_TEXT, 'Looking up your public IP address')
            .catch(reportBackgroundFailure);
    }

    await fetchGeoLocation();
}

void initialize().catch(reportBackgroundFailure);
