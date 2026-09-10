// Ephemeral state that has to outlive the service worker.
//
// A Manifest V3 service worker is stopped whenever it goes idle and starts again
// from empty globals. Keeping the last observed addresses only in memory meant
// the first refresh after every restart looked like a first observation, so a
// public IP that changed while the worker was stopped never produced a
// notification, and the badge was reset to its "checking" state on every wake.
// Session storage keeps this state for the lifetime of the browser session
// without turning it into a persisted user setting.
const RUNTIME_STATE_KEY = 'runtime_state';

function runtimeStateArea() {
    if (typeof chrome === 'undefined' || !chrome.storage) return null;
    return chrome.storage.session || chrome.storage.local || null;
}

function createRuntimeState() {
    return { ipv4: null, ipv6: null, badge: emptyBadgeState(), lastRefreshAt: 0 };
}

function readRuntimeState() {
    return new Promise((resolve) => {
        const area = runtimeStateArea();
        if (!area) {
            resolve(createRuntimeState());
            return;
        }

        area.get(RUNTIME_STATE_KEY, (result) => {
            const stored = result ? result[RUNTIME_STATE_KEY] : null;
            resolve(stored && typeof stored === 'object'
                ? Object.assign(createRuntimeState(), stored)
                : createRuntimeState());
        });
    });
}

function writeRuntimeState(state) {
    return new Promise((resolve) => {
        const area = runtimeStateArea();
        if (!area) {
            resolve();
            return;
        }

        const item = {};
        item[RUNTIME_STATE_KEY] = state;
        area.set(item, () => resolve());
    });
}
