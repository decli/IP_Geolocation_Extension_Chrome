const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = {};
vm.createContext(context);
for (const script of ['js/constants.js', 'js/utils/RefreshPolicy.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
}
vm.runInContext(
    `globalThis.policy = {
        fulfilledLocation,
        selectBadgeLocation,
        shouldStartRefresh,
        evaluateBadgeCommit,
        shouldNotifyChange,
        emptyBadgeState,
        ADDRESS_SOURCE_PRIMARY,
        ADDRESS_SOURCE_FALLBACK
    };`,
    context
);
const {
    fulfilledLocation,
    selectBadgeLocation,
    shouldStartRefresh,
    evaluateBadgeCommit,
    shouldNotifyChange,
    emptyBadgeState,
    ADDRESS_SOURCE_PRIMARY,
    ADDRESS_SOURCE_FALLBACK
} = context.policy;

function primary(countryCode) {
    return { countryCode: countryCode, source: ADDRESS_SOURCE_PRIMARY };
}

function fallback(countryCode) {
    return { countryCode: countryCode, source: ADDRESS_SOURCE_FALLBACK };
}

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

test('a proxied reading reaches the toolbar without any confirmation delay', () => {
    const committed = evaluateBadgeCommit(emptyBadgeState(), primary('CN')).state;
    const decision = evaluateBadgeCommit(committed, primary('US'));

    assert.equal(decision.commit, true);
    assert.equal(decision.state.countryCode, 'US');
    assert.equal(decision.state.source, ADDRESS_SOURCE_PRIMARY);
});

test('one direct-route answer cannot flip a proxied country code', () => {
    const committed = evaluateBadgeCommit(emptyBadgeState(), primary('US')).state;
    const held = evaluateBadgeCommit(committed, fallback('CN'));

    assert.equal(held.commit, false);
    assert.equal(held.state.countryCode, 'US');
    assert.equal(held.state.pendingCountryCode, 'CN');

    const confirmed = evaluateBadgeCommit(held.state, fallback('CN'));
    assert.equal(confirmed.commit, true);
    assert.equal(confirmed.state.countryCode, 'CN');
    assert.equal(confirmed.state.pendingCountryCode, '');
});

test('a recovered primary immediately overrules a held direct-route answer', () => {
    const committed = evaluateBadgeCommit(emptyBadgeState(), primary('US')).state;
    const held = evaluateBadgeCommit(committed, fallback('CN'));
    const recovered = evaluateBadgeCommit(held.state, primary('US'));

    assert.equal(recovered.commit, true);
    assert.equal(recovered.state.countryCode, 'US');
    assert.equal(recovered.state.pendingCountryCode, '');
});

test('an alternating direct-route answer never accumulates a confirmation', () => {
    const committed = evaluateBadgeCommit(emptyBadgeState(), primary('US')).state;
    const first = evaluateBadgeCommit(committed, fallback('CN'));
    const second = evaluateBadgeCommit(first.state, fallback('HK'));

    assert.equal(second.commit, false);
    assert.equal(second.state.countryCode, 'US');
    assert.equal(second.state.pendingStreak, 1);
});

test('a direct-route answer is displayed at once when nothing is on the badge', () => {
    const decision = evaluateBadgeCommit(emptyBadgeState(), fallback('CN'));
    assert.equal(decision.commit, true);
    assert.equal(decision.state.countryCode, 'CN');
});

test('an outage is committed right away and clears the held state', () => {
    const committed = evaluateBadgeCommit(emptyBadgeState(), primary('US')).state;
    const held = evaluateBadgeCommit(committed, fallback('CN'));
    const outage = evaluateBadgeCommit(held.state, null);

    assert.equal(outage.commit, true);
    assert.deepEqual(outage.state, emptyBadgeState());
});

test('a change of provider chain is not reported as a moved public IP', () => {
    const proxied = { ipAddress: '38.175.104.157', source: ADDRESS_SOURCE_PRIMARY };
    const direct = { ipAddress: '1.2.3.4', source: ADDRESS_SOURCE_FALLBACK };

    assert.equal(shouldNotifyChange(proxied, direct), false);
    assert.equal(shouldNotifyChange(direct, proxied), false);
});

test('a real address change on the same provider chain is reported once', () => {
    const before = { ipAddress: '38.175.104.157', source: ADDRESS_SOURCE_PRIMARY };
    const after = { ipAddress: '104.28.246.77', source: ADDRESS_SOURCE_PRIMARY };

    assert.equal(shouldNotifyChange(before, after), true);
    assert.equal(shouldNotifyChange(after, after), false);
    assert.equal(shouldNotifyChange(null, after), false);
});

test('the refresh throttle admits a first run and anything past the interval', () => {
    assert.equal(shouldStartRefresh(0, 10_000, 3000), true);
    assert.equal(shouldStartRefresh(undefined, 10_000, 3000), true);
    assert.equal(shouldStartRefresh(9000, 10_000, 3000), false);
    assert.equal(shouldStartRefresh(7000, 10_000, 3000), true);
    assert.equal(shouldStartRefresh(11_000, 10_000, 3000), true);
});
