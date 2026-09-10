const IP_ADDRESS_ENDPOINTS = {
    4: 'https://api.ipify.org?format=json',
    6: 'https://api6.ipify.org?format=json'
};
const IP_ADDRESS_TEXT_ENDPOINTS = {
    4: 'https://ipv4.icanhazip.com/',
    6: 'https://ipv6.icanhazip.com/'
};
const COUNTRY_API_URL = 'https://api.country.is';
const CHINA_IPV4_API_URL = 'https://myip.ipip.net/json';
const CHINA_GEO_API_URL = 'https://ip.taobao.com/outGetIpInfo';

// Budget for one complete lookup: public address plus geolocation.
const DEFAULT_GEOLOCATION_TIMEOUT = 12000;

// A request that leaves the machine through a proxy regularly needs more than a
// second, and it needs a lot more right after the proxy was switched on, while
// the tunnel is still cold. The previous 1500 ms budget for every attempt gave
// up on the proxied provider so eagerly that the mainland fallback - which
// measures the direct route instead - became the routine source of the badge,
// which is why a fresh proxy exit address showed up minutes late or not at all.
const PRIMARY_ATTEMPT_TIMEOUT = 4000;
const SECONDARY_ATTEMPT_TIMEOUT = 2500;

const CONTINENT_NAMES = {
    AF: 'Africa',
    AN: 'Antarctica',
    AS: 'Asia',
    EU: 'Europe',
    NA: 'North America',
    OC: 'Oceania',
    SA: 'South America'
};

function emptyGeoLocationData() {
    return {
        browser: {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        },
        geoLocation: {
            ipAddress: '',
            source: '',
            countryCode: '',
            countryName: '',
            city: '',
            state: '',
            stateCode: '',
            continent: '',
            continentCode: '',
            timezone: '',
            latitude: 0,
            longitude: 0
        }
    };
}

function isAddressFamily(ipAddress, family) {
    if (typeof ipAddress !== 'string') return false;

    if (family === 4) {
        const parts = ipAddress.split('.');
        return parts.length === 4 && parts.every((part) => {
            return /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255;
        });
    }

    return family === 6 && ipAddress.includes(':') && /^[0-9a-f:.]+$/i.test(ipAddress);
}

function countryName(countryCode) {
    if (!countryCode) return '';

    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) || countryCode;
    } catch (error) {
        return countryCode;
    }
}

async function fetchResponse(url, signal, accept) {
    const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: accept },
        signal: signal
    });

    if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
    }

    return response;
}

async function fetchJson(url, signal) {
    return (await fetchResponse(url, signal, 'application/json')).json();
}

async function fetchText(url, signal) {
    return (await fetchResponse(url, signal, 'text/plain')).text();
}

async function runWithTimeout(operation, parentSignal, timeout) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    if (parentSignal.aborted) {
        controller.abort();
    } else {
        parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }

    try {
        return await operation(controller.signal);
    } finally {
        clearTimeout(timeoutId);
        parentSignal.removeEventListener('abort', abortFromParent);
    }
}

// Tries the providers in order and reports which one answered. Every attempt is
// bounded by its own budget and by the deadline of the whole lookup, so a chain
// of slow providers can never outlive the refresh that started it.
async function firstSuccessful(providers, parentSignal, label, deadline) {
    let lastError = null;

    for (const provider of providers) {
        if (parentSignal.aborted) {
            const error = new Error(`${label} aborted`);
            error.name = 'AbortError';
            throw error;
        }

        const budget = Math.min(provider.timeout, deadline - Date.now());
        if (budget <= 0) {
            lastError = lastError || new Error(`${label} ran out of time`);
            break;
        }

        try {
            return { value: await runWithTimeout(provider.run, parentSignal, budget), source: provider.source };
        } catch (error) {
            if (parentSignal.aborted) {
                throw error;
            }
            lastError = error;
        }
    }

    throw new Error(`${label} failed: ${lastError ? String(lastError) : 'no provider available'}`);
}

function publicIpProviders(family) {
    // Both primary providers sit on domains that a proxy rule set treats as
    // foreign, so they report the proxied exit address. Having two of them means
    // a single overloaded or rate-limited service no longer hands the badge over
    // to the direct-route fallback.
    const providers = [
        {
            source: ADDRESS_SOURCE_PRIMARY,
            timeout: PRIMARY_ATTEMPT_TIMEOUT,
            run: async (providerSignal) => {
                const response = await fetchJson(IP_ADDRESS_ENDPOINTS[family], providerSignal);
                const ipAddress = response && response.ip;
                if (!isAddressFamily(ipAddress, family)) {
                    throw new Error(`The IPv${family} service returned an invalid address`);
                }
                return ipAddress;
            }
        },
        {
            source: ADDRESS_SOURCE_PRIMARY,
            timeout: SECONDARY_ATTEMPT_TIMEOUT,
            run: async (providerSignal) => {
                const body = await fetchText(IP_ADDRESS_TEXT_ENDPOINTS[family], providerSignal);
                const ipAddress = typeof body === 'string' ? body.trim() : '';
                if (!isAddressFamily(ipAddress, family)) {
                    throw new Error(`The secondary IPv${family} service returned an invalid address`);
                }
                return ipAddress;
            }
        }
    ];

    if (family === 4) {
        providers.push({
            source: ADDRESS_SOURCE_FALLBACK,
            timeout: SECONDARY_ATTEMPT_TIMEOUT,
            run: async (providerSignal) => {
                const response = await fetchJson(CHINA_IPV4_API_URL, providerSignal);
                const ipAddress = response && response.ret === 'ok' && response.data
                    ? response.data.ip
                    : '';
                if (!isAddressFamily(ipAddress, 4)) {
                    throw new Error('The mainland IPv4 service returned an invalid address');
                }
                return ipAddress;
            }
        });
    }

    return providers;
}

async function fetchPublicIp(family, signal, deadline) {
    return firstSuccessful(publicIpProviders(family), signal, `IPv${family} address lookup`, deadline);
}

function normalizeCountryResponse(response) {
    const countryCode = response && typeof response.country === 'string'
        ? response.country.toUpperCase()
        : '';
    if (!/^[A-Z]{2}$/.test(countryCode)) {
        throw new Error('The geolocation service returned an invalid country code');
    }

    const location = response.location || {};
    const continentCode = response.continent || '';
    const subdivision = response.subdivision || '';
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);

    return {
        countryCode: countryCode,
        countryName: countryName(countryCode),
        city: response.city || '',
        state: subdivision,
        stateCode: subdivision,
        continent: CONTINENT_NAMES[continentCode] || continentCode,
        continentCode: continentCode,
        timezone: location.time_zone || '',
        latitude: Number.isFinite(latitude) ? latitude : 0,
        longitude: Number.isFinite(longitude) ? longitude : 0
    };
}

function normalizeTaobaoResponse(response) {
    const data = response && response.code === 0 ? response.data : null;
    const countryCode = data && typeof data.country_id === 'string'
        ? data.country_id.toUpperCase()
        : '';
    if (!/^[A-Z]{2}$/.test(countryCode)) {
        throw new Error('The mainland geolocation service returned an invalid country code');
    }

    const cleanValue = (value) => value && value !== 'XX' ? value : '';
    return {
        countryCode: countryCode,
        countryName: countryName(countryCode),
        city: cleanValue(data.city),
        state: cleanValue(data.region),
        stateCode: cleanValue(data.region_id),
        continent: '',
        continentCode: '',
        timezone: '',
        latitude: 0,
        longitude: 0
    };
}

// Both geolocation providers answer the same question about the same address,
// so either of them may resolve a lookup without changing what the badge means.
async function fetchGeoData(ipAddress, signal, deadline) {
    const fields = 'city,continent,subdivision,location';
    return firstSuccessful([
        {
            source: ADDRESS_SOURCE_PRIMARY,
            timeout: SECONDARY_ATTEMPT_TIMEOUT,
            run: async (providerSignal) => normalizeCountryResponse(await fetchJson(
                `${COUNTRY_API_URL}/${encodeURIComponent(ipAddress)}?fields=${fields}`,
                providerSignal
            ))
        },
        {
            source: ADDRESS_SOURCE_FALLBACK,
            timeout: SECONDARY_ATTEMPT_TIMEOUT,
            run: async (providerSignal) => normalizeTaobaoResponse(await fetchJson(
                `${CHINA_GEO_API_URL}?ip=${encodeURIComponent(ipAddress)}&accessKey=alibaba-inc`,
                providerSignal
            ))
        }
    ], signal, 'Geolocation lookup', deadline);
}

async function lookupGeoLocation(family, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const deadline = Date.now() + timeout;

    try {
        const address = await fetchPublicIp(family, controller.signal, deadline);
        const geoLocation = await fetchGeoData(address.value, controller.signal, deadline);
        const result = emptyGeoLocationData();
        result.geoLocation = Object.assign(
            { ipAddress: address.value, source: address.source },
            geoLocation.value
        );

        return result;
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error(`IPv${family} lookup timed out after ${timeout}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

class GeoLocationBase {
    constructor(family) {
        this.family = family;
        this.data = emptyGeoLocationData();
    }

    get(key) {
        return this.data[key];
    }

    async fetch(options = {}) {
        const timeout = Number.isFinite(options.timeout) && options.timeout > 0
            ? options.timeout
            : DEFAULT_GEOLOCATION_TIMEOUT;

        try {
            this.data = await lookupGeoLocation(this.family, timeout);
            if (options.success) options.success();
            return this;
        } catch (error) {
            if (options.error) {
                options.error(error);
                return null;
            }
            throw error;
        }
    }

    toJSON() {
        return JSON.parse(JSON.stringify(this.data));
    }
}

class GeoLocation extends GeoLocationBase {
    constructor() {
        super(4);
    }
}

class GeoLocation6 extends GeoLocationBase {
    constructor() {
        super(6);
    }
}
