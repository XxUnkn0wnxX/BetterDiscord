import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import Logger from "@common/logger";

type PatcherModule = typeof import("@modules/patcher").default;

type PatchTarget = {[key: string]: (...args: any[]) => any};

let patcher: PatcherModule | null = null;

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);

mock.module("@webpack", () => ({webpackRequire: {m: {}}, getByKeys: () => null}));
mock.module(modulePath("discordmodules.ts"), () => ({"default": {}}));
mock.module(modulePath("discordmodules"), () => ({"default": {}}));
mock.module("../../../src/betterdiscord/modules/discordmodules", () => ({"default": {}}));

const getPatcher = async () => {
    if (!patcher) {
        const module = await import("@modules/patcher");
        patcher = module.default;
    }

    return patcher;
};

const clearPatches = (module: PatcherModule) => {
    for (const activePatch of [...module.patches]) {
        for (const childPatch of [...activePatch.children]) {
            childPatch.unpatch();
        }
    }
};

beforeEach(async () => {
    clearPatches(await getPatcher());
});

afterEach(async () => {
    clearPatches(await getPatcher());
});

describe("Patcher", () => {
    test("runs before, original, and FIFO after callbacks when no instead exists", async () => {
        const module: PatchTarget = {
            test(value: number) {
                return value;
            }
        };

        const patcherModule = await getPatcher();
        const order: string[] = [];

        patcherModule.before("test", module, "test", (_this: any, args: any[]) => {
            args[0] = (args[0] as number) + 1;
            order.push("before");
        });
        patcherModule.after("test", module, "test", (_this: any, args: any[], returnValue: any) => {
            order.push("after-1");
            expect(args[0]).toBe(2);
            return `${returnValue}-after-1`;
        });
        patcherModule.after("test", module, "test", (_this: any, _args: any[], returnValue: any) => {
            order.push("after-2");
            return `${returnValue}-after-2`;
        });

        const result = module.test(1);

        expect(order[0]).toBe("before");
        expect(order).toEqual(["before", "after-1", "after-2"]);
        expect(result).toBe("2-after-1-after-2");
    });

    test("supports ordinary single instead callback behavior with replacement args", async () => {
        const module: PatchTarget = {
            test(a: number, b: number) {
                return a + b;
            }
        };

        const patcherModule = await getPatcher();
        const order: string[] = [];

        patcherModule.instead("test", module, "test", (_this: any, args: any[], next: any) => {
            order.push("instead");
            args[0] = (args[0] as number) + 10;
            args[1] = (args[1] as number) + 20;
            return next(...args);
        });

        const result = module.test(1, 2);

        expect(order).toEqual(["instead"]);
        expect(result).toBe(33);
    });

    test("executes nested delegating instead callbacks A then B then original", async () => {
        let originalCalls = 0;
        const module: PatchTarget = {
            test(_value: string) {
                originalCalls += 1;
                order.push("original");
                return "original";
            }
        };

        const patcherModule = await getPatcher();
        const order: string[] = [];

        patcherModule.instead("test", module, "test", (_this: any, args: any[], callback: any) => {
            order.push("instead-a");
            return `${callback(...args)}-a`;
        });
        patcherModule.instead("test", module, "test", (_this: any, args: any[], callback: any) => {
            order.push("instead-b");
            return `${callback(...args)}-b`;
        });

        const result = module.test("value");

        expect(order).toEqual(["instead-a", "instead-b", "original"]);
        expect(result).toBe("original-b-a");
        expect(originalCalls).toBe(1);
    });

    test("uses current snapshot so unpatching a later instead only affects future invocations", async () => {
        const order: string[] = [];
        let originalCalls = 0;

        const module: PatchTarget = {
            test() {
                originalCalls += 1;
                order.push("original");
                return "original";
            }
        };

        const patcherModule = await getPatcher();

        let unpatchLater: () => void = () => {};

        patcherModule.instead("current", module, "test", (_this: any, _args: any[], callback: any) => {
            order.push("instead-current");
            unpatchLater();
            return `${callback()}-current`;
        });

        unpatchLater = patcherModule.instead("later", module, "test", () => {
            order.push("instead-later");
            return "later";
        }) || (() => {});

        const firstResult = module.test();
        const secondResult = module.test();

        expect(order).toEqual(["instead-current", "instead-later", "instead-current", "original"]);
        expect(firstResult).toBe("later-current");
        expect(secondResult).toBe("original-current");
        expect(originalCalls).toBe(1);
    });

    test("non-delegating instead suppresses later instead and original while after still runs", async () => {
        const module: PatchTarget = {
            test() {
                return "original";
            }
        };

        const patcherModule = await getPatcher();
        const order: string[] = [];

        patcherModule.instead("test", module, "test", () => {
            order.push("instead-a");
            return "replacement";
        });
        patcherModule.instead("test", module, "test", () => {
            order.push("instead-b");
            return "later";
        });
        patcherModule.after("test", module, "test", (_this: any, _args: any[], returnValue: any) => {
            order.push(`after:${returnValue}`);
            return `after:${String(returnValue)}`;
        });

        const result = module.test();

        expect(order).toEqual(["instead-a", "after:replacement"]);
        expect(result).toBe("after:replacement");
    });

    test("uses raw continuation and forwards explicit receivers for callback call/apply", async () => {
        const observedThis: unknown[] = [];
        const observedArgs: unknown[][] = [];

        const module: PatchTarget = {
            test(this: {id?: string}, ...values: string[]) {
                observedThis.push(this);
                observedArgs.push(values);
                return this?.id ?? "undefined";
            }
        };

        const patcherModule = await getPatcher();
        const explicitCall = {id: "call"};
        const explicitApply = {id: "apply"};

        patcherModule.instead("test", module, "test", (_this: any, _args: any[], callback: any) => {
            const plain = callback();
            const called = callback.call(explicitCall, "from-call");
            const applied = callback.apply(explicitApply, ["from-apply"]);
            return `${plain}|${called}|${applied}`;
        });

        const result = module.test("from-original");

        expect(result).toBe("undefined|call|apply");
        expect(observedThis).toEqual([undefined, explicitCall, explicitApply]);
        expect(observedArgs).toEqual([[], ["from-call"], ["from-apply"]]);
    });

    test("applies explicit callback return and propagates stored result when omitted", async () => {
        const module: PatchTarget = {
            test(value: number) {
                return value;
            }
        };

        const patcherModule = await getPatcher();

        patcherModule.instead("test", module, "test", () => {
            return "explicit";
        });
        expect(module.test(1)).toBe("explicit");

        const module2: PatchTarget = {
            test(value: number = 0) {
                return value * 2;
            }
        };
        patcherModule.instead("test", module2, "test", (_this: any, _args: any[], callback: any) => {
            callback();
        });

        expect(module2.test(5)).toBe(0);
    });

    test("swallows instead callback throw and blocks later callbacks without auto-continuation", async () => {
        const patcherModule = await getPatcher();
        const order: string[] = [];
        const logged: string[] = [];
        const originalLogger = Logger.err;

        Logger.err = (...message: any[]) => {
            logged.push(`${message[1]}`);
        };

        try {
            const module: PatchTarget = {
                test() {
                    return "original";
                }
            };

            patcherModule.instead("test", module, "test", () => {
                order.push("first");
                throw new Error("callback");
            });
            patcherModule.instead("test", module, "test", () => {
                order.push("second");
                return "later";
            });

            const result = module.test();

            expect(result).toBeUndefined();
            expect(order).toEqual(["first"]);
            expect(logged).toHaveLength(1);
            expect(logged[0]).toContain("Could not fire instead callback");
        }
        finally {
            Logger.err = originalLogger;
        }
    });

    test("logs and swallows before callback throw while continuing with next before and original", async () => {
        const patcherModule = await getPatcher();
        const logged: string[] = [];
        const order: string[] = [];
        const originalLogger = Logger.err;

        Logger.err = (...message: any[]) => {
            logged.push(`${message[1]}`);
        };

        const module: PatchTarget = {
            test() {
                order.push("original");
                return "value";
            }
        };

        try {
            patcherModule.before("test", module, "test", () => {
                order.push("before-a");
                throw new Error("before");
            });
            patcherModule.before("test", module, "test", () => {
                order.push("before-b");
            });

            const result = module.test();

            expect(result).toBe("value");
            expect(order).toEqual(["before-a", "before-b", "original"]);
            expect(logged).toHaveLength(1);
            expect(logged[0]).toContain("Could not fire before callback");
        }
        finally {
            Logger.err = originalLogger;
        }
    });

    test("logs and swallows after callback throw while later after callbacks continue", async () => {
        const patcherModule = await getPatcher();
        const logged: string[] = [];
        const order: string[] = [];
        const originalLogger = Logger.err;

        Logger.err = (...message: any[]) => {
            logged.push(`${message[1]}`);
        };

        const module: PatchTarget = {
            test() {
                order.push("original");
                return 1;
            }
        };

        try {
            patcherModule.after("test", module, "test", (_this: any, _args: any[], _returnValue: any) => {
                order.push("after-a");
                throw new Error("after-a");
            });
            patcherModule.after("test", module, "test", (_this: any, _args: any[], returnValue: any) => {
                order.push("after-b");
                return `${returnValue + 1}-after-b`;
            });

            const result = module.test();

            expect(result).toBe("2-after-b");
            expect(order).toEqual(["original", "after-a", "after-b"]);
            expect(logged).toHaveLength(1);
            expect(logged[0]).toContain("Could not fire after callback");
        }
        finally {
            Logger.err = originalLogger;
        }
    });

    test("logs and swallows original throws only when an instead callback delegates", async () => {
        const patcherModule = await getPatcher();
        const module: PatchTarget = {
            test() {
                throw new Error("original");
            }
        };

        expect(() => module.test()).toThrow("original");

        const logged: string[] = [];
        const originalLogger = Logger.err;
        Logger.err = (...message: any[]) => {
            logged.push(`${message[1]}`);
        };

        try {
            patcherModule.instead("test", module, "test", (_this: any, _args: any[], callback: any) => callback());
            expect(module.test()).toBeUndefined();
            expect(logged).toHaveLength(1);
            expect(logged[0]).toContain("Could not fire instead callback");
        }
        finally {
            Logger.err = originalLogger;
        }
    });

    test("repeats original calls but keeps the first computed result when continuation result is omitted", async () => {
        const module: PatchTarget = {
            test() {
                callCount += 1;
                return callCount;
            }
        };

        let callCount = 0;
        const callbackObservations: number[] = [];
        const patcherModule = await getPatcher();

        patcherModule.instead("test", module, "test", (_this: any, _args: any[], callback: any) => {
            callbackObservations.push(callback());
            callbackObservations.push(callback());
        });

        const result = module.test();

        expect(callCount).toBe(2);
        expect(callbackObservations).toEqual([1, 2]);
        expect(result).toBe(1);
    });

    test("passes invocation args and running final result to after callbacks", async () => {
        const module: PatchTarget = {
            sum(a: number, b: number) {
                return a + b;
            }
        };

        const patcherModule = await getPatcher();
        const afterCalls: Array<{args: number[]; returnValue: number}> = [];

        patcherModule.instead("test", module, "sum", (_this: any, args: any[], callback: any) => {
            args[0] = (args[0] as number) + 1;
            args[1] = (args[1] as number) + 2;
            return callback(...args);
        });
        patcherModule.after("test", module, "sum", (_this: any, args: any[], returnValue: any) => {
            afterCalls.push({args: [...args as number[]], returnValue: returnValue as number});
            return returnValue + 1;
        });

        const result = module.sum(1, 2);

        expect(afterCalls).toEqual([{args: [1, 2], returnValue: 6}]);
        expect(result).toBe(7);
    });

    test("preserves original snapshot metadata and supports idempotent unpatch with sibling patches retained", async () => {
        const module: PatchTarget = {
            test() {
                return "original";
            }
        };

        const patcherModule = await getPatcher();
        const beforeLog: string[] = [];
        const originalFunction = module.test;
        const unpatchA = patcherModule.before("test-a", module, "test", () => {
            beforeLog.push("a");
        });
        const unpatchB = patcherModule.before("test-b", module, "test", () => {
            beforeLog.push("b");
        });
        const patchedFunction = module.test;
        const patch = patcherModule.patches[0];

        expect(patch).toBeDefined();
        expect(patch?.children.length).toBe(2);

        expect(patchedFunction).not.toBe(originalFunction);
        expect(patcherModule.patches).toHaveLength(1);
        expect((patchedFunction as unknown as {__originalFunction: () => string}).__originalFunction).toBe(originalFunction);
        expect(patchedFunction.toString()).toBe(originalFunction.toString());

        unpatchA?.();
        unpatchA?.();

        const siblingResult = module.test();

        expect(siblingResult).toBe("original");
        expect(beforeLog).toEqual(["b"]);
        expect(patch?.children.length).toBe(1);
        expect(patch?.children[0].caller).toBe("test-b");

        unpatchB?.();

        expect(patcherModule.patches).toHaveLength(0);
        expect(module.test).toBe(originalFunction);
    });
});
