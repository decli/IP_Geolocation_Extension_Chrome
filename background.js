importScripts("js/constants.js");
importScripts("js/utils/LocalStorageProvider.js");
importScripts("js/utils/RefreshPolicy.js");
importScripts("js/models/GeoLocation.js");
importScripts("js/main.js");

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.method == "get") {
        chrome.storage.local.get(request.key, function (result) {
            sendResponse({ data: result[request.key] });
        });
        return true;
    } else if (request.method == "set") {
        let item = {};
        item[request.key] = request.value;
        chrome.storage.local.set(item, sendResponse);
        return true;
    } else if (request.method == "isSet") {
        chrome.storage.local.get(request.key, function (result) {
            sendResponse({ data: request.key in result });
        });
        return true;
    } else if (request.method == "remove") {
        chrome.storage.local.remove(request.key, sendResponse);
        return true;
    }
    return false;
});
