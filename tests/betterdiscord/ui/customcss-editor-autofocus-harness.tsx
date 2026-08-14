import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
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
let currentValue = "";
let monacoFocusCalls = 0;
let monacoCreateCalls = 0;
let fallbackFocusCalls = 0;
const originalTextareaFocus = HTMLTextAreaElement.prototype.focus;

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

const {"default": CodeEditor} = await import("@ui/customcss/editor");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    monacoFocusCalls = 0;
    monacoCreateCalls = 0;
    fallbackFocusCalls = 0;
    currentValue = "";

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
});

afterEach(async () => {
    await act(async () => root.unmount());
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
});
