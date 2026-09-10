const KEY_SETTINGS_NOTIFICATION = 'notifications_enabled';
const KEY_SETTINGS_NOTIFICATION_IPv6 = 'notifications_ipv6_enabled';
const KEY_SETTINGS_COUNTRY_BADGE = 'country_badge_indicator';
const KEY_SETTINGS_SHOW_FLAGS = 'badge_show_flags';
const KEY_SETTINGS_SHOW_TEXT = 'badge_show_text';

// Which provider chain produced an address. The distinction matters because
// the two chains do not measure the same route: the primary providers live on
// domains a proxy rule set treats as foreign, so they report the proxied exit
// address, while the mainland fallback is reachable directly and therefore
// reports the address of the unproxied connection.
const ADDRESS_SOURCE_PRIMARY = 'primary';
const ADDRESS_SOURCE_FALLBACK = 'fallback';
