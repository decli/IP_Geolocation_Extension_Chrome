# Architecture

## Runtime components

- `background.js` loads the Manifest V3 service-worker scripts.
- `js/models/GeoLocation.js` discovers the public address and resolves its location.
- `js/main.js` schedules refreshes, sends IP-change notifications, and commits the toolbar badge.
- `js/utils/RefreshPolicy.js` contains the deterministic IPv4/IPv6 selection policy.
- `popup.html` and `options.html` provide the user interface and settings.

## Lookup pipeline

Each refresh starts IPv4 and IPv6 lookup promises in parallel.

IPv4 uses:

1. `api.ipify.org` for the public IPv4 address.
2. `myip.ipip.net/json` if the primary service is unavailable.
3. `api.country.is/{ip}` for geolocation.
4. `ip.taobao.com` if the primary geolocation service is unavailable.

IPv6 uses `api6.ipify.org`, then the same geolocation chain. The mainland geolocation fallback may not contain IPv6 records, so an unavailable IPv6 primary can still result in an IPv6 error.

Every provider response is checked for HTTP success, address family, and a two-letter country code. Provider attempts and the full lookup both have abortable timeouts.

## Badge commit policy

All results in one refresh are settled before the badge is updated. Exactly one badge update is permitted per refresh:

- `ipv4`: accept only the IPv4 result.
- `ipv6`: accept only the IPv6 result.
- `auto`: prefer IPv4, then IPv6.
- no acceptable result: display `ERR`.

There is no last-known-good display cache. A failed refresh therefore remains observable and cannot be hidden by a previous country code.

## Scheduling and concurrency

The original 3.55-second interval is retained. `refreshInFlight` coalesces overlapping triggers so a slow lookup never starts a second competing refresh. A one-minute `chrome.alarms` event is kept as a Manifest V3 service-worker wake-up fallback.

This removes the original race in which independent IPv4 and IPv6 callbacks shared `ipv4Error` and could write `US`, then overwrite it with a late `ERR` from another request generation.

## Storage and permissions

`chrome.storage.local` contains user preferences only. Required permissions:

- `notifications`: notify the user when a public IP changes.
- `storage`: save settings.
- `alarms`: wake the service worker.
- narrow host permissions for the documented IP and geolocation providers.

The extension has no content scripts and cannot read web page contents.
