import {GlobalRegistrator} from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const editorType = process.env.EDITOR_SCRIPT_TYPE ?? "plugin";
let focusCalls = 0;

document.body.innerHTML = `
    <div id="language"></div>
    <button id="open-editor"></button>
    <div id="loader"></div>
    <div id="tabbar"></div>
    <div id="action-bar"></div>
    <span id="tab-size"></span>
    <span id="errors"></span>
    <span id="warnings"></span>
    <div id="editor"></div>
    <span id="live-update-wrapper"><input id="live-update" type="checkbox" checked /></span>
    <div id="refresh"></div>
    <div id="current-position"></div>
    <button id="action-current-position"></button>
    <button id="save"></button>
    <button id="wndow-unpinned"></button>
    <button id="wndow-pinned"></button>
`;

const model = {
    uri: {},
    getFullModelRange: () => ({}),
    getValueInRange: () => ""
};

const editor = {
    focus: () => {
        focusCalls += 1;
    },
    getDomNode: () => document.getElementById("editor")!,
    getValue: () => "body {}",
    setValue: () => {},
    onDidChangeModelContent: () => ({dispose() {}}),
    onDidChangeCursorSelection: () => ({dispose() {}}),
    getModel: () => model,
    getSelection: () => ({startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1}),
    getPosition: () => ({lineNumber: 1, column: 1}),
    updateOptions: () => {},
    layout: () => {},
    trigger: () => {},
    executeEdits: () => {},
    dispose: () => {}
};

const monaco = {
    languages: {
        typescript: {
            ScriptTarget: {ESNext: 0},
            javascriptDefaults: {
                setDiagnosticsOptions: () => {},
                setCompilerOptions: () => {}
            }
        }
    },
    editor: {
        onDidChangeMarkers: () => ({dispose() {}}),
        getModelMarkers: () => [],
        create: () => editor
    }
};

const amdLoader = (files: string | string[], cb: (value: unknown) => void) => {
    if (!Array.isArray(files) || !files.includes("vs/editor/editor.main")) {
        return;
    }
    cb(monaco);
};
amdLoader.config = () => {};

Object.assign(window, {
    require: amdLoader,
    Editor: {
        filename: "test-editor",
        type: editorType,
        settings: {
            get: () => ({options: {insertSpaces: true, tabSize: 2}, liveUpdate: false, discordTheme: "dark", alwaysOnTop: false}),
            subscribe: () => {}
        },
        open: () => {},
        read: () => "body {}",
        write: () => {},
        readText: "",
        shouldShowWarning: () => {}
    }
});

await import("../src/editor/script.ts");

await new Promise((resolve) => setTimeout(resolve));

process.stdout.write(`editor-script-autofocus: ok ${editorType} ${focusCalls}`);
