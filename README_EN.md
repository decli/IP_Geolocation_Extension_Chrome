# IP Geolocation Extension for Chrome

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

[![CI](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/ci.yml)
[![CodeQL](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/codeql-analysis.yml)
[![Release](https://img.shields.io/github/v/release/decli/IP_Geolocation_Extension_Chrome)](https://github.com/decli/IP_Geolocation_Extension_Chrome/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A Chrome/Chromium extension that monitors your public IPv4, IPv6, and IP geolocation. The toolbar icon displays the country code of the current outbound connection, making proxy, VPN, and public IP changes immediately visible.

## Features

- Displays the outbound country code and flag directly in the toolbar.
- Detects both IPv4 and IPv6. Auto mode prefers IPv4 and falls back to IPv6.
- Preserves the original approximately 3.55-second detection interval and IP-change notifications.
- Displays `ERR` immediately when a lookup genuinely fails instead of hiding an outage behind stale cached data.
- Prevents overlapping requests and asynchronous races, so an older request cannot overwrite a newer result.
- Uses mainland-accessible fallback services when overseas endpoints are unavailable, including Clash DIRECT scenarios.
- Uses Manifest V3 and requests only notifications, storage, alarms, and access to the required API hosts.

## Installation

### Install from a Release (recommended)

1. Open [Releases](https://github.com/decli/IP_Geolocation_Extension_Chrome/releases) and download the latest ZIP.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the extracted directory.

Each Release also includes a signed CRX. Some stable Chrome builds restrict direct installation of CRX files distributed outside the Chrome Web Store. If installation is blocked, use the unpacked ZIP method above. The CRX is primarily useful for Chromium, enterprise policy deployment, or environments that require a stable extension ID.

### Install from source

```bash
bash build.sh dev chrome
```

Then load the project's `dev/` directory from `chrome://extensions`.

## Status semantics

| Mode | IPv4 | IPv6 | Toolbar status |
|---|---|---|---|
| Auto | Success | Any | IPv4 country code |
| Auto | Failure | Success | IPv6 country code |
| Auto | Failure | Failure | `ERR` |
| IPv4 | Failure | Any | `ERR` |
| IPv6 | Any | Failure | `ERR` |

The extension never substitutes the “last successful country” for a failed lookup. `ERR` therefore always means that the current detection round could not obtain a valid result for the selected address family.

## Network services and privacy

The extension must contact external services to observe the public outbound IP. It uses the following lookup chain:

| Purpose | Primary service | Mainland fallback |
|---|---|---|
| Public IPv4 address | [ipify](https://www.ipify.org/) | [IPIP](https://www.ipip.net/) |
| Public IPv6 address | [ipify IPv6](https://www.ipify.org/) | — |
| IP geolocation | [Country.is](https://country.is/) | Taobao IP database |

These services can see the public IP associated with each request. The extension itself does not create user accounts, upload browsing history, or operate a remote server. In Clash Rule mode, different hostnames may follow different routing rules; the fallback chain prevents a DIRECT connection from being mistaken for an outage merely because an overseas API is unavailable.

## Development and builds

```bash
npm test
npm run check
bash build.sh package chrome
```

The ZIP is generated at `build/chrome.zip`. See [docs/BUILDING.md](docs/BUILDING.md) for detailed build instructions and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime design.

## Project structure

```text
background.js                 Service worker entry point
js/main.js                    Scheduling, status commits, notifications
js/models/GeoLocation.js      IP/Geo providers and fallback chain
js/utils/RefreshPolicy.js     IPv4/IPv6 selection policy
tests/                        Node.js automated tests
.github/workflows/            CI, CodeQL, and Release builds
```

## Acknowledgements

This project is based on the open-source project [AykutCevik/Geolocate-IP-Browser-Extension](https://github.com/AykutCevik/Geolocate-IP-Browser-Extension), created by **Aykut Çevik**. Thank you to the original author for maintaining the Chrome, Firefox, Opera, and Edge versions and for providing the complete UI, icons, and foundational implementation.

This repository is an independently maintained derivative and is not an official release by the original author. Both the original project and this derivative are licensed under the GNU General Public License v3.0.

## Contributing

Run the tests and syntax checks before submitting code. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines. Version changes are documented exclusively on the GitHub Release page.

## License

[GNU General Public License v3.0](LICENSE)
