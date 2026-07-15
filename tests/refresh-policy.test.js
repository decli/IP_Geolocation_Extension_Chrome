const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'utils', 'RefreshPolicy.js'),
    'utf8'
);
const context = {};
vm.createContext(context);
vm.runInContext(
    `${source}\nglobalThis.policy = { fulfilledLocation, selectBadgeLocation };`,
    context
);
const { fulfilledLocation, selectBadgeLocation } = context.policy;

test('auto mode deterministically prefers IPv4 when both succeed', () => {
    const ipv4 = { name: 'ipv4' };
    const ipv6 = { name: 'ipv6' };
    const selected = selectBadgeLocation('auto', ipv4, ipv6);
    assert.equal(selected.geoLocation, ipv4);
    assert.equal(selected.family, 4);
});

test('auto mode falls back to IPv6 only when IPv4 failed', () => {
    const ipv6 = { name: 'ipv6' };
    const selected = selectBadgeLocation('auto', null, ipv6);
    assert.equal(selected.geoLocation, ipv6);
    assert.equal(selected.family, 6);
});

test('explicit family mode never displays the other family', () => {
    const ipv4 = { name: 'ipv4' };
    const ipv6 = { name: 'ipv6' };
    assert.equal(selectBadgeLocation('ipv4', null, ipv6), null);
    assert.equal(selectBadgeLocation('ipv6', ipv4, null), null);
});

test('only fulfilled requests are eligible for an atomic badge update', () => {
    const value = { name: 'location' };
    assert.equal(fulfilledLocation({ status: 'fulfilled', value: value }), value);
    assert.equal(fulfilledLocation({ status: 'rejected', reason: new Error('late failure') }), null);
});
