const IP_ADDRESS_ENDPOINTS = {
    4: 'https://api.ipify.org?format=json',
    6: 'https://api6.ipify.org?format=json'
};
const COUNTRY_API_URL = 'https://api.country.is';
const CHINA_IPV4_API_URL = 'https://myip.ipip.net/json';
const CHINA_GEO_API_URL = 'https://ip.taobao.com/outGetIpInfo';
const DEFAULT_GEOLOCATION_TIMEOUT = 7000;
const PROVIDER_ATTEMPT_TIMEOUT = 1500;
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

async function fetchJson(url, signal) {
    const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: signal
    });

    if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
    }

    return response.json();
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

async function firstSuccessful(providers, parentSignal, label, timeout) {
    let lastError = null;

    for (const provider of providers) {
        if (parentSignal.aborted) {
            const error = new Error(`${label} aborted`);
            error.name = 'AbortError';
            throw error;
        }

        try {
            return await runWithTimeout(provider, parentSignal, Math.min(PROVIDER_ATTEMPT_TIMEOUT, timeout));
        } catch (error) {
            if (parentSignal.aborted) {
                throw error;
            }
            lastError = error;
        }
    }

    throw new Error(`${label} failed: ${lastError ? String(lastError) : 'no provider available'}`);
}

async function fetchPublicIp(family, signal, timeout) {
    const providers = [
        async (providerSignal) => {
            const response = await fetchJson(IP_ADDRESS_ENDPOINTS[family], providerSignal);
            const ipAddress = response && response.ip;
            if (!isAddressFamily(ipAddress, family)) {
                throw new Error(`The IPv${family} service returned an invalid address`);
            }
            return ipAddress;
        }
    ];

    if (family === 4) {
        providers.push(async (providerSignal) => {
            const response = await fetchJson(CHINA_IPV4_API_URL, providerSignal);
            const ipAddress = response && response.ret === 'ok' && response.data
                ? response.data.ip
                : '';
            if (!isAddressFamily(ipAddress, 4)) {
                throw new Error('The mainland IPv4 service returned an invalid address');
            }
            return ipAddress;
        });
    }

    return firstSuccessful(providers, signal, `IPv${family} address lookup`, timeout);
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

async function fetchGeoData(ipAddress, signal, timeout) {
    const fields = 'city,continent,subdivision,location';
    return firstSuccessful([
        async (providerSignal) => normalizeCountryResponse(await fetchJson(
            `${COUNTRY_API_URL}/${encodeURIComponent(ipAddress)}?fields=${fields}`,
            providerSignal
        )),
        async (providerSignal) => normalizeTaobaoResponse(await fetchJson(
            `${CHINA_GEO_API_URL}?ip=${encodeURIComponent(ipAddress)}&accessKey=alibaba-inc`,
            providerSignal
        ))
    ], signal, 'Geolocation lookup', timeout);
}

async function lookupGeoLocation(family, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const ipAddress = await fetchPublicIp(family, controller.signal, timeout);
        const geoLocation = await fetchGeoData(ipAddress, controller.signal, timeout);
        const result = emptyGeoLocationData();
        result.geoLocation = Object.assign({ ipAddress: ipAddress }, geoLocation);

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
