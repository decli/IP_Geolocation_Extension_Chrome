let geoIpV4 = null;
let geoIpV6 = null;
let ipv4IsFetching = true;
let ipv6IsFetching = true;

function reloadPopup() {
    window.location.reload();
}

function handleError() {
    if (geoIpV4 == null && geoIpV6 == null && !ipv4IsFetching && !ipv6IsFetching) {
        setStatus('lookupStatus', 'The IP address lookup failed. Check your connection and try again.');
    }
}

function setStatus(id, message) {
    const element = document.getElementById(id);
    element.textContent = message;
    element.hidden = !message;
    document.getElementById('popupStatus').hidden =
        document.getElementById('lookupStatus').hidden && document.getElementById('toolbarStatus').hidden;
}

function fetchGeoLocation() {
    let geoLocate = new GeoLocation();
    geoLocate.fetch({
        success: function () {
            geoIpV4 = geoLocate;
            ipv4IsFetching = false;
            triggerView();
        },
        error: function () {
            //geoIpV4 = null;
            ipv4IsFetching = false;
            handleError();
        }
    });

    let geoLocate6 = new GeoLocation6();
    geoLocate6.fetch({
        success: function () {
            geoIpV6 = geoLocate6;
            ipv6IsFetching = false;
            triggerView();
        },
        error: function () {
            //geoIpV6 = null;
            ipv6IsFetching = false;
            handleError();
        }
    });
}

// The two provider chains do not observe the same route: the international
// services report the address a proxied request leaves from, the mainland
// service reports the address of the direct connection. A reading is only
// meaningful together with the chain that produced it.
const SOURCE_NOTES = {
    [ADDRESS_SOURCE_PRIMARY]: 'As seen by overseas services',
    [ADDRESS_SOURCE_FALLBACK]: 'As seen by mainland services (overseas services unavailable)'
};

function withSourceNote(geoLocation) {
    return Object.assign({}, geoLocation, {
        sourceNote: geoLocation.ipAddress ? (SOURCE_NOTES[geoLocation.source] || '') : ''
    });
}

function compileHtml(html, obj, clip) {
    for (let prop in obj) {
        html = html.replace(new RegExp(clip + prop + clip, 'g'), obj[prop] ? obj[prop] : '');
    }
    return html;
}

function triggerView() {
    let infosHtml = document.getElementById('ipGeoLocationView').innerHTML;
    let gIPv4 = (geoIpV4 ? geoIpV4.toJSON() : new GeoLocation().toJSON());
    let gIPv6 = (geoIpV6 ? geoIpV6.toJSON() : new GeoLocation6().toJSON());
    compiledInfosHtml = compileHtml(infosHtml, withSourceNote(gIPv4.geoLocation), 'T');
    compiledInfosHtml = compileHtml(compiledInfosHtml, gIPv4.browser, 'T');
    compiledInfosHtml = compileHtml(compiledInfosHtml, withSourceNote(gIPv6.geoLocation), 'T6');
    compiledInfosHtml = compileHtml(compiledInfosHtml, gIPv6.browser, 'T6');
    document.getElementById('ipLocationInfo').innerHTML = compiledInfosHtml;

    if (geoIpV4 && geoIpV4.toJSON().geoLocation && geoIpV4.toJSON().geoLocation.latitude != 0) {
        let mapHtml = document.getElementById('ipGeoMapView').innerHTML;
        compiledMapHtml = compileHtml(mapHtml, geoIpV4.toJSON().geoLocation, 'T');
        document.getElementById('mapIPV4').innerHTML = compiledMapHtml;
    }

    if (geoIpV6 && geoIpV6.toJSON().geoLocation && geoIpV6.toJSON().geoLocation.latitude != 0) {
        let mapHtml = document.getElementById('ipGeoMapView').innerHTML;
        compiledMapHtml = compileHtml(mapHtml, geoIpV6.toJSON().geoLocation, 'T');
        document.getElementById('mapIPV6').innerHTML = compiledMapHtml;
    }
}

function requestBackgroundRefresh() {
    // The toolbar badge is owned by the service worker, which may have been
    // stopped for a while. Opening the popup is the clearest signal that the
    // user wants the current state, so the worker is woken up for a refresh
    // instead of leaving a stale country code next to a fresh popup.
    const failureMessage = 'The toolbar could not update. Try again or check extension settings.';
    if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        setStatus('toolbarStatus', failureMessage);
        return;
    }
    try {
        chrome.runtime.sendMessage({ method: 'refresh' }, function (response) {
            const transportError = chrome.runtime.lastError;
            if (transportError || !response || response.error || !response.data) {
                console.error('[IP Geolocation] Toolbar refresh failed:', transportError || response);
                setStatus('toolbarStatus', failureMessage);
            } else if (!response.data.ok) {
                setStatus('toolbarStatus', 'The toolbar could not locate the selected IP version. Try Auto or IPv4 in settings.');
            } else if (response.data.display && !response.data.display.showFlags && !response.data.display.showText) {
                setStatus('toolbarStatus', 'Country flags and country badges are both turned off. Enable them in settings to show your country.');
            } else {
                setStatus('toolbarStatus', '');
            }
        });
    } catch (error) {
        console.error('[IP Geolocation] Toolbar refresh failed:', error);
        setStatus('toolbarStatus', failureMessage);
    }
}

window.addEventListener("load", function () {
    document.getElementById('retryLookup').addEventListener('click', reloadPopup);
    fetchGeoLocation();
    requestBackgroundRefresh();
});
