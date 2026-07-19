const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("the source manifest does not force an unpacked extension ID", () => {
    const manifestPath = path.join(__dirname, "..", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assert.equal(Object.hasOwn(manifest, "key"), false);
});

test("the package and extension manifest versions stay in sync", () => {
    const manifestPath = path.join(__dirname, "..", "manifest.json");
    const packagePath = path.join(__dirname, "..", "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));

    assert.equal(manifest.version, packageMetadata.version);
});
