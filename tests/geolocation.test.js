const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const scripts = ['js/constants.js', 'js/models/GeoLocation.js'];

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

function textResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status: status,
        json: async () => JSON.parse(body),
        text: async () => body
    };
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function loadModel(fetchMock) {
    const context = {
        AbortController: AbortController,
        Intl: Intl,
        clearTimeout: clearTimeout,
        fetch: fetchMock,
        navigator: { userAgent: 'test-agent' },
        setTimeout: setTimeout
    };
    vm.createContext(context);
    for (const script of scripts) {
        vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
    }
    vm.runInContext('globalThis.models = { GeoLocation, GeoLocation6 };', context);
    return context.models;
}

test('IPv4 lookup validates and normalizes both provider responses', async () => {
    const requestedUrls = [];
    const { GeoLocation } = loadModel(async (url) => {
        requestedUrls.push(url);
        if (url.includes('ipify')) return jsonResponse({ ip: '203.0.113.10' });
        return jsonResponse({
            ip: '203.0.113.10',
            country: 'us',
            city: 'Example City',
            continent: 'NA',
            subdivision: 'CA',
            location: {
                latitude: 37.5,
                longitude: -122.2,
                time_zone: 'America/Los_Angeles'
            }
        });
    });

    const model = await new GeoLocation().fetch({ timeout: 1000 });
    const data = model.toJSON();

    assert.equal(data.geoLocation.ipAddress, '203.0.113.10');
    assert.equal(data.geoLocation.countryCode, 'US');
    assert.equal(data.geoLocation.countryName, 'United States');
    assert.equal(data.geoLocation.continent, 'North America');
    assert.equal(data.geoLocation.timezone, 'America/Los_Angeles');
    assert.equal(data.geoLocation.source, 'primary');
    assert.equal(data.browser.userAgent, 'test-agent');
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /203\.0\.113\.10/);
});

test('a proxied address service is not abandoned in favour of the direct route', async () => {
    // The tunnel of a freshly enabled proxy is slow, and the old 1500 ms budget
    // per attempt handed those refreshes to the mainland service, which reports
    // the unproxied address instead. A slow primary has to win anyway.
    const requestedUrls = [];
    const { GeoLocation } = loadModel(async (url) => {
        requestedUrls.push(url);
        if (url.includes('api.ipify')) {
            await delay(1600);
            return jsonResponse({ ip: '38.175.104.157' });
        }
        if (url.includes('api.country.is')) return jsonResponse({ country: 'US' });
        throw new Error(`Unexpected URL: ${url}`);
    });

    const data = (await new GeoLocation().fetch()).toJSON().geoLocation;

    assert.equal(data.ipAddress, '38.175.104.157');
    assert.equal(data.countryCode, 'US');
    assert.equal(data.source, 'primary');
    assert.equal(requestedUrls.filter((url) => url.includes('ipip')).length, 0);
});

test('a second international service answers before the direct-route fallback', async () => {
    const requestedUrls = [];
    const { GeoLocation } = loadModel(async (url) => {
        requestedUrls.push(url);
        if (url.includes('api.ipify')) throw new Error('rate limited');
        if (url.includes('icanhazip')) return textResponse('38.175.104.157\n');
        if (url.includes('api.country.is')) return jsonResponse({ country: 'US' });
        throw new Error(`Unexpected URL: ${url}`);
    });

    const data = (await new GeoLocation().fetch({ timeout: 3000 })).toJSON().geoLocation;

    assert.equal(data.ipAddress, '38.175.104.157');
    assert.equal(data.source, 'primary');
    assert.equal(requestedUrls.filter((url) => url.includes('ipip')).length, 0);
});

test('an IPv4 provider cannot accidentally supply an IPv6 result', async () => {
    let requestCount = 0;
    const { GeoLocation } = loadModel(async (url) => {
        requestCount += 1;
        if (url.includes('icanhazip')) return textResponse('2001:db8::1\n');
        return jsonResponse({ ip: '2001:db8::1' });
    });

    await assert.rejects(
        new GeoLocation().fetch({ timeout: 1000 }),
        /invalid address/
    );
    assert.equal(requestCount, 3);
});

test('mainland fallbacks still return CN when the international services fail', async () => {
    const requestedUrls = [];
    const { GeoLocation } = loadModel(async (url) => {
        requestedUrls.push(url);
        if (url.includes('api.ipify') || url.includes('icanhazip')) {
            throw new Error('primary IP service blocked');
        }
        if (url.includes('myip.ipip.net')) {
            return jsonResponse({
                ret: 'ok',
                data: { ip: '203.0.113.10', location: ['中国', '北京', '北京', '', '移动'] }
            });
        }
        if (url.includes('api.country.is')) throw new Error('primary geo service blocked');
        if (url.includes('ip.taobao.com')) {
            return jsonResponse({
                code: 0,
                data: {
                    country_id: 'CN',
                    country: '中国',
                    region: '北京',
                    region_id: '110000',
                    city: '北京'
                }
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    });

    const data = (await new GeoLocation().fetch({ timeout: 3000 })).toJSON().geoLocation;

    assert.equal(data.countryCode, 'CN');
    assert.equal(data.countryName, 'China');
    assert.equal(data.city, '北京');
    assert.equal(data.source, 'fallback');
    assert.equal(requestedUrls.length, 5);
});

test('HTTP failures are rejected instead of being rendered as ERR data', async () => {
    const { GeoLocation } = loadModel(async () => jsonResponse({}, 503));

    await assert.rejects(
        new GeoLocation().fetch({ timeout: 1000 }),
        /HTTP 503/
    );
});

test('legacy popup error callbacks remain non-rejecting', async () => {
    const { GeoLocation } = loadModel(async () => jsonResponse({}, 503));
    let callbackError = null;

    const result = await new GeoLocation().fetch({
        timeout: 1000,
        error: (error) => { callbackError = error; }
    });

    assert.equal(result, null);
    assert.match(String(callbackError), /HTTP 503/);
});

test('the configured timeout aborts a hanging request', async () => {
    const { GeoLocation6 } = loadModel((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        });
    }));

    await assert.rejects(
        new GeoLocation6().fetch({ timeout: 10 }),
        /timed out after 10ms/
    );
});

test('a whole lookup never outlives its deadline even with a full provider chain', async () => {
    const { GeoLocation } = loadModel((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        });
    }));

    const startedAt = Date.now();
    await assert.rejects(new GeoLocation().fetch({ timeout: 300 }));
    assert.ok(Date.now() - startedAt < 1000);
});
