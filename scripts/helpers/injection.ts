import fs from "fs";
import path from "path";
import {randomUUID} from "crypto";

export const markerFilename = ".betterdiscord-inject.json";
export const loaderMarker = "__betterdiscord_inject_meta__";
export const wrappedAsarFilename = "betterdiscord.app.asar";
export const wrappedDirectoryName = "betterdiscord.app";

export type InjectionChannel = "stable" | "ptb" | "canary";
export type InjectionMode = "release" | "dev";

export interface InjectionMarker {
    schema: 1;
    owner: "betterdiscord";
    style: "app-wrapper";
    channel: InjectionChannel;
    mode: InjectionMode;
    loader: "index.js";
    payload: "../betterdiscord.app.asar" | "../betterdiscord.app";
    bdPath: string;
    helperRuntime?: string;
    installationId: string;
}

export type InjectionLayout =
    | {kind: "plain-asar"; source: string; payload: InjectionMarker["payload"]}
    | {kind: "plain-directory"; source: string; payload: InjectionMarker["payload"]}
    | {kind: "wrapped"; marker: InjectionMarker; source: string; payload: InjectionMarker["payload"]}
    | {kind: "missing"; reason: string}
    | {kind: "unsafe"; reason: string};

export interface InjectionOptions {
    resources: string;
    channel: InjectionChannel;
    mode: InjectionMode;
    bdPath: string;
    helperRuntime?: string;
    dryRun?: boolean;
    log?: (message: string) => void;
}

function isFile(target: string): boolean {
    try {return fs.statSync(target).isFile();}
    catch {return false;}
}

function isDirectory(target: string): boolean {
    try {return fs.statSync(target).isDirectory();}
    catch {return false;}
}

function readJson(target: string): unknown {
    try {return JSON.parse(fs.readFileSync(target, "utf8"));}
    catch {return null;}
}

export function isInjectionMarker(value: unknown): value is InjectionMarker {
    if (!value || typeof value !== "object") return false;
    const marker = value as Partial<InjectionMarker>;
    return marker.schema === 1
        && marker.owner === "betterdiscord"
        && marker.style === "app-wrapper"
        && (marker.channel === "stable" || marker.channel === "ptb" || marker.channel === "canary")
        && (marker.mode === "release" || marker.mode === "dev")
        && marker.loader === "index.js"
        && (marker.payload === "../betterdiscord.app.asar" || marker.payload === "../betterdiscord.app")
        && typeof marker.bdPath === "string"
        && marker.bdPath.length > 0
        && (marker.helperRuntime === undefined || typeof marker.helperRuntime === "string")
        && typeof marker.installationId === "string"
        && marker.installationId.length > 0;
}

function validatePlainDirectory(appDirectory: string): boolean {
    const pkg = readJson(path.join(appDirectory, "package.json"));
    if (!pkg || typeof pkg !== "object") return false;
    const main = (pkg as {main?: unknown}).main;
    return typeof main === "string" && main.length > 0 && isFile(path.join(appDirectory, main));
}

function validateOwnedWrapper(appDirectory: string, marker: InjectionMarker): string | null {
    const expectedEntries = [markerFilename, "index.js", "package.json"];
    let entries: string[];
    try {entries = fs.readdirSync(appDirectory).sort();}
    catch {return "cannot read Resources/app";}
    if (entries.join("\0") !== expectedEntries.sort().join("\0")) return "Resources/app contains files not owned by BetterDiscord";

    const indexPath = path.join(appDirectory, "index.js");
    const index = isFile(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
    if (!index.includes(loaderMarker) || !index.includes(marker.payload)) return "Resources/app/index.js does not match BetterDiscord metadata";

    const pkg = readJson(path.join(appDirectory, "package.json"));
    const main = pkg && typeof pkg === "object" ? (pkg as {main?: unknown}).main : null;
    if (main !== "index.js" && main !== "./index.js") return "Resources/app/package.json has an unexpected main entry";
    return null;
}

export function inspectInjection(resources: string): InjectionLayout {
    const appAsar = path.join(resources, "app.asar");
    const appDirectory = path.join(resources, "app");
    const wrappedAsar = path.join(resources, wrappedAsarFilename);
    const wrappedDirectory = path.join(resources, wrappedDirectoryName);
    const markerPath = path.join(appDirectory, markerFilename);

    const topAsarExists = isFile(appAsar);
    const appDirectoryExists = isDirectory(appDirectory);
    const wrappedAsarExists = isFile(wrappedAsar);
    const wrappedDirectoryExists = isDirectory(wrappedDirectory);
    const markerExists = isFile(markerPath);

    if (wrappedAsarExists && wrappedDirectoryExists) return {kind: "unsafe", reason: "both wrapped payload forms exist"};

    if (markerExists) {
        if (!appDirectoryExists || topAsarExists) return {kind: "unsafe", reason: "BetterDiscord marker exists in a partial or dual layout"};
        const marker = readJson(markerPath);
        if (!isInjectionMarker(marker)) return {kind: "unsafe", reason: "BetterDiscord marker is invalid"};
        const expectedSource = path.resolve(appDirectory, marker.payload);
        const expectedIsDirectory = marker.payload.endsWith("betterdiscord.app");
        if (expectedIsDirectory ? !isDirectory(expectedSource) : !isFile(expectedSource)) {
            return {kind: "unsafe", reason: "BetterDiscord wrapped payload is missing or has the wrong type"};
        }
        if ((expectedIsDirectory && wrappedAsarExists) || (!expectedIsDirectory && wrappedDirectoryExists)) {
            return {kind: "unsafe", reason: "unexpected second wrapped payload exists"};
        }
        const wrapperError = validateOwnedWrapper(appDirectory, marker);
        if (wrapperError) return {kind: "unsafe", reason: wrapperError};
        return {kind: "wrapped", marker, source: expectedSource, payload: marker.payload};
    }

    if (wrappedAsarExists || wrappedDirectoryExists) return {kind: "unsafe", reason: "wrapped payload exists without BetterDiscord metadata"};
    if (topAsarExists && appDirectoryExists) return {kind: "unsafe", reason: "both Resources/app.asar and Resources/app exist"};
    if (topAsarExists) return {kind: "plain-asar", source: appAsar, payload: "../betterdiscord.app.asar"};
    if (appDirectoryExists) {
        if (!validatePlainDirectory(appDirectory)) return {kind: "unsafe", reason: "unpacked Resources/app is not a valid application"};
        return {kind: "plain-directory", source: appDirectory, payload: "../betterdiscord.app"};
    }
    return {kind: "missing", reason: "neither Resources/app.asar nor Resources/app exists"};
}

function wrapperContents(marker: InjectionMarker): Record<string, string> {
    return {
        "index.js": `// ${loaderMarker}\nrequire(${JSON.stringify(marker.bdPath)});\nmodule.exports = require(${JSON.stringify(marker.payload)});\n`,
        "package.json": `${JSON.stringify({name: "discord", main: "./index.js"}, null, 4)}\n`,
        [markerFilename]: `${JSON.stringify(marker, null, 4)}\n`,
    };
}

function writeWrapper(directory: string, marker: InjectionMarker) {
    fs.mkdirSync(directory, {recursive: false});
    const contents = wrapperContents(marker);
    fs.writeFileSync(path.join(directory, "index.js"), contents["index.js"]);
    fs.writeFileSync(path.join(directory, "package.json"), contents["package.json"]);
    // Metadata is deliberately written last. Its presence means the wrapper is complete.
    fs.writeFileSync(path.join(directory, markerFilename), contents[markerFilename]);
}

export function wrapInjection(options: InjectionOptions): InjectionMarker {
    const log = options.log ?? (() => {});
    const layout = inspectInjection(options.resources);
    if (layout.kind === "missing" || layout.kind === "unsafe") throw new Error(layout.reason);

    const marker: InjectionMarker = {
        schema: 1,
        owner: "betterdiscord",
        style: "app-wrapper",
        channel: options.channel,
        mode: options.mode,
        loader: "index.js",
        payload: layout.payload,
        bdPath: options.bdPath,
        helperRuntime: options.helperRuntime,
        installationId: layout.kind === "wrapped" ? layout.marker.installationId : randomUUID(),
    };

    const appDirectory = path.join(options.resources, "app");
    const wrappedTarget = path.resolve(appDirectory, marker.payload);
    const suffix = `${process.pid}-${Date.now()}`;
    const stagedWrapper = path.join(options.resources, `.betterdiscord-app-${suffix}`);
    const previousWrapper = path.join(options.resources, `.betterdiscord-app-previous-${suffix}`);

    if (layout.kind === "wrapped") {
        log(`Updating BetterDiscord wrapper (${marker.installationId})`);
        if (options.dryRun) return marker;
        try {
            writeWrapper(stagedWrapper, marker);
            fs.renameSync(appDirectory, previousWrapper);
            fs.renameSync(stagedWrapper, appDirectory);
            fs.rmSync(previousWrapper, {recursive: true, force: true});
            return marker;
        }
        catch (error) {
            if (isDirectory(stagedWrapper)) fs.rmSync(stagedWrapper, {recursive: true, force: true});
            if (!isDirectory(appDirectory) && isDirectory(previousWrapper)) fs.renameSync(previousWrapper, appDirectory);
            throw error;
        }
    }

    log(`Renaming ${path.basename(layout.source)} to ${path.basename(wrappedTarget)}`);
    if (options.dryRun) {
        log("Creating BetterDiscord Resources/app wrapper");
        return marker;
    }

    let payloadMoved = false;
    try {
        fs.renameSync(layout.source, wrappedTarget);
        payloadMoved = true;
        writeWrapper(stagedWrapper, marker);
        fs.renameSync(stagedWrapper, appDirectory);
        return marker;
    }
    catch (error) {
        if (isDirectory(stagedWrapper)) fs.rmSync(stagedWrapper, {recursive: true, force: true});
        if (payloadMoved && !fs.existsSync(layout.source) && fs.existsSync(wrappedTarget)) fs.renameSync(wrappedTarget, layout.source);
        throw error;
    }
}

export function unwrapInjection(resources: string, dryRun = false, log: (message: string) => void = () => {}): InjectionMarker | null {
    const layout = inspectInjection(resources);
    if (layout.kind === "plain-asar" || layout.kind === "plain-directory" || layout.kind === "missing") return null;
    if (layout.kind === "unsafe") throw new Error(layout.reason);

    const appDirectory = path.join(resources, "app");
    const restoredTarget = layout.payload.endsWith(".asar") ? path.join(resources, "app.asar") : appDirectory;
    const suffix = `${process.pid}-${Date.now()}`;
    const stagedWrapper = path.join(resources, `.betterdiscord-app-remove-${suffix}`);

    log(`Removing BetterDiscord Resources/app wrapper`);
    log(`Restoring ${path.basename(layout.source)} to ${path.basename(restoredTarget)}`);
    if (dryRun) return layout.marker;

    try {
        fs.renameSync(appDirectory, stagedWrapper);
        fs.renameSync(layout.source, restoredTarget);
        fs.rmSync(stagedWrapper, {recursive: true, force: true});
        return layout.marker;
    }
    catch (error) {
        if (fs.existsSync(restoredTarget) && !fs.existsSync(layout.source)) fs.renameSync(restoredTarget, layout.source);
        if (!fs.existsSync(appDirectory) && fs.existsSync(stagedWrapper)) fs.renameSync(stagedWrapper, appDirectory);
        throw error;
    }
}
