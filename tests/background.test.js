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
    'js/models/GeoLocation.js',
    'js/main.js'
];

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        json: async () => body
    };
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createChromeMock() {
    const stored = {};
    const badge = { text: '', color: '', icon: '', title: '' };
    const alarmListeners = [];

    return {
        state: { stored, badge, alarmListeners },
        action: {
            setBadgeText: async ({ text }) => { badge.text = text; },
            setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
            setBadgeTextColor: async () => { },
            setIcon: async ({ path: icon }) => { badge.icon = icon; },
            setTitle: async ({ title }) => { badge.title = title; }
        },
        alarms: {
            create: async () => { },
            get: async () => null,
            onAlarm: {
                addListener: (listener) => alarmListeners.push(listener)
            }
        },
        notifications: {
            create: async () => { }
        },
        runtime: {
            onInstalled: { addListener: () => { } },
            onMessage: { addListener: () => { } },
            onSuspend: { addListener: () => { } },
            onStartup: { addListener: () => { } }
        },
        storage: {
            local: {
                get: (key, callback) => {
                    const result = {};
                    if (typeof key === 'string' && Object.hasOwn(stored, key)) {
                        result[key] = stored[key];
                    }
                    callback(result);
                },
                remove: (key, callback) => {
                    delete stored[key];
                    if (callback) callback();
                },
                set: (items, callback) => {
                    Object.assign(stored, items);
                    if (callback) callback();
                }
            }
        }
    };
}

function loadBackground(fetchMock) {
    const chrome = createChromeMock();
    let nextIntervalId = 1;
    const context = {
        AbortController: AbortController,
        Intl: Intl,
        chrome: chrome,
        clearInterval: () => { },
        clearTimeout: clearTimeout,
        fetch: fetchMock,
        navigator: { userAgent: 'test-agent' },
        setInterval: (callback, milliseconds) => {
            chrome.state.intervalCallback = callback;
            chrome.state.intervalMilliseconds = milliseconds;
            return nextIntervalId++;
        },
        setTimeout: setTimeout
    };
    vm.createContext(context);
    for (const script of scripts) {
        vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
    }
    vm.runInContext('globalThis.backgroundApi = { fetchGeoLocation };', context);
    return { api: context.backgroundApi, chrome: chrome };
}

test('one refresh commits once and a later outage immediately commits ERR', async () => {
    let mode = 'success';
    let ipv4Requests = 0;
    let ipv6Requests = 0;
    const fetchMock = async (url) => {
        if (mode === 'failure') throw new Error('temporary provider outage');
        if (url.includes('api6.ipify')) {
            ipv6Requests += 1;
            throw new Error('IPv6 unavailable');
        }
        if (url.includes('api.ipify')) {
            ipv4Requests += 1;
            await delay(5);
            return jsonResponse({ ip: '203.0.113.10' });
        }
        return jsonResponse({
            country: 'US',
            city: 'Example City',
            continent: 'NA',
            subdivision: 'CA',
            location: { latitude: 37.5, longitude: -122.2, time_zone: 'America/Los_Angeles' }
        });
    };
    const { api, chrome } = loadBackground(fetchMock);

    await delay(30);
    assert.equal(chrome.state.badge.text, 'US');
    assert.equal(chrome.state.badge.color, '#000000');
    assert.match(chrome.state.badge.icon, /US\.png$/);
    assert.equal(ipv6Requests, 1);
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
    assert.equal(chrome.state.alarmListeners.length, 1);
});

test('auto mode monitors both families and falls back to IPv6 when IPv4 fails', async () => {
    let ipv4Requests = 0;
    let ipv6Requests = 0;
    const fetchMock = async (url) => {
        if (url.includes('api6.ipify')) {
            ipv6Requests += 1;
            return jsonResponse({ ip: '2001:db8::10' });
        }
        if (url.includes('api.ipify')) {
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

    await delay(30);
    assert.equal(ipv4Requests, 1);
    assert.equal(ipv6Requests, 1);
    assert.equal(chrome.state.badge.text, 'DE');
    assert.equal(chrome.state.badge.color, '#000000');
    assert.match(chrome.state.badge.icon, /DE\.png$/);
});
