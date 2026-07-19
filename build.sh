#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DIR="$ROOT_DIR/dev"
BUILD_DIR="$ROOT_DIR/build"
DEFAULT_LOCAL_DIR="$ROOT_DIR/local-extension"
STAGING_DIR=""

cleanup() {
    if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
        rm -rf "$STAGING_DIR"
    fi
}

trap cleanup EXIT

prepareExtensionFunction() {
    STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ip-geolocation-extension.XXXXXX")"

    cp -R "$ROOT_DIR/css" "$STAGING_DIR/"
    cp -R "$ROOT_DIR/js" "$STAGING_DIR/"
    cp -R "$ROOT_DIR/img" "$STAGING_DIR/"
    cp "$ROOT_DIR/background.js" "$STAGING_DIR/"
    cp "$ROOT_DIR/manifest.json" "$STAGING_DIR/"
    cp "$ROOT_DIR/options.html" "$STAGING_DIR/"
    cp "$ROOT_DIR/popup.html" "$STAGING_DIR/"

    rm -f "$STAGING_DIR/img/icon_full.png"
    rm -f "$STAGING_DIR/img/LICENSE"
    rm -f "$STAGING_DIR/img/flags/Hello.txt"
    rm -f "$STAGING_DIR/img/flags/LICENSE.txt"
}

syncExtensionFunction() {
    local target_dir="$1"

    mkdir -p "$target_dir"
    # Keep manifest.json present throughout the update. Chrome may monitor an
    # unpacked extension directory while files are being refreshed.
    rsync -a --delete-after "$STAGING_DIR/" "$target_dir/"
}

prepareChromeFunction() {
    echo "Preparing manifest.json for Chrome"
}

prepareFirefoxFunction() {
    echo "Firefox is currently not supported. It uses a different manifest.json file. Use an older version of the extension for Firefox."
    exit 1
}

prepareOperaFunction() {
    echo "Preparing manifest.json for Opera"
    echo "Right now it is the same as Chrome, going for it..."
    prepareChromeFunction
}

prepareBrowserFunction() {
    case "$1" in
        chrome)
            prepareChromeFunction
            ;;
        opera)
            prepareOperaFunction
            ;;
        firefox)
            prepareFirefoxFunction
            ;;
        *)
            echo "Unsupported browser: $1" >&2
            exit 1
            ;;
    esac
}

usage() {
    echo ""
    echo "Usage:"
    echo "  $0 dev chrome"
    echo "  $0 install chrome [directory]"
    echo "  $0 package chrome"
    echo ""
    echo "  dev       Refreshes the disposable ./dev build output."
    echo "  install   Safely syncs a stable unpacked build to ./local-extension"
    echo "            (or the optional directory). Load this path in Chrome."
    echo "  package   Creates ./build/chrome.zip for distribution."
}

command_name="${1:-}"
browser_name="${2:-}"

if [ -z "$command_name" ] || [ -z "$browser_name" ]; then
    usage
    exit 1
fi

case "$command_name" in
    dev)
        echo "Building disposable development output..."
        prepareBrowserFunction "$browser_name"
        prepareExtensionFunction
        syncExtensionFunction "$DEV_DIR"
        echo "Done: $DEV_DIR"
        echo "For a persistent local Chrome installation, use: $0 install chrome"
        ;;
    install)
        if [ "$browser_name" != "chrome" ]; then
            echo "The stable local install target currently supports Chrome only." >&2
            exit 1
        fi

        local_dir="${3:-$DEFAULT_LOCAL_DIR}"
        if [[ "$local_dir" != /* ]]; then
            local_dir="$ROOT_DIR/$local_dir"
        fi

        echo "Preparing stable local Chrome installation..."
        prepareChromeFunction
        prepareExtensionFunction
        syncExtensionFunction "$local_dir"
        echo "Done: $local_dir"
        echo "Load this directory once from chrome://extensions and keep the path unchanged."
        ;;
    package)
        if [ "$browser_name" != "chrome" ]; then
            prepareBrowserFunction "$browser_name"
            echo "Packaging is currently supported for Chrome only." >&2
            exit 1
        fi

        echo "Building Chrome ZIP..."
        prepareChromeFunction
        prepareExtensionFunction
        mkdir -p "$BUILD_DIR"
        rm -f "$BUILD_DIR/chrome.zip"
        (cd "$STAGING_DIR" && zip -qr "$BUILD_DIR/chrome.zip" .)
        echo "Done: $BUILD_DIR/chrome.zip"
        ;;
    *)
        usage
        exit 1
        ;;
esac
