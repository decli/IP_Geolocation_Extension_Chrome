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
- The source and generated manifests intentionally contain no fixed `key`. Chrome derives the unpacked extension ID from the local directory path.

## Build an optional signed CRX locally

The unpacked development build never uses a manifest `key`. A CRX gets its identity only from the private key used by Chrome when packaging it, and that identity is separate from the directory-derived development ID.

Generate a signing key and keep it outside the repository:

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

Never commit `extension.pem`. Reusing the same private key preserves the identity of future CRX packages, but it does not affect local unpacked builds.

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
