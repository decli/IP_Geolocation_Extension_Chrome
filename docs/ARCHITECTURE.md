# Architecture

## Runtime components

- `background.js` loads the Manifest V3 service-worker scripts.
- `js/models/GeoLocation.js` discovers the public address and resolves its location.
- `js/main.js` schedules refreshes, sends IP-change notifications, and commits the toolbar badge.
- `js/utils/RefreshPolicy.js` contains the deterministic selection, throttling and commit policy.
- `js/utils/RuntimeState.js` keeps the observed state across service-worker restarts.
- `popup.html` and `options.html` provide the user interface and settings.

## Lookup pipeline

Each refresh starts IPv4 and IPv6 lookup promises in parallel.

IPv4 uses:

1. `api.ipify.org` for the public IPv4 address.
2. `ipv4.icanhazip.com` if the first service is unavailable.
3. `myip.ipip.net/json` if both international services are unavailable.
4. `api.country.is/{ip}` for geolocation.
5. `ip.taobao.com` if the primary geolocation service is unavailable.

IPv6 uses `api6.ipify.org`, then `ipv6.icanhazip.com`, then the same geolocation chain. The mainland geolocation fallback may not contain IPv6 records, so an unavailable IPv6 primary can still result in an IPv6 error.

Every provider response is checked for HTTP success, address family, and a two-letter country code. Provider attempts and the full lookup both have abortable timeouts, and a lookup stops early when its deadline has passed.

## Address sources

The two address chains do not measure the same route. The international providers sit on domains that a rule-based proxy treats as foreign, so they report the proxied exit address - the address the badge is meant to show. The mainland provider is reachable without a proxy, so it reports the address of the direct connection. Every reading therefore carries the source that produced it (`primary` or `fallback`). That source is what the badge and notification policies reason about, and both the badge tooltip and the popup name it, so a country code is never shown without the route it describes.

The attempt budget for the primary provider is generous on purpose. A request through a proxy regularly needs more than a second, and considerably more while a freshly enabled tunnel is still cold. A short budget makes the direct-route fallback answer instead, which is how a proxied exit address ends up not being displayed at all.

## Badge commit policy

All results in one refresh are settled before the badge is updated. Exactly one badge update is permitted per refresh:

- `ipv4`: accept only the IPv4 result.
- `ipv6`: accept only the IPv6 result.
- `auto`: prefer IPv4, then IPv6.
- no acceptable result: display `ERR`.

A reading from the primary chain is committed immediately, so a proxy switch reaches the toolbar as soon as it is observed. A country change that only the direct-route fallback reports has to repeat once before it is committed, so a single outage of the international providers cannot flip the badge to the country of the unproxied connection. A recovered primary reading overrules a held change at once.

There is no last-known-good display cache. A failed refresh therefore remains observable and cannot be hidden by a previous country code.

## Change notifications

A notification is sent when the address of one family changes between two readings that came from the same provider chain. A difference across a chain switch describes two different routes rather than a moved public IP, so it is recorded without notifying.

## Scheduling and concurrency

A Manifest V3 service worker is stopped whenever it goes idle, so an in-worker interval cannot be the only schedule: while the worker is stopped nothing is polled at all. The refresh is therefore driven from four places:

- the original 3.55-second interval, for as long as the worker is running;
- browsing events (`tabs.onActivated`, `tabs.onUpdated`, `windows.onFocusChanged`) and the `online` event, which restart a stopped worker at the moment the user does something that can involve a different exit address;
- opening the popup, which asks the worker for a refresh;
- a one-minute `chrome.alarms` event as the floor for a completely idle browser, which also repairs a lost alarm and a missing interval.

`refreshInFlight` coalesces overlapping triggers so a slow lookup never starts a second competing refresh, and event-driven triggers additionally pass a throttle so that browsing cannot produce more requests than the interval already does.

This removes the original race in which independent IPv4 and IPv6 callbacks shared `ipv4Error` and could write `US`, then overwrite it with a late `ERR` from another request generation.

## Storage and permissions

`chrome.storage.local` contains user preferences only. `chrome.storage.session` holds the observed addresses, the committed badge state and the last refresh timestamp: without them a restarted worker treats every first reading as a first observation, which loses the notification for an address that changed while the worker was stopped and repaints a known badge as `...`. Required permissions:

- `notifications`: notify the user when a public IP changes.
- `storage`: save settings and the state that has to survive a worker restart.
- `alarms`: wake the service worker.
- narrow host permissions for the documented IP and geolocation providers.

The extension has no content scripts and cannot read web page contents. `chrome.tabs` and `chrome.windows` events are used only as wake-up signals; the extension requests no tab permissions and therefore receives no URLs or page titles with them.
