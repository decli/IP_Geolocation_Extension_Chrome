# Building and releasing

## Requirements

- Node.js 20 or newer
- Bash
- `rsync`, `zip`, and `unzip`
- Google Chrome/Chromium and OpenSSL for CRX packaging

No npm dependencies are required.

## Validate

```bash
npm test
npm run check
```

## Build a stable local extension, disposable development output, and ZIP

```bash
bash build.sh install chrome
bash build.sh dev chrome
bash build.sh package chrome
unzip -t build/chrome.zip
```

- Load `local-extension/` from `chrome://extensions` for a persistent local installation.
- Treat `dev/` as disposable build output; do not use it as Chrome's long-lived loaded path.
- Distribute `build/chrome.zip` for manual unpacked installation.
- The source and generated manifests intentionally contain no fixed `key`. Chrome derives the unpacked extension ID from the local directory path.

The `install` command stages a complete build and then synchronizes it into the stable directory without deleting that directory first. This keeps `manifest.json` present while Chrome is running. To use another permanent path, pass it as the third argument:

```bash
bash build.sh install chrome /absolute/permanent/path
```

Keep the chosen path unchanged. If a previous keyed and keyless build shared another path, do not reuse that contaminated path and do not edit Chrome's protected preference files manually.

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
