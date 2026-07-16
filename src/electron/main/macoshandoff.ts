import {execFileSync} from "child_process";
import fs from "fs";


interface HandoffProcess {
    pid: number;
    pgid: number;
    command: string;
}

interface JsonObject {
    [key: string]: unknown;
}

export interface OpenAsarHandoffOptions {
    marker: {
        channel: "stable" | "ptb" | "canary";
        installationId: string;
    };
    targetAppPath: string;
    nestedTarget: string;
    readyPath: string;
    pendingPath: string;
    helperPath: string;
    helperPidPath: string;
    now?: number;
    processes?: HandoffProcess[];
    helperIsRunning?: (pid: number) => boolean;
}

export interface OpenAsarHandoffOwner {
    helperPid: number;
    armedAt: string;
    handoffId: string;
    sourceProcessPid: number;
    restartRequested: boolean;
    betterDiscordRecoveryRunId?: string;
    readyAt: string;
}

export type PendingOpenAsarHandoffOwner = Omit<OpenAsarHandoffOwner, "readyAt">;

function readRegularJson(target: string): JsonObject | null {
    try {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile()) return null;
        const value: unknown = JSON.parse(fs.readFileSync(target, "utf8"));
        return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
    }
    catch {return null;}
}

function readRegularPid(target: string): number {
    try {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile()) return 0;
        const value = fs.readFileSync(target, "utf8").trim();
        return /^\d+$/.test(value) ? Number(value) : 0;
    }
    catch {return 0;}
}

function isRegularFile(target: string): boolean {
    try {
        const stat = fs.lstatSync(target);
        return stat.isFile() && !stat.isSymbolicLink();
    }
    catch {return false;}
}

function stringValue(value: JsonObject, key: string): string {
    return typeof value[key] === "string" ? value[key] : "";
}

function listProcesses(): HandoffProcess[] {
    let output = "";
    try {output = execFileSync("/bin/ps", ["-axo", "pid=,pgid=,command="], {encoding: "utf8"});}
    catch {return [];}

    const processes: HandoffProcess[] = [];
    for (const line of output.split("\n")) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) continue;
        processes.push({pid: Number(match[1]), pgid: Number(match[2]), command: match[3]});
    }
    return processes;
}

function processIsRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {return false;}
}

export function findPendingOpenAsarHandoff(options: OpenAsarHandoffOptions): PendingOpenAsarHandoffOwner | null {
    const pending = readRegularJson(options.pendingPath);
    if (!pending || !isRegularFile(options.helperPath)) return null;

    const installationId = stringValue(pending, "expectedInstallationId") || stringValue(pending, "installationId");
    const targetAppPath = stringValue(pending, "appPath") || stringValue(pending, "targetAppPath") || stringValue(pending, "expectedTargetAppPath");
    const armedAt = stringValue(pending, "armedAt") || stringValue(pending, "createdAt");
    const handoffId = stringValue(pending, "handoffId");
    const betterDiscordRecoveryRunId = stringValue(pending, "betterDiscordRecoveryRunId");
    const armedTime = Date.parse(armedAt);
    const now = options.now ?? Date.now();
    if (pending.pending !== true
        || pending.betterDiscordExpected !== true
        || pending.schema !== 1
        || pending.owner !== "betterdiscord"
        || pending.style !== "app-wrapper"
        || stringValue(pending, "channel") !== options.marker.channel
        || installationId !== options.marker.installationId
        || targetAppPath !== options.targetAppPath
        || stringValue(pending, "nestedTarget") !== options.nestedTarget
        || handoffId.length === 0
        || !Number.isInteger(pending.sourceProcessPid)
        || typeof pending.sourceProcessPid !== "number"
        || pending.sourceProcessPid <= 0
        || !Number.isFinite(armedTime)
        || armedTime > now + 10_000
        || now - armedTime > 300_000) {
        return null;
    }

    const helperPid = pending.helperPid;
    if (!Number.isInteger(helperPid)
        || typeof helperPid !== "number"
        || helperPid <= 0
        || stringValue(pending, "helperPath") !== options.helperPath
        || stringValue(pending, "helperPidPath") !== options.helperPidPath
        || readRegularPid(options.helperPidPath) !== helperPid) {
        return null;
    }

    const processes = options.processes ?? listProcesses();
    const owners = processes.filter(candidate => candidate.pid === helperPid);
    const owner = owners.length === 1 ? owners[0] : null;
    const commandPrefixes = [
        `zsh -f ${options.helperPath} `,
        `/bin/zsh -f ${options.helperPath} `,
        `/usr/bin/zsh -f ${options.helperPath} `,
        `/usr/bin/env zsh -f ${options.helperPath} `,
    ];
    if (!owner
        || owner.pid === process.pid
        || owner.pgid !== owner.pid
        || !commandPrefixes.some(prefix => owner.command.startsWith(prefix))
        || !owner.command.includes(options.helperPidPath)
        || !(options.helperIsRunning ?? processIsRunning)(helperPid)) {
        return null;
    }

    return {
        helperPid,
        armedAt,
        handoffId,
        sourceProcessPid: pending.sourceProcessPid,
        restartRequested: pending.restartRequested === true,
        ...(betterDiscordRecoveryRunId ? {betterDiscordRecoveryRunId} : {}),
    };
}

export function findMatchingOpenAsarHandoff(options: OpenAsarHandoffOptions): OpenAsarHandoffOwner | null {
    const pending = findPendingOpenAsarHandoff(options);
    const ready = readRegularJson(options.readyPath);
    if (!pending || !ready) return null;

    const readyAt = stringValue(ready, "readyAt");
    const recoveryRunId = stringValue(ready, "recoveryRunId");
    const readyTime = Date.parse(readyAt);
    const recoveryArmedTime = Date.parse(stringValue(ready, "armedAt"));
    const now = options.now ?? Date.now();
    if (ready.schema !== 1
        || ready.owner !== "betterdiscord"
        || ready.style !== "app-wrapper"
        || stringValue(ready, "channel") !== options.marker.channel
        || stringValue(ready, "installationId") !== options.marker.installationId
        || stringValue(ready, "appPath") !== options.targetAppPath
        || stringValue(ready, "targetAppPath") !== options.targetAppPath
        || stringValue(ready, "nestedTarget") !== options.nestedTarget
        || stringValue(ready, "openAsarHandoffId") !== pending.handoffId
        || ready.openAsarSourceProcessPid !== pending.sourceProcessPid
        || recoveryRunId.length === 0
        || !Number.isFinite(recoveryArmedTime)
        || (recoveryArmedTime < Date.parse(pending.armedAt) && pending.betterDiscordRecoveryRunId !== recoveryRunId)
        || !Number.isFinite(readyTime)
        || readyTime < recoveryArmedTime
        || readyTime > now + 10_000) {
        return null;
    }

    return {...pending, readyAt};
}
