import Bun from "bun";
import path from "node:path";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import pkg from "../package.json";
import styleLoader from "bun-style-loader";
import * as esbuild from "esbuild";


const fileURL = Bun.fileURLToPath(import.meta.url);
const rootDir = path.join(path.dirname(fileURL), "..");
const isProduction = process.argv.includes("--minify");

function readGitValue(...args: string[]) {
    const candidates = [
        Bun.env.GIT,
        process.platform === "darwin" ? "/usr/local/bin/git" : undefined,
        "git"
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
        if (candidate.includes("/") && !fs.existsSync(candidate)) continue;

        try {
            return execFileSync(candidate, args, {
                cwd: rootDir,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"]
            }).trim();
        }
        catch {
            continue;
        }
    }

    return "";
}

const BRANCH_NAME = Bun.env.BRANCH_NAME ?? readGitValue("symbolic-ref", "--short", "HEAD");
const COMMIT_HASH = Bun.env.COMMIT_HASH ?? readGitValue("rev-parse", "--short", "HEAD");
const DEVELOPMENT = Bun.env.NODE_ENV ?? "development";

function readPositiveIntegerOption(argument: string, environmentVariable: string, fallback: number) {
    const inlinePrefix = `${argument}=`;
    const inlineArgument = process.argv.find(value => value.startsWith(inlinePrefix));
    const argumentIndex = process.argv.indexOf(argument);
    if (inlineArgument === inlinePrefix || (argumentIndex !== -1 && process.argv[argumentIndex + 1] == null)) {
        throw new Error(`${argument} requires a value`);
    }
    const argumentValue = inlineArgument?.slice(inlinePrefix.length)
        ?? (argumentIndex === -1 ? undefined : process.argv[argumentIndex + 1]);
    const rawValue = argumentValue ?? Bun.env[environmentVariable] ?? String(fallback);

    if (!/^[1-9]\d*$/.test(rawValue)) {
        throw new Error(`${argument} must be a positive integer`);
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) throw new Error(`${argument} is too large`);
    return value;
}

const MACOS_RECOVERY_TIMEOUT_SECONDS = readPositiveIntegerOption(
    "--macos-recovery-timeout-seconds",
    "BETTERDISCORD_MACOS_RECOVERY_TIMEOUT_SECONDS",
    90,
);

interface EntryPoint {
    in: string;
    out: string;
}

const moduleConfigs: Record<string, EntryPoint> = {
    betterdiscord: {"in": "src/betterdiscord/index.ts", "out": "betterdiscord"},
    main: {"in": "src/electron/main/index.ts", "out": "main"},
    preload: {"in": "src/electron/preload/index.ts", "out": "preload"},
    earlyRenderer: {"in": "src/electron/preload/early/index.ts", "out": "earlyRenderer"},
    editorPreload: {"in": "src/editor/preload.ts", "out": "editor/preload"},
    editor: {"in": "src/editor/script.ts", "out": "editor/script"},
    editorHtml: {"in": "src/editor/index.html", "out": "editor/index"}
};

let modulesRequested = process.argv.filter(a => a.startsWith("--module=")).map(a => a.replace("--module=", ""));
if (!modulesRequested.length) modulesRequested = Object.keys(moduleConfigs);

const entryPoints = modulesRequested.map(m => moduleConfigs[m]);

function buildOptions() {
    return {
        entryPoints: entryPoints,
        bundle: true,
        outdir: path.join(rootDir, "dist"),
        format: "cjs",
        jsx: "transform",
        alias: {
            react: "@modules/react",
        },
        external: ["fs", "node:inspector", "original-fs", "path", "vm", "electron", "@electron/remote", "module", "request", "events", "child_process", "net", "http", "https", "crypto", "os", "url", "util/types"],
        target: ["chrome128", "node20"],
        loader: {
            ".js": "jsx",
            ".css": "css",
            ".html": "copy"
        },
        plugins: [styleLoader() as unknown as esbuild.Plugin],
        logLevel: "info",
        treeShaking: true,
        charset: "utf8",
        minify: isProduction,
        legalComments: "none",
        define: {
            "process.env.__VERSION__": JSON.stringify(pkg.version),
            "process.env.__MONACO_VERSION__": JSON.stringify(pkg.dependencies["monaco-editor"]),
            "process.env.__BRANCH__": JSON.stringify(BRANCH_NAME),
            "process.env.__COMMIT__": JSON.stringify(COMMIT_HASH),
            "process.env.__BUILD__": JSON.stringify(DEVELOPMENT),
            "process.env.__MACOS_RECOVERY_TIMEOUT_SECONDS__": JSON.stringify(MACOS_RECOVERY_TIMEOUT_SECONDS)
        }
    } satisfies esbuild.BuildOptions;
}

async function runBuild() {
    const before = performance.now();
    const names = modulesRequested.join(", ");

    console.log("");
    console.log(`Building ${names}...`);

    if (process.argv.includes("--watch")) {
        const ctx = await esbuild.context(buildOptions());
        await ctx.watch();
    }
    else {
        await esbuild.build(buildOptions());
    }

    const after = performance.now();
    console.log(`Finished building ${names} in ${(after - before).toFixed(2)}ms`);
    console.log("");
    console.log(`Type:    ${DEVELOPMENT}`);
    console.log(`Version: ${pkg.version}`);
    console.log(`Branch:  ${BRANCH_NAME}`);
    console.log(`Commit:  ${COMMIT_HASH}`);
    console.log(`macOS recovery timeout: ${MACOS_RECOVERY_TIMEOUT_SECONDS}s`);
    console.log("");
}

runBuild().catch(console.error);
