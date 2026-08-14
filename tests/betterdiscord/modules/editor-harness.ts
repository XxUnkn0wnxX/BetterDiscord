import {mock} from "bun:test";

class MockElement {
    focus(): void {}
}

class MockDocument {
    createElement(): MockElement {
        return new MockElement();
    }

    querySelectorAll(): [] {
        return [];
    }
}

Object.defineProperty(globalThis, "HTMLElement", {value: MockElement, configurable: true, writable: true});
Object.defineProperty(globalThis, "document", {value: new MockDocument(), configurable: true, writable: true});

if (!globalThis.window) {
    Object.defineProperty(globalThis, "window", {value: globalThis, configurable: true, writable: true});
}

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);
const setModule = (filename: string, value: object) => mock.module(modulePath(filename), () => value);
const webpackPath = import.meta.resolve("../../../src/betterdiscord/webpack");
const patcherPath = import.meta.resolve("../../../src/betterdiscord/modules/patcher.ts");
const patcherNoExtPath = patcherPath.replace(/\.ts$/, "");

const focusCalls = new Map<MockElement, number>();
const focus = (target: MockElement): void => {
    focusCalls.set(target, (focusCalls.get(target) ?? 0) + 1);
};

const originalFocus = HTMLElement.prototype.focus as (this: MockElement, ...args: unknown[]) => unknown;
const mockPatcher = {
    "default": {
        instead: (_caller: string, moduleToPatch: Record<string, (...args: unknown[]) => unknown>, functionName: string, callback: (that: Record<string, unknown>, args: unknown[], original: () => unknown) => unknown) => {
            const originalFunction = moduleToPatch[functionName];
            if (typeof originalFunction !== "function") {
                return () => {};
            }

            const wrapped = function(this: Record<string, unknown>, ...args: unknown[]) {
                const original = () => originalFunction.apply(this, args);
                return callback(this, args, original);
            };
            moduleToPatch[functionName] = wrapped;

            return () => {
                moduleToPatch[functionName] = originalFunction;
            };
        },
        unpatchAll: () => {}
    }
};

setModule("dommanager.ts", {"default": {
    linkStyle: () => {},
    injectScript: async () => {},
    linkStyleSheet: () => {}
}});
mock.module("@modules/patcher", () => mockPatcher);
mock.module(patcherPath, () => mockPatcher);
mock.module(patcherNoExtPath, () => mockPatcher);
setModule("patcher.ts", mockPatcher);
setModule("patcher", mockPatcher);
mock.module("@common/logger", () => ({"default": {log: () => {}, debug: () => {}, error: () => {}, stacktrace: () => {}}}));
mock.module("@webpack", () => ({
    getAllModules: () => [],
    getByKeys: () => undefined,
    webpackRequire: {}
}));
mock.module(webpackPath, () => ({
    getAllModules: () => [],
    getByKeys: () => undefined,
    webpackRequire: {}
}));

const focusTracker: typeof originalFocus = function() {
    focus(this as MockElement);
};
Object.defineProperty(HTMLElement.prototype, "focus", {
    value: focusTracker,
    configurable: true,
    writable: true
});

class TextAreaWrapper {
    _actual: MockElement;
    unrelatedNode?: MockElement;
    shouldThrow = false;

    constructor(actual: MockElement, unrelatedNode?: MockElement, shouldThrow = false) {
        this._actual = actual;
        this.unrelatedNode = unrelatedNode;
        this.shouldThrow = shouldThrow;
    }

    setSelectionRange(this: TextAreaWrapper): "selection-ok" {
        this._actual.focus();
        this.unrelatedNode?.focus();
        if (this.shouldThrow) {
            throw new Error("selection-range-failure");
        }
        return "selection-ok";
    }
}

type AMDLoader = {
    (moduleIds: string | string[], callback: (...exports: unknown[]) => void): void;
    config: (config: Record<string, unknown>) => void;
};

const amdLoader: AMDLoader = Object.assign((moduleIds: string | string[], cb: (...exports: unknown[]) => void) => {
    if (!Array.isArray(moduleIds)) {
        return;
    }

    if (moduleIds.includes("vs/editor/editor.main")) {
        cb({
            languages: {
                registerCompletionItemProvider: () => {},
                typescript: {
                    javascriptDefaults: {
                        setDiagnosticsOptions: () => {},
                        setCompilerOptions: () => {}
                    },
                    typescriptDefaults: {
                        setDiagnosticsOptions: () => {},
                        setCompilerOptions: () => {}
                    }
                }
            },
            Range: class {
                static fromPositions = () => ({});
            }
        });
        return;
    }

    if (moduleIds.includes("vs/platform/clipboard/browser/clipboardService")) {
        cb({
            BrowserClipboardService: class {
                readText(): Promise<string> {
                    return Promise.resolve("mock");
                }
            }
        });
        return;
    }

    if (moduleIds.includes("vs/editor/browser/controller/textAreaInput")) {
        cb({TextAreaWrapper});
        return;
    }
},
{
    config: (_config: Record<string, unknown>) => {}
});

Object.assign(window, {require: amdLoader});

const {default: Editor} = await import("../../../src/betterdiscord/modules/editor");

await Editor.initialize();

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
};

const primary = document.createElement("textarea") as MockElement;
const unrelated = document.createElement("input") as MockElement;

focusCalls.clear();
const wrapper = new TextAreaWrapper(primary, unrelated);
const returnValue = wrapper.setSelectionRange();
assert(returnValue === "selection-ok", "Patched setSelectionRange should preserve callback return value.");
assert((focusCalls.get(primary) ?? 0) === 1, "The real textarea focus should pass through the temporary guard.");
assert((focusCalls.get(unrelated) ?? 0) === 0, "Unrelated focus should be suppressed while patch is active.");

unrelated.focus();
assert((focusCalls.get(unrelated) ?? 0) === 1, "Unrelated focus should work after patch cleanup.");

const throwing = new TextAreaWrapper(primary, unrelated, true);
focusCalls.clear();
let threw = false;
try {
    throwing.setSelectionRange();
}
catch {
    threw = true;
}
assert(threw, "setSelectionRange should propagate the callback error.");
assert((focusCalls.get(primary) ?? 0) === 1, "Primary focus should still be applied on the thrown callback execution.");
assert((focusCalls.get(unrelated) ?? 0) === 0, "Unrelated focus should be suppressed even on the thrown callbacks.");

unrelated.focus();
assert((focusCalls.get(unrelated) ?? 0) === 1, "Temporary focus guard should be removed when callback throws.");

Object.defineProperty(HTMLElement.prototype, "focus", {value: originalFocus, configurable: true, writable: true});

process.stdout.write("monaco-selection-focus-guard: ok\n");
