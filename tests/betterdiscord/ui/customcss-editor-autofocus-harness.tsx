import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const editorModule = {
    failedToLoad: false,
    initialize: async () => {}
};
type MockMonacoEditor = {
    focus(): void;
    layout(): void;
    getValue(): string;
    setValue(value: string): void;
    onDidChangeModelContent: (callback: () => void) => {dispose(): void;};
    onDidChangeCursorSelection: (callback: () => void) => {dispose(): void;};
    getModel(): {uri: object; getValueInRange: () => string;};
    getSelection(): {
        endColumn: number;
        endLineNumber: number;
        startColumn: number;
        startLineNumber: number;
    };
    getDomNode(): HTMLElement;
    updateOptions(): void;
    getPosition(): {lineNumber: number; column: number;};
    trigger(): void;
    dispose(): void;
};
const monacoMock: {
    editor: {
        onDidChangeMarkers: () => {dispose(): void;};
        getModelMarkers: () => any[];
        create: () => MockMonacoEditor;
    };
} = {
    editor: {
        onDidChangeMarkers: () => ({
            dispose() {}
        }),
        getModelMarkers: () => [] as any[],
        create: () => {
            throw new Error("monaco editor create should be replaced in beforeEach");
        }
    }
};
type RAfHandle = {id: number; callback: FrameRequestCallback;};

let currentValue = "";
let monacoFocusCalls = 0;
let monacoCreateCalls = 0;
let fallbackFocusCalls = 0;
const originalTextareaFocus = HTMLTextAreaElement.prototype.focus;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;
let requestAnimationFrames: RAfHandle[] = [];
let requestAnimationFrameHandle = 0;

const flushAnimationFrames = () => {
    const frames = [...requestAnimationFrames];
    requestAnimationFrames = [];
    for (const frame of frames) frame.callback(0);
};

mock.module("@modules/discordmodules", () => ({
    "default": {
        Tooltip: ({children}: {children: (props: Record<string, unknown>) => React.ReactNode}) => children({})
    }
}));
mock.module("@modules/editor", () => ({"default": editorModule}));
mock.module("@stores/editor", () => ({
    "default": {
        getEditorOptions: () => ({theme: "midnight"}),
        addChangeListener: () => () => {}
    }
}));
mock.module("@stores/settings", () => ({
    "default": {
        get: (_collection: string, _category: string, key: string) => {
            if (key === "insertSpaces") return false;
            if (key === "tabSize") return 4;
            return undefined;
        },
        addChangeListener: () => () => {},
        removeChangeListener: () => {}
    }
}));
mock.module("@modules/patcher", () => ({
    "default": {
        instead: () => () => {},
        unpatchAll: () => {}
    }
}));

let lockStackCandidate: unknown;
const lockLookups: Array<{fatal?: boolean; cacheId?: string}> = [];
mock.module("@webpack", () => ({
    getModule: (filter: (value: unknown) => boolean, options: {fatal?: boolean; cacheId?: string}) => {
        lockLookups.push(options);
        return lockStackCandidate && filter(lockStackCandidate) ? lockStackCandidate : undefined;
    }
}));

type LockEntry = {uid: string; setEnabled(enabled: boolean): void; enabled: boolean};

// Representative native stack behavior: only the top owner is enabled. The
// real CodeEditor supplies its own lookup, event handlers and cleanup.
function createLockStack() {
    return {
        locks: [] as LockEntry[],
        toggleLayer(entry: LockEntry | undefined, enabled: boolean) {
            if (!entry) return;
            entry.setEnabled(enabled);
            entry.enabled = enabled;
        },
        current(): LockEntry | undefined {return this.locks[this.locks.length - 1];},
        add(uid: string, setEnabled: (enabled: boolean) => void) {
            this.toggleLayer(this.current(), false);
            const entry = {uid, setEnabled, enabled: false};
            this.locks.push(entry);
            this.toggleLayer(entry, true);
        },
        remove(uid: string) {
            this.toggleLayer(this.locks.find(entry => entry.uid === uid), false);
            const wasCurrent = this.current()?.uid === uid;
            this.locks = this.locks.filter(entry => entry.uid !== uid);
            if (wasCurrent) this.toggleLayer(this.current(), true);
        }
    };
}

const {"default": CodeEditor} = await import("@ui/customcss/editor");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    lockStackCandidate = undefined;
    lockLookups.length = 0;

    monacoFocusCalls = 0;
    monacoCreateCalls = 0;
    fallbackFocusCalls = 0;
    currentValue = "";
    requestAnimationFrames = [];
    requestAnimationFrameHandle = 0;

    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        const handle = ++requestAnimationFrameHandle;
        requestAnimationFrames.push({id: handle, callback});
        return handle;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
        requestAnimationFrames = requestAnimationFrames.filter((entry) => entry.id !== handle);
    }) as typeof window.cancelAnimationFrame;

    Object.defineProperty(HTMLTextAreaElement.prototype, "focus", {
        configurable: true,
        value: () => {
            fallbackFocusCalls += 1;
        },
        writable: true
    });

    monacoMock.editor.create = () => {
        monacoCreateCalls += 1;

        return {
            focus: () => {
                monacoFocusCalls += 1;
            },
            layout: () => {},
            getValue: () => currentValue,
            setValue: () => {},
            onDidChangeModelContent: () => ({
                dispose() {}
            }),
            onDidChangeCursorSelection: () => ({
                dispose() {}
            }),
            getModel: () => ({
                uri: {},
                getValueInRange: () => ""
            }),
            getSelection: () => ({
                endColumn: 1,
                endLineNumber: 1,
                startColumn: 1,
                startLineNumber: 1
            }),
            getDomNode: () => document.createElement("div"),
            updateOptions: () => {},
            getPosition: () => ({lineNumber: 1, column: 1}),
            trigger: () => {},
            dispose: () => {}
        } as MockMonacoEditor;
    };

    window.monaco = monacoMock as any;
    editorModule.failedToLoad = false;
    editorModule.initialize = async () => {};
});

afterEach(async () => {
    await act(async () => root.unmount());
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    requestAnimationFrames = [];
    container.remove();

    Object.defineProperty(HTMLTextAreaElement.prototype, "focus", {
        configurable: true,
        value: originalTextareaFocus,
        writable: true
    });
});

describe("CodeEditor", () => {
    test("focuses Monaco editor only once on mount even when value changes", async () => {
        currentValue = "first";
        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus id="bd-editor-focused-test" />);
        });
        await act(async () => Promise.resolve());

        expect(monacoCreateCalls).toBe(1);
        expect(monacoFocusCalls).toBe(1);

        currentValue = "second";
        await act(async () => {
            root.render(<CodeEditor value="second" controls={[]} onChange={() => {}} autoFocus id="bd-editor-focused-test" />);
        });
        await act(async () => Promise.resolve());

        expect(monacoCreateCalls).toBe(2);
        expect(monacoFocusCalls).toBe(1);
    });

    test("does not focus Monaco when autoFocus is disabled", async () => {
        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} id="bd-editor-unfocused-test" />);
        });
        await act(async () => Promise.resolve());

        expect(monacoCreateCalls).toBe(1);
        expect(monacoFocusCalls).toBe(0);
        expect(lockLookups.length).toBe(0); // Embedded editors never claim a floating layer.
    });

    test("focuses and cleans up the fallback textarea without refocusing", async () => {
        editorModule.failedToLoad = true;

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus id="bd-fallback-focused-test" />);
        });
        await act(async () => Promise.resolve());

        expect(container.querySelectorAll("textarea.bd-fallback-editor")).toHaveLength(1);
        expect(fallbackFocusCalls).toBe(1);

        await act(async () => {
            root.render(<CodeEditor value="second" controls={[]} onChange={() => {}} autoFocus id="bd-fallback-focused-test" />);
        });
        await act(async () => Promise.resolve());

        expect(container.querySelectorAll("textarea.bd-fallback-editor")).toHaveLength(1);
        expect(fallbackFocusCalls).toBe(1);
    });

    test("defers autofocus until connected target disconnects and focuses on next animation frame", async () => {
        const target = document.createElement("button");
        container.append(target);

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-target" />);
        });
        await act(async () => Promise.resolve());
        expect(monacoFocusCalls).toBe(0);

        target.remove();
        await act(async () => Promise.resolve());
        expect(monacoFocusCalls).toBe(0);

        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(1);
        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(1);
    });

    test("focuses on the next animation frame when the target is already disconnected", async () => {
        const target = document.createElement("button");

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-already-disconnected" />);
        });
        await act(async () => Promise.resolve());
        expect(monacoFocusCalls).toBe(0);

        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(1);
    });

    test("does not autofocus for unusable deferred targets", async () => {
        const cases = [
            {name: "null", target: null as unknown as null},
            {name: "body", target: document.body as unknown as Element},
            {name: "html", target: document.documentElement as unknown as Element}
        ];

        for (const {name, target} of cases) {
            monacoFocusCalls = 0;

            await act(async () => {
                root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target as Element | null} id={`bd-editor-unusable-${name}`} />);
            });
            await act(async () => Promise.resolve());
            await act(async () => {
                flushAnimationFrames();
            });

            expect(monacoFocusCalls).toBe(0);
        }
    });

    test("does not autofocus when target remains connected", async () => {
        const connectedTarget = document.createElement("button");
        document.body.append(connectedTarget);

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={connectedTarget} id="bd-editor-unusable-connected" />);
        });
        await act(async () => Promise.resolve());
        await act(async () => {
            flushAnimationFrames();
        });

        expect(monacoFocusCalls).toBe(0);
        connectedTarget.remove();
    });

    test("does not autofocus after rerender or blur for deferred fallback editor", async () => {
        const target = document.createElement("button");
        editorModule.failedToLoad = true;

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-fallback-rerender" />);
        });
        await act(async () => {
            flushAnimationFrames();
        });
        expect(fallbackFocusCalls).toBe(1);

        const textarea = container.querySelector("textarea.bd-fallback-editor");
        expect(textarea).not.toBeNull();
        textarea?.dispatchEvent(new Event("blur", {bubbles: true}));

        currentValue = "second";
        await act(async () => {
            root.render(<CodeEditor value="second" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-fallback-rerender" />);
        });
        await act(async () => Promise.resolve());
        await act(async () => {
            flushAnimationFrames();
        });
        expect(fallbackFocusCalls).toBe(1);
    });

    test("does not focus when detached editor unmounts before disconnect", async () => {
        const target = document.createElement("button");
        container.append(target);

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-detach-unmount-before-disconnect" />);
        });
        await act(async () => Promise.resolve());
        expect(monacoFocusCalls).toBe(0);

        await act(async () => {
            root.unmount();
        });
        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(0);
    });

    test("does not focus after disconnect when unmounted before scheduled animation frame", async () => {
        const target = document.createElement("button");
        container.append(target);

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-detach-unmount-after-disconnect" />);
        });
        await act(async () => Promise.resolve());

        target.remove();
        await act(async () => Promise.resolve());
        await act(async () => {
            root.unmount();
        });
        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(0);
    });

    test("deferred autofocus is one-shot across rerender without duplicating focus", async () => {
        const target = document.createElement("button");

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-rerender" />);
        });
        await act(async () => Promise.resolve());
        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(1);

        currentValue = "second";
        await act(async () => {
            root.render(<CodeEditor value="second" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-rerender" />);
        });
        await act(async () => Promise.resolve());
        await act(async () => {
            flushAnimationFrames();
        });
        expect(monacoFocusCalls).toBe(1);
    });

    test("deferred autofocus works for fallback editor path", async () => {
        editorModule.failedToLoad = true;
        const target = document.createElement("button");

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-defer-fallback" />);
        });
        await act(async () => Promise.resolve());

        expect(fallbackFocusCalls).toBe(0);
        await act(async () => {
            flushAnimationFrames();
        });
        expect(fallbackFocusCalls).toBe(1);
    });

    test("does not create an editor or autofocus when Monaco loading resolves after unmount", async () => {
        let resolveInitialize!: () => void;
        editorModule.initialize = () => new Promise<void>((resolve) => {
            resolveInitialize = resolve;
        });
        window.monaco = undefined as any;

        const target = document.createElement("button");
        document.body.append(target);

        await act(async () => {
            root.render(<CodeEditor value="first" controls={[]} onChange={() => {}} autoFocus autoFocusAfterElementRemoved={target} id="bd-editor-late-initialize" />);
        });
        expect(monacoCreateCalls).toBe(0);

        await act(async () => {
            root.unmount();
        });
        await act(async () => {
            resolveInitialize();
            await Promise.resolve();
        });

        target.remove();
        await act(async () => Promise.resolve());
        await act(async () => {
            flushAnimationFrames();
        });

        expect(monacoCreateCalls).toBe(0);
        expect(monacoFocusCalls).toBe(0);
        expect(fallbackFocusCalls).toBe(0);
        expect(container.querySelector("textarea.bd-fallback-editor")).toBeNull();
        expect(requestAnimationFrames).toHaveLength(0);
    });

    test("floating editors transfer lock ownership without removing foreign modal layers", async () => {
        const stack = createLockStack();
        lockStackCandidate = stack;
        let settingsEnabled = false;
        stack.add("native-settings", enabled => {settingsEnabled = enabled;});
        await act(async () => {
            root.render(<>
                <div className="floating-window"><CodeEditor value="first" controls={[]} onChange={() => {}} id="floating-first"/></div>
                <div className="floating-window"><CodeEditor value="second" controls={[]} onChange={() => {}} id="floating-second"/></div>
                <input aria-label="Foreign modal input"/>
            </>);
        });
        const first = container.querySelector<HTMLElement>("#floating-first")!;
        const second = container.querySelector<HTMLElement>("#floating-second")!;
        const modalInput = container.querySelector<HTMLElement>("input")!;
        const interact = (node: HTMLElement, type: string) => node.dispatchEvent(new Event(type, {bubbles: true}));
        expect(lockLookups.length).toBe(2);
        expect(lockLookups.every(options => options.fatal === false)).toBe(true);
        expect(stack.current()?.uid).toBe("native-settings");

        interact(first, "pointerdown");
        const firstUid = stack.current()!.uid;
        expect(firstUid.startsWith("bd-editor-window-")).toBe(true);
        expect(settingsEnabled).toBe(false);
        interact(first, "focusin");
        expect(stack.locks.length).toBe(2); // Repeated interaction does not duplicate ownership.

        interact(second, "pointerdown");
        const secondUid = stack.current()!.uid;
        expect(secondUid).not.toBe(firstUid);
        interact(second, "focusin");
        expect(stack.locks.map(entry => entry.uid)).toEqual(["native-settings", secondUid]);

        // A native modal can become the newest lock above an active editor.
        stack.add("native-modal", () => {});
        expect(stack.current()?.uid).toBe("native-modal");
        interact(modalInput, "focusin");
        expect(stack.locks.map(entry => entry.uid)).toEqual(["native-settings", "native-modal"]);

        // Pointer interaction can reprioritize this editor even while its layer
        // remains below another native layer; it must remove only its own uid.
        interact(first, "pointerdown");
        stack.add("new-native-modal", () => {});
        interact(first, "pointerdown");
        expect(stack.current()?.uid).toBe(firstUid);
        expect(stack.locks.filter(entry => entry.uid === firstUid).length).toBe(1);
        expect(stack.locks.some(entry => entry.uid === "new-native-modal")).toBe(true);
        interact(modalInput, "pointerdown");
        expect(stack.current()?.uid).toBe(firstUid); // Outside pointer alone does not release focus ownership.
        interact(modalInput, "focusin");
        expect(stack.current()?.uid).toBe("new-native-modal");

        await act(async () => root.render(null));
        expect(stack.locks.map(entry => entry.uid)).toEqual(["native-settings", "native-modal", "new-native-modal"]);
    });

    test("floating focus layers initialize from current focus and release their listeners and owned lock", async () => {
        const stack = createLockStack();
        lockStackCandidate = stack;
        stack.add("native-settings", () => {});
        function FocusedWindow() {
            const input = React.useRef<HTMLInputElement>(null);
            React.useLayoutEffect(() => {input.current?.focus();}, []);
            return <div className="floating-window"><input ref={input}/><CodeEditor value="focused" controls={[]} onChange={() => {}} id="floating-focused"/></div>;
        }
        const addListener = spyOn(document, "addEventListener");
        const removeListener = spyOn(document, "removeEventListener");
        try {
            await act(async () => {
                root.render(<FocusedWindow/>);
            });
            expect(stack.current()?.uid.startsWith("bd-editor-window-")).toBe(true);
            const registrations = addListener.mock.calls.filter(([type, , options]) => (type === "pointerdown" || type === "focusin") && options === true);
            expect(registrations.length).toBe(2);
            await act(async () => root.render(null));
            expect(stack.locks.map(entry => entry.uid)).toEqual(["native-settings"]);
            for (const registration of registrations) {
                expect(removeListener.mock.calls.some(call => call[0] === registration[0] && call[1] === registration[1] && call[2] === registration[2])).toBe(true);
            }
        }
        finally {
            addListener.mockRestore();
            removeListener.mockRestore();
        }
    });

    test("floating editors safely skip missing or incomplete focus-stack capabilities and retry on a new mount", async () => {
        container.className = "floating-window";
        const stack = createLockStack();
        const missingCapabilities = [undefined, ...["locks", "toggleLayer", "add", "remove", "current"].map(key => ({...stack, [key]: undefined}))];
        for (const [index, candidate] of missingCapabilities.entries()) {
            lockStackCandidate = candidate;
            await act(async () => {
                root.render(<CodeEditor key={index} value="unsupported" controls={[]} onChange={() => {}} id="floating-unsupported"/>);
            });
            container.querySelector(".editor")!.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            expect(stack.locks.length).toBe(0);
        }
        expect(lockLookups.length).toBe(missingCapabilities.length);
        lockStackCandidate = stack;
        await act(async () => {
            root.render(<CodeEditor key="available" value="supported" controls={[]} onChange={() => {}} id="floating-supported"/>);
        });
        container.querySelector(".editor")!.dispatchEvent(new Event("pointerdown", {bubbles: true}));
        expect(stack.current()?.uid.startsWith("bd-editor-window-")).toBe(true);
        await act(async () => root.render(null));
        expect(stack.locks.length).toBe(0);
    });
});
