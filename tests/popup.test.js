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
