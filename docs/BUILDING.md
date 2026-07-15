# Building and releasing

## Requirements

- Node.js 20 or newer
- Bash
- `zip` and `unzip`
- Google Chrome/Chromium and OpenSSL for CRX packaging

No npm dependencies are required.

## Validate

```bash
npm test
npm run check
```

## Build an unpacked extension and ZIP

```bash
bash build.sh dev chrome
bash build.sh package chrome
unzip -t build/chrome.zip
```

- Load `dev/` from `chrome://extensions` for development.
- Distribute `build/chrome.zip` for manual unpacked installation.

## Build a signed CRX locally

The manifest pins the signing public key, so unpacked builds and Release CRX files use the same extension ID: `klcnhnfofdgppmjgjpghcpkbjbdacjmk`.

Release maintainers must use the private key corresponding to the public `key` in `manifest.json`. Keep that private key outside the repository. The following command is only for starting a new fork with a new identity; after generating it, update the manifest public key and documented extension ID as well:

```bash
openssl genrsa -out extension.pem 2048
```

Build `dev/`, then use Chrome's extension packer:

```bash
bash build.sh dev chrome
google-chrome \
  --pack-extension="$PWD/dev" \
  --pack-extension-key="$PWD/extension.pem"
```

On macOS, the Chrome executable is normally:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

Never commit `extension.pem`. A CRX signed with an unrelated key does not retain this project's extension ID, and losing the release key prevents future CRX releases from retaining it.

## GitHub Release workflow

`.github/workflows/release.yml` runs for tags matching `v*` and:

1. runs all tests and syntax checks;
2. builds the ZIP;
3. decodes `CRX_PRIVATE_KEY_BASE64` into an ephemeral runner file;
4. packs a signed CRX with Chrome;
5. generates SHA-256 checksums;
6. creates or updates the GitHub Release and uploads all assets.

The repository secret contains base64-encoded PEM data. To configure another repository:

```bash
base64 < extension.pem | tr -d '\n' | gh secret set CRX_PRIVATE_KEY_BASE64
```

Release notes are maintained on the GitHub Release page. Do not add a changelog section to README.
