import {afterEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {readFileSnapshotAsync, writeFileAsync} from "../../src/electron/preload/api/filesystem";


const createdDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(createdDirectories.splice(0).map(directory => fs.rm(directory, {force: true, recursive: true})));
});

describe("preload filesystem", () => {
    test("readFileSnapshotAsync returns the disk source used by enabled addons", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "betterdiscord-filesystem-"));
        createdDirectories.push(directory);

        const filename = path.join(directory, "loaded.plugin.js");
        await fs.writeFile(filename, "\uFEFF/** loaded addon */");
        const snapshot = await readFileSnapshotAsync(filename);

        expect(snapshot.fileContent).toBe("/** loaded addon */");
        expect(snapshot.modified).toBe((await fs.stat(filename)).mtimeMs);
    });

    test("writeFileAsync settles after the file is written", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "betterdiscord-filesystem-"));
        createdDirectories.push(directory);

        const filename = path.join(directory, "addon.plugin.js");
        await fs.writeFile(filename, "old source");
        const original = await fs.stat(filename);
        await writeFileAsync(filename, "module.exports = {};", {
            modified: original.mtimeMs,
            fileContent: "old source"
        });

        expect(await fs.readFile(filename, "utf8")).toBe("module.exports = {};");
        expect((await fs.readdir(directory)).filter(entry => entry.includes(".bd-update-"))).toEqual([]);
    });

    test("writeFileAsync preserves a file changed before replacement", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "betterdiscord-filesystem-"));
        createdDirectories.push(directory);

        const filename = path.join(directory, "changed.plugin.js");
        await fs.writeFile(filename, "new local source");
        const current = await fs.stat(filename);
        await expect(writeFileAsync(filename, "remote update", {
            modified: current.mtimeMs,
            fileContent: "stale local source"
        })).rejects.toThrow("changed before the atomic replacement");

        expect(await fs.readFile(filename, "utf8")).toBe("new local source");
        expect((await fs.readdir(directory)).filter(entry => entry.includes(".bd-update-"))).toEqual([]);
    });

    test("writeFileAsync rejects filesystem failures", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "betterdiscord-filesystem-"));
        createdDirectories.push(directory);

        const filename = path.join(directory, "missing", "addon.plugin.js");
        await expect(writeFileAsync(filename, "module.exports = {};")).rejects.toThrow();
    });
});
