import * as fs from "fs";
import nodePath from "path";
import {clone} from "@common/utils";
import Logger from "@common/logger";
import {wrapFunction} from "@common/utils/clone";

export const readDirectory = wrapFunction(fs.readdirSync);
export const createDirectory = wrapFunction(fs.mkdirSync);
export const deleteDirectory = wrapFunction(fs.rmdirSync);
export const exists = wrapFunction(fs.existsSync);
export const getRealPath = wrapFunction(fs.realpathSync);
export const renameSync = wrapFunction(fs.renameSync);
export const rmSync = wrapFunction(fs.rmSync);
export const unlinkSync = wrapFunction(fs.unlinkSync);

export function readFile(path: fs.PathOrFileDescriptor, options: Parameters<typeof fs.readFileSync>[1] = "utf-8") {
    return fs.readFileSync(path, options);
}

export function writeFile(path: fs.PathOrFileDescriptor, content: string | Uint8Array, options?: fs.WriteFileOptions & {originalFs: boolean;}) {
    if (content instanceof Uint8Array) {
        content = Buffer.from(content);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const doWriteFile = options?.originalFs ? require("original-fs").writeFileSync : fs.writeFileSync;

    return doWriteFile(path, content, options);
}

let updaterWriteSequence = 0;

interface ExpectedAddonFile {
    modified: number;
    fileContent: string;
}

function addonFileChangedError() {
    const error = new Error("The installed addon changed before the atomic replacement.");
    error.name = "AddonFileChangedError";
    return error;
}

// Addon managers discard `fileContent` after enabled addons initialize. Give the updater one
// private asynchronous snapshot path without changing the public renderer fs polyfill.
export async function readFileSnapshotAsync(filePath: string): Promise<ExpectedAddonFile> {
    const before = await fs.promises.stat(filePath);
    const currentBytes = await fs.promises.readFile(filePath, "utf8");
    const after = await fs.promises.stat(filePath);

    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw addonFileChangedError();

    return {
        modified: after.mtimeMs,
        fileContent: currentBytes.charCodeAt(0) === 0xFEFF ? currentBytes.slice(1) : currentBytes
    };
}

// Fork review: the renderer fs shim's callback write is synchronous underneath. Keep a real
// Promise-backed, atomic replacement path for updater writes so a failed write cannot truncate
// the installed addon before its error settles back to the UI.
export async function writeFileAsync(filePath: string, content: string | Uint8Array, expected?: ExpectedAddonFile) {
    if (content instanceof Uint8Array) {
        content = Buffer.from(content);
    }

    const temporaryPath = nodePath.join(
        nodePath.dirname(filePath),
        `.${nodePath.basename(filePath)}.bd-update-${process.pid}-${Date.now()}-${++updaterWriteSequence}.tmp`
    );

    try {
        await fs.promises.writeFile(temporaryPath, content, {flag: "wx"});

        if (expected) {
            const current = await readFileSnapshotAsync(filePath);
            if (current.modified !== expected.modified || current.fileContent !== expected.fileContent) throw addonFileChangedError();
        }

        await fs.promises.rename(temporaryPath, filePath);
    }
    finally {
        await fs.promises.rm(temporaryPath, {force: true}).catch(() => {});
    }
}

export function createWriteStream(...args: Parameters<typeof fs.createWriteStream>) {
    // @ts-expect-error this should be deprecated probably
    return clone(fs.createWriteStream(...args));
}

export function watch(path: string, options: fs.WatchOptions | BufferEncoding | null, listener: fs.WatchListener<string>) {
    const watcher = fs.watch(path, options, (event, filename) => {
        try {
            listener(event, filename!);
        }
        catch (error) {
            Logger.stacktrace("filesystem", "Failed to watch path", error as Error);
        }
    });

    return {
        close: () => {
            watcher.close();
        }
    };
}

export function getStats(path: string, options?: fs.StatSyncOptions & {bigint?: false;}) {
    const stats = fs.statSync(path, options);

    return {
        ...stats,
        isFile: stats.isFile.bind(stats),
        isDirectory: stats.isDirectory.bind(stats),
        isSymbolicLink: stats.isSymbolicLink.bind(stats)
    };
}
