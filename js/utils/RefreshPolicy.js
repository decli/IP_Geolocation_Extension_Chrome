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
