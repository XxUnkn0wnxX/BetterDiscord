import {describe, expect, test} from "bun:test";
import {spawnSync} from "child_process";
import {EventEmitter} from "events";
import path from "path";

import {installHostUpdatedMigrationHook} from "../../src/electron/main/hostupdate";


class FakeEmitter {
    listener: ((this: FakeEmitter, ...args: unknown[]) => void) | null = null;

    emit(event: string, ...args: unknown[]) {
        if (event !== "host-updated" || !this.listener) return false;
        Reflect.apply(this.listener, this, args);
        return true;
    }
}

function preserveFakeEmit<T>(callback: () => T): T {
    const original = FakeEmitter.prototype.emit;
    try {return callback();}
    finally {FakeEmitter.prototype.emit = original;}
}

function runMigratorHarness(scenario: string) {
    const harness = path.join(import.meta.dir, "hostupdate-harness.ts");
    const result = spawnSync(process.execPath, [harness, scenario], {
        cwd: path.resolve(import.meta.dir, "../.."),
        encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
}

describe("host-updated migration hook", () => {
    test("runs migration before the original event with its receiver, arguments, and return value", () => {
        preserveFakeEmit(() => {
            const calls: string[] = [];
            installHostUpdatedMigrationHook("linux", () => {calls.push("migration");}, FakeEmitter as unknown as typeof EventEmitter);

            const emitter = new FakeEmitter();
            let args: unknown[] = [];
            emitter.listener = function (...listenerArgs) {
                calls.push("listener");
                expect(this).toBe(emitter);
                args = listenerArgs;
            };

            expect(emitter.emit("host-updated", "payload", 7)).toBe(true);
            expect(calls).toEqual(["migration", "listener"]);
            expect(args).toEqual(["payload", 7]);
        });
    });

    test("delivers the event once when migration fails and preserves listener exceptions", () => {
        preserveFakeEmit(() => {
            let listenerCalls = 0;
            installHostUpdatedMigrationHook("win32", () => {throw new Error("migration failed");}, FakeEmitter as unknown as typeof EventEmitter);

            const emitter = new FakeEmitter();
            const listenerError = new Error("listener failed");
            emitter.listener = () => {
                listenerCalls++;
                throw listenerError;
            };

            expect(() => emitter.emit("host-updated")).toThrow(listenerError);
            expect(listenerCalls).toBe(1);
        });
    });

    test("ignores unrelated events and unsupported platforms", () => {
        preserveFakeEmit(() => {
            let migrationCalls = 0;
            installHostUpdatedMigrationHook("linux", () => {migrationCalls++;}, FakeEmitter as unknown as typeof EventEmitter);

            const emitter = new FakeEmitter();
            emitter.listener = () => {};
            expect(emitter.emit("other-event")).toBe(false);
            expect(migrationCalls).toBe(0);

            const installedEmit = FakeEmitter.prototype.emit;
            for (const platform of ["darwin", "aix"] as NodeJS.Platform[]) {
                installHostUpdatedMigrationHook(platform, () => {migrationCalls++;}, FakeEmitter as unknown as typeof EventEmitter);
                expect(FakeEmitter.prototype.emit).toBe(installedEmit);
            }
        });
    });

    test("migrates app-* directories from the host-updated event", () => runMigratorHarness("app-prefixed"));

    test("migrates plain-version directories from the host-updated event", () => runMigratorHarness("plain-version"));

    test("keeps foreign and ambiguous target layouts untouched", () => {
        runMigratorHarness("foreign-layout");
        runMigratorHarness("ambiguous-layout");
    });

    test("rolls back a failed wrapper publish", () => runMigratorHarness("failed-publish"));

    test("keeps repeated host-updated migration and before-quit fallback idempotent", () => runMigratorHarness("repeat-and-before-quit"));

    test("does not install the hook on macOS or unsupported platforms", () => {
        runMigratorHarness("darwin");
        runMigratorHarness("unsupported");
    });

    test("still delivers host-updated when the migrator throws before its inner catch", () => runMigratorHarness("migration-failure"));
});
