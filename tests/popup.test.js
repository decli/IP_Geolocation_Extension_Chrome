const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = {
    chrome: { runtime: {} },
    document: {},
    window: { addEventListener: () => { } }
};
vm.createContext(context);
for (const script of ['js/constants.js', 'js/models/GeoLocation.js', 'js/popup.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
}
vm.runInContext('globalThis.popup = { withSourceNote };', context);
const { withSourceNote } = context.popup;

test('the popup names the route an address was observed from', () => {
    const overseas = withSourceNote({ ipAddress: '38.175.104.157', source: 'primary' });
    const mainland = withSourceNote({ ipAddress: '1.2.3.4', source: 'fallback' });

    assert.match(overseas.sourceNote, /overseas services/);
    assert.match(mainland.sourceNote, /mainland services/);
    assert.equal(overseas.ipAddress, '38.175.104.157');
});

test('an empty reading carries no source claim', () => {
    assert.equal(withSourceNote({ ipAddress: '', source: '' }).sourceNote, '');
    assert.equal(withSourceNote({ ipAddress: '1.2.3.4', source: '' }).sourceNote, '');
});

test('the popup template renders the source of both address families', () => {
    const markup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

    assert.ok(markup.includes('TsourceNoteT'));
    assert.ok(markup.includes('T6sourceNoteT6'));
});

function loadPopup(sendMessage) {
    const elements = Object.fromEntries(['popupStatus', 'lookupStatus', 'toolbarStatus'].map((id) => [
        id, { hidden: true, textContent: '' }
    ]));
    const errors = [];
    const browser = { runtime: { sendMessage } };
    const sandbox = {
        chrome: browser,
        console: { error: (...args) => errors.push(args) },
        document: { getElementById: (id) => elements[id] },
        window: { addEventListener: () => { } }
    };
    vm.createContext(sandbox);
    for (const script of ['js/constants.js', 'js/popup.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), sandbox);
    }
    return { sandbox, browser, elements, errors };
}

test('the popup makes both communication and background rendering failures visible', () => {
    for (const response of [undefined, { error: 'Cannot load flag' }, {}]) {
        const { sandbox, elements, errors } = loadPopup((request, callback) => callback(response));
        sandbox.requestBackgroundRefresh();
        assert.equal(elements.popupStatus.hidden, false);
        assert.match(elements.toolbarStatus.textContent, /toolbar could not update/);
        assert.equal(errors.length, 1);
    }
    const transport = loadPopup((request, callback) => {
        transport.browser.runtime.lastError = { message: 'Receiving end does not exist' };
        callback();
        delete transport.browser.runtime.lastError;
    });
    transport.sandbox.requestBackgroundRefresh();
    assert.equal(transport.elements.popupStatus.hidden, false);

    const disconnected = loadPopup(() => { throw new Error('Extension context invalidated'); });
    disconnected.sandbox.requestBackgroundRefresh();
    assert.equal(disconnected.elements.popupStatus.hidden, false);
});

test('the popup explains hidden country indicators and selected-family lookup failure', () => {
    let data = { ok: true, display: { showFlags: false, showText: false } };
    const { sandbox, elements } = loadPopup((request, callback) => callback({ data }));
    sandbox.requestBackgroundRefresh();
    assert.match(elements.toolbarStatus.textContent, /both turned off/);
    data = { ok: false };
    sandbox.requestBackgroundRefresh();
    assert.match(elements.toolbarStatus.textContent, /selected IP version/);
    data = { ok: true, display: { showFlags: true, showText: false } };
    sandbox.requestBackgroundRefresh();
    assert.equal(elements.popupStatus.hidden, true);
});

test('lookup failure remains visible after a successful toolbar reply without MaterialSnackbar', () => {
    const { sandbox, elements } = loadPopup((request, callback) => callback({ data: { ok: true } }));
    vm.runInContext('ipv4IsFetching = false; ipv6IsFetching = false; handleError();', sandbox);
    sandbox.requestBackgroundRefresh();
    assert.equal(elements.popupStatus.hidden, false);
    assert.match(elements.lookupStatus.textContent, /lookup failed/);
    assert.equal(elements.toolbarStatus.hidden, true);
});
