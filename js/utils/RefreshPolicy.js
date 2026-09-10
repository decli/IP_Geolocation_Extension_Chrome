// Minimum distance between two network refreshes. Browsing events can arrive
// in bursts, so they are throttled down to roughly the polling cadence.
const MIN_REFRESH_INTERVAL_MS = 3000;

// How often a fallback reading has to repeat before it may change the badge.
const FALLBACK_CONFIRMATIONS = 2;

function fulfilledLocation(result) {
    return result.status === 'fulfilled' ? result.value : null;
}

function selectBadgeLocation(indicator, ipv4, ipv6) {
    if (indicator === 'ipv4') return ipv4 ? { geoLocation: ipv4, family: 4 } : null;
    if (indicator === 'ipv6') return ipv6 ? { geoLocation: ipv6, family: 6 } : null;
    if (ipv4) return { geoLocation: ipv4, family: 4 };
    if (ipv6) return { geoLocation: ipv6, family: 6 };
    return null;
}

function shouldStartRefresh(lastStartedAt, now, minimumIntervalMs) {
    const previous = Number(lastStartedAt);
    if (!Number.isFinite(previous) || previous <= 0) return true;
    if (previous > now) return true;
    return now - previous >= minimumIntervalMs;
}

function emptyBadgeState() {
    return { countryCode: '', source: '', pendingCountryCode: '', pendingStreak: 0 };
}

function normalizeBadgeState(state) {
    if (!state || typeof state !== 'object') return emptyBadgeState();
    return {
        countryCode: typeof state.countryCode === 'string' ? state.countryCode : '',
        source: typeof state.source === 'string' ? state.source : '',
        pendingCountryCode: typeof state.pendingCountryCode === 'string' ? state.pendingCountryCode : '',
        pendingStreak: Number.isFinite(state.pendingStreak) ? state.pendingStreak : 0
    };
}

function committedBadgeState(candidate) {
    return {
        countryCode: candidate.countryCode,
        source: candidate.source || '',
        pendingCountryCode: '',
        pendingStreak: 0
    };
}

// Decides whether a finished refresh is allowed to repaint the toolbar.
//
// A reading from the primary chain always wins immediately: it is the proxied
// exit address, which is exactly what the badge is supposed to show, so a proxy
// switch appears on the toolbar as soon as it is observed. A reading that only
// the mainland fallback produced describes the direct connection instead, so a
// single primary outage must not be able to flip the badge to the country of
// the unproxied route. Such a change is held until a second consecutive refresh
// agrees with it. A refresh without any usable reading still commits right
// away, so an outage is never hidden behind a stale country code.
function evaluateBadgeCommit(state, candidate) {
    const current = normalizeBadgeState(state);

    if (!candidate || !/^[A-Z]{2}$/.test(candidate.countryCode || '')) {
        return { commit: true, state: emptyBadgeState() };
    }

    const trusted = candidate.source !== ADDRESS_SOURCE_FALLBACK;
    if (trusted || !current.countryCode || candidate.countryCode === current.countryCode) {
        return { commit: true, state: committedBadgeState(candidate) };
    }

    const streak = current.pendingCountryCode === candidate.countryCode
        ? current.pendingStreak + 1
        : 1;

    if (streak < FALLBACK_CONFIRMATIONS) {
        return {
            commit: false,
            state: {
                countryCode: current.countryCode,
                source: current.source,
                pendingCountryCode: candidate.countryCode,
                pendingStreak: streak
            }
        };
    }

    return { commit: true, state: committedBadgeState(candidate) };
}

// A change of provider chain changes which route is being measured, so the two
// addresses describe different connections rather than a moved public IP.
// Notifying about that difference is what makes an unstable provider look like
// an endless stream of address changes.
function shouldNotifyChange(previous, current) {
    if (!previous || !current) return false;
    if (!previous.ipAddress || !current.ipAddress) return false;
    if (previous.source !== current.source) return false;
    return previous.ipAddress !== current.ipAddress;
}
