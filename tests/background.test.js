const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const scripts = [
    'js/constants.js',
    'js/utils/LocalStorageProvider.js',
    'js/utils/RefreshPolicy.js',
    'js/utils/RuntimeState.js',
    'js/models/GeoLocation.js',
    'js/main.js'
];

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function neverResolves() {
    return new Promise(() => { });
}

function storageArea(store) {
    return {
        get: (key, callback) => {
            const result = {};
            if (typeof key === 'string' && Object.hasOwn(store, key)) {
                result[key] = store[key];
            }
            callback(result);
        },
        remove: (key, callback) => {
            delete store[key];
            if (callback) callback();
        },
        set: (items, callback) => {
            Object.assign(store, items);
            if (callback) callback();
        }
    };
}

function createEvent(listeners) {
    return { addListener: (listener) => listeners.push(listener) };
}

// A worker restart is modelled by loading the scripts again against the same
// browser-side storage, which is exactly what survives a Manifest V3 shutdown.
function createChromeMock(profile) {
    const badge = profile.toolbar || (profile.toolbar = { text: '', color: '', icon: '', title: '' });
    const notifications = [];
    const alarms = {};
    const listeners = { alarm: [], tabActivated: [], tabUpdated: [], windowFocus: [], online: [] };

    return {
        state: { badge, notifications, listeners, alarms, profile, errors: [], warnings: [], iconWrites: [] },
        action: {
            setBadgeText: async ({ text }) => { badge.text = text; },
            setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
            setBadgeTextColor: async () => { },
            setIcon: async ({ path: icon }) => { badge.icon = icon; },
            setTitle: async ({ title }) => { badge.title = title; }
        },
        alarms: {
            create: async (name, options) => { alarms[name] = options; },
            clear: async (name) => { delete alarms[name]; },
            get: async (name) => alarms[name] ? Object.assign({ name }, alarms[name]) : undefined,
            onAlarm: createEvent(listeners.alarm)
        },
        notifications: {
            create: async (id, options) => { notifications.push(options); }
        },
        runtime: {
            onInstalled: { addListener: () => { } },
            onMessage: { addListener: () => { } },
            onSuspend: { addListener: () => { } },
            onStartup: { addListener: () => { } }
        },
        storage: {
            local: storageArea(profile.local),
            session: storageArea(profile.session)
        },
        tabs: {
            onActivated: createEvent(listeners.tabActivated),
            onUpdated: createEvent(listeners.tabUpdated)
        },
        windows: {
            WINDOW_ID_NONE: -1,
            onFocusChanged: createEvent(listeners.windowFocus)
        }
    };
}

function createProfile() {
    return { local: {}, session: {} };
}

function loadBackground(fetchMock, profile = createProfile(), configure = () => { }) {
    const chrome = createChromeMock(profile);
    const setIcon = chrome.action.setIcon;
    chrome.action.setIcon = async (details) => {
        chrome.state.iconWrites.push(details.path);
        await setIcon(details);
    };
    configure(chrome);
    let clockOffset = 0;
    class MockDate extends Date {
        static now() {
            return Date.now() + clockOffset;
        }
    }
    const context = {
        AbortController: AbortController,
        Date: MockDate,
        Intl: Intl,
        chrome: chrome,
        console: {
            error: (...args) => chrome.state.errors.push(args.map(String).join(' ')),
            warn: (...args) => chrome.state.warnings.push(args.map(String).join(' '))
        },
        clearInterval: () => { },
        clearTimeout: clearTimeout,
        fetch: fetchMock,
        navigator: { userAgent: 'test-agent' },
        self: { addEventListener: (name, listener) => chrome.state.listeners.online.push(listener) },
        setInterval: (callback, milliseconds) => {
            chrome.state.intervalCallback = callback;
            chrome.state.intervalMilliseconds = milliseconds;
            return 1;
        },
        setTimeout: setTimeout
    };
    vm.createContext(context);
    for (const script of scripts) {
        vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
    }
    vm.runInContext('globalThis.backgroundApi = { fetchGeoLocation };', context);
    return {
        api: context.backgroundApi,
        chrome: chrome,
        profile: profile,
        advanceClock: (milliseconds) => { clockOffset += milliseconds; }
    };
}

function geoResponse(country) {
    return jsonResponse({
        country: country,
        city: 'Example City',
        continent: country === 'US' ? 'NA' : 'AS',
        subdivision: 'CA',
        location: { latitude: 37.5, longitude: -122.2, time_zone: 'America/Los_Angeles' }
    });
}

function successfulIPv4(country = 'US', ip = '203.0.113.10') {
    return async (url) => {
        if (url.includes('api.ipify')) return jsonResponse({ ip });
        if (url.includes('api.country.is')) return geoResponse(country);
        throw new Error('IPv6 unavailable');
    };
}

test('display preferences independently control the flag and country text', async () => {
    for (const [flags, text] of [[true, true], [true, false], [false, true], [false, false]]) {
        const profile = createProfile();
        profile.local = { badge_show_flags: JSON.stringify(flags), badge_show_text: JSON.stringify(text) };
        const { api, chrome } = loadBackground(successfulIPv4(), profile);
        await delay(20);
        const result = await api.fetchGeoLocation();
        assert.equal(result.ok, true);
        assert.equal(result.display.showFlags, flags);
        assert.equal(result.display.showText, text);
        assert.equal(chrome.state.badge.text, text ? 'US' : '');
        assert.equal(chrome.state.badge.icon, flags ? 'img/flags/48/US.png' : 'img/icon48.png');
    }
});

test('a rejected notification cannot prevent the new country from being displayed', async () => {
    let country = 'US';
    let ip = '203.0.113.10';
    const { api, chrome } = loadBackground((url) => successfulIPv4(country, ip)(url));
    await delay(20);
    chrome.notifications.create = async () => { throw new Error('Notifications denied'); };
    country = 'DE';
    ip = '198.51.100.20';
    const result = await api.fetchGeoLocation();
    assert.equal(result.ok, true);
    assert.equal(chrome.state.badge.text, 'DE');
    assert.match(chrome.state.badge.icon, /DE\.png$/);
    assert.ok(chrome.state.warnings.some((message) => message.includes('Notifications denied')));
});

test('failed action writes settle before ERR and do not commit a country that was not painted', async () => {
    let country = 'US';
    const { api, chrome, profile } = loadBackground((url) => successfulIPv4(country)(url));
    await delay(20);
    const originalIcon = chrome.action.setIcon;
    const originalText = chrome.action.setBadgeText;
    chrome.action.setIcon = async (details) => {
        if (details.path.endsWith('/DE.png')) throw new Error('Cannot load flag');
        return originalIcon(details);
    };
    chrome.action.setBadgeText = async (details) => {
        if (details.text === 'DE') await delay(30);
        return originalText(details);
    };
    country = 'DE';
    await assert.rejects(api.fetchGeoLocation(), /Cannot load flag/);
    assert.equal(chrome.state.badge.text, 'ERR');
    assert.equal(profile.session.runtime_state.badge.countryCode, '');
    assert.ok(chrome.state.errors.some((message) => message.includes('Cannot load flag')));
    chrome.action.setIcon = originalIcon;
    const result = await api.fetchGeoLocation();
    assert.equal(result.ok, true);
    assert.equal(chrome.state.badge.text, 'DE');
    assert.equal(profile.session.runtime_state.badge.countryCode, 'DE');
});

test('startup painting and alarm failures keep retries alive and recovery repaints the flag', async () => {
    let fail = true;
    const { chrome } = loadBackground(successfulIPv4(), createProfile(), (browser) => {
        const originalIcon = browser.action.setIcon;
        browser.action.setIcon = async (details) => {
            if (fail) throw new Error('Icon unavailable');
            return originalIcon(details);
        };
        browser.alarms.get = async () => { throw new Error('Alarm unavailable'); };
    });
    await delay(30);
    assert.equal(typeof chrome.state.intervalCallback, 'function');
    assert.ok(chrome.state.errors.some((message) => message.includes('Icon unavailable')));
    assert.ok(chrome.state.errors.some((message) => message.includes('Alarm unavailable')));
    fail = false;
    chrome.state.listeners.online[0]();
    await delay(30);
    assert.equal(chrome.state.badge.text, 'US');
    assert.match(chrome.state.badge.icon, /US\.png$/);
});

test('one refresh commits once and a later outage immediately commits ERR', async () => {
    let mode = 'success';
    let ipv4Requests = 0;
    let ipv6Requests = 0;
    const fetchMock = async (url) => {
        if (mode === 'failure') throw new Error('temporary provider outage');
        if (url.includes('api6.ipify') || url.includes('ipv6.icanhazip')) {
            ipv6Requests += 1;
            throw new Error('IPv6 unavailable');
        }
        if (url.includes('api.ipify')) {
            ipv4Requests += 1;
            await delay(5);
            return jsonResponse({ ip: '203.0.113.10' });
        }
        return geoResponse('US');
    };
    const { api, chrome } = loadBackground(fetchMock);

    await delay(40);
    assert.equal(chrome.state.badge.text, 'US');
    assert.equal(chrome.state.badge.color, '#000000');
    assert.match(chrome.state.badge.icon, /US\.png$/);
    assert.match(chrome.state.badge.title, /IPv4 203\.0\.113\.10/);
    assert.equal(ipv6Requests, 2);
    assert.equal(chrome.state.intervalMilliseconds, 3550);

    const beforeOverlappingRefresh = ipv4Requests;
    const first = api.fetchGeoLocation();
    const second = api.fetchGeoLocation();
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal(ipv4Requests, beforeOverlappingRefresh + 1);

    mode = 'failure';
    await api.fetchGeoLocation();
    assert.equal(chrome.state.badge.text, 'ERR');
    assert.equal(chrome.state.badge.color, '#000000');
    assert.match(chrome.state.badge.icon, /icon48\.png$/);

    mode = 'success';
    await api.fetchGeoLocation();
    assert.equal(chrome.state.badge.text, 'US');
    assert.match(chrome.state.badge.icon, /US\.png$/);
    assert.equal(chrome.state.listeners.alarm.length, 1);
});

test('auto mode monitors both families and falls back to IPv6 when IPv4 fails', async () => {
    let ipv4Requests = 0;
    let ipv6Requests = 0;
    const fetchMock = async (url) => {
        if (url.includes('api6.ipify')) {
            ipv6Requests += 1;
            return jsonResponse({ ip: '2001:db8::10' });
        }
        if (url.includes('api.ipify') || url.includes('ipv4.icanhazip') || url.includes('ipip')) {
            ipv4Requests += 1;
            throw new Error('IPv4 unavailable');
        }
        return jsonResponse({
            country: 'DE',
            city: 'Example City',
            continent: 'EU',
            subdivision: 'BE',
            location: { latitude: 52.5, longitude: 13.4, time_zone: 'Europe/Berlin' }
        });
    };
    const { chrome } = loadBackground(fetchMock);

    await delay(40);
    assert.equal(ipv4Requests, 3);
    assert.equal(ipv6Requests, 1);
    assert.equal(chrome.state.badge.text, 'DE');
    assert.equal(chrome.state.badge.color, '#000000');
    assert.match(chrome.state.badge.icon, /DE\.png$/);
});

test('browsing wakes the worker for a refresh instead of waiting for the alarm', async () => {
    let ipv4Requests = 0;
    const fetchMock = async (url) => {
        if (url.includes('ipify') || url.includes('icanhazip') || url.includes('ipip')) {
            if (url.includes('api.ipify')) ipv4Requests += 1;
            if (!url.includes('api.ipify')) throw new Error('not needed');
            return jsonResponse({ ip: '203.0.113.10' });
        }
        return geoResponse('US');
    };
    const { chrome, advanceClock } = loadBackground(fetchMock);

    await delay(40);
    const afterStartup = ipv4Requests;
    assert.equal(chrome.state.listeners.tabUpdated.length, 1);
    assert.equal(chrome.state.listeners.tabActivated.length, 1);
    assert.equal(chrome.state.listeners.windowFocus.length, 1);
    assert.equal(chrome.state.listeners.online.length, 1);

    // A burst of navigation events may not turn into a burst of requests.
    chrome.state.listeners.tabUpdated[0](1, { status: 'loading' });
    chrome.state.listeners.tabActivated[0]({ tabId: 1 });
    chrome.state.listeners.windowFocus[0](7);
    await delay(20);
    assert.equal(ipv4Requests, afterStartup);

    // Once the reading is stale again, the next navigation refreshes it.
    advanceClock(5000);
    chrome.state.listeners.tabUpdated[0](1, { status: 'loading' });
    await delay(20);
    assert.equal(ipv4Requests, afterStartup + 1);

    // A window losing focus is not a reason to look up anything.
    advanceClock(5000);
    chrome.state.listeners.windowFocus[0](chrome.windows.WINDOW_ID_NONE);
    await delay(20);
    assert.equal(ipv4Requests, afterStartup + 1);
});

test('a restarted worker keeps the country code it already committed', async () => {
    const fetchMock = async (url) => {
        if (url.includes('api.ipify')) return jsonResponse({ ip: '203.0.113.10' });
        if (url.includes('api.country.is')) return geoResponse('US');
        throw new Error('not needed');
    };
    const started = loadBackground(fetchMock);
    await delay(40);
    assert.equal(started.chrome.state.badge.text, 'US');

    const restarted = loadBackground(neverResolves, started.profile);
    await delay(40);
    assert.equal(restarted.chrome.state.badge.text, 'US');
    assert.equal(restarted.chrome.state.iconWrites.length, 0);

    const installed = loadBackground(neverResolves);
    await delay(40);
    assert.equal(installed.chrome.state.badge.text, '...');
});

test('an address change across a worker restart is still notified', async () => {
    const buildFetch = (ipAddress) => async (url) => {
        if (url.includes('api.ipify')) return jsonResponse({ ip: ipAddress });
        if (url.includes('api.country.is')) return geoResponse('US');
        throw new Error('not needed');
    };

    const started = loadBackground(buildFetch('203.0.113.10'));
    await delay(40);
    assert.equal(started.chrome.state.notifications.length, 0);

    const restarted = loadBackground(buildFetch('198.51.100.7'), started.profile);
    await delay(40);
    assert.equal(restarted.chrome.state.notifications.length, 1);
    assert.match(restarted.chrome.state.notifications[0].message, /203\.0\.113\.10 to 198\.51\.100\.7/);
    assert.equal(restarted.chrome.state.notifications[0].contextMessage, 'IPv4 changed');
});

test('a single direct-route answer does not replace the proxied country code', async () => {
    let internationalWorks = true;
    const fetchMock = async (url) => {
        if (url.includes('api6.ipify') || url.includes('ipv6.icanhazip')) {
            throw new Error('IPv6 unavailable');
        }
        if (url.includes('api.ipify') || url.includes('ipv4.icanhazip')) {
            if (!internationalWorks) throw new Error('blocked');
            return jsonResponse({ ip: '38.175.104.157' });
        }
        if (url.includes('ipip')) {
            return jsonResponse({ ret: 'ok', data: { ip: '1.2.3.4' } });
        }
        if (url.includes('api.country.is')) {
            return geoResponse(internationalWorks ? 'US' : 'CN');
        }
        throw new Error('not needed');
    };
    const { api, chrome } = loadBackground(fetchMock);

    await delay(40);
    assert.equal(chrome.state.badge.text, 'US');

    internationalWorks = false;
    await api.fetchGeoLocation();
    assert.equal(chrome.state.badge.text, 'US');
    assert.match(chrome.state.badge.title, /IPv4 38\.175\.104\.157/);

    await api.fetchGeoLocation();
    assert.equal(chrome.state.badge.text, 'CN');
    assert.match(chrome.state.badge.title, /as seen by mainland services/);

    internationalWorks = true;
    await api.fetchGeoLocation();
    assert.equal(chrome.state.badge.text, 'US');
});

test('a provider switch is not reported as an address change', async () => {
    let internationalWorks = true;
    const fetchMock = async (url) => {
        if (url.includes('api6.ipify') || url.includes('ipv6.icanhazip')) {
            throw new Error('IPv6 unavailable');
        }
        if (url.includes('api.ipify') || url.includes('ipv4.icanhazip')) {
            if (!internationalWorks) throw new Error('blocked');
            return jsonResponse({ ip: '38.175.104.157' });
        }
        if (url.includes('ipip')) return jsonResponse({ ret: 'ok', data: { ip: '1.2.3.4' } });
        if (url.includes('api.country.is')) return geoResponse(internationalWorks ? 'US' : 'CN');
        throw new Error('not needed');
    };
    const { api, chrome } = loadBackground(fetchMock);

    await delay(40);
    internationalWorks = false;
    await api.fetchGeoLocation();
    internationalWorks = true;
    await api.fetchGeoLocation();

    assert.equal(chrome.state.notifications.length, 0);
});

test('the wake-up alarm is created once and repaired when it disappears', async () => {
    const fetchMock = async (url) => {
        if (url.includes('api.ipify')) return jsonResponse({ ip: '203.0.113.10' });
        if (url.includes('api.country.is')) return geoResponse('US');
        throw new Error('not needed');
    };
    const { chrome } = loadBackground(fetchMock);

    await delay(40);
    assert.equal(chrome.state.alarms.checkIntervalAlarm.periodInMinutes, 1);

    delete chrome.state.alarms.checkIntervalAlarm;
    chrome.state.listeners.alarm[0]({ name: 'checkIntervalAlarm' });
    await delay(40);
    assert.equal(chrome.state.alarms.checkIntervalAlarm.periodInMinutes, 1);
});
