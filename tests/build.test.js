const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("stable local install produces a clean keyless Chrome extension", () => {
    const repositoryRoot = path.join(__dirname, "..");
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ip-geolocation-install-"));
    const installDirectory = path.join(temporaryRoot, "stable-extension");

    try {
        fs.mkdirSync(installDirectory, { recursive: true });
        fs.writeFileSync(path.join(installDirectory, "obsolete-file.txt"), "remove me");

        childProcess.execFileSync(
            "bash",
            [path.join(repositoryRoot, "build.sh"), "install", "chrome", installDirectory],
            { cwd: repositoryRoot, stdio: "pipe" },
        );

        const manifest = JSON.parse(
            fs.readFileSync(path.join(installDirectory, "manifest.json"), "utf8"),
        );

        assert.equal(Object.hasOwn(manifest, "key"), false);
        assert.equal(manifest.manifest_version, 3);
        assert.equal(fs.existsSync(path.join(installDirectory, "background.js")), true);
        assert.equal(fs.existsSync(path.join(installDirectory, "img", "icon_full.png")), false);
        assert.equal(fs.existsSync(path.join(installDirectory, "obsolete-file.txt")), false);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
