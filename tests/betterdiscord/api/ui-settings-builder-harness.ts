import {mock} from "bun:test";

type Element = {
    type: unknown;
    props: Record<string, any>;
};

const buildCalls: Array<Record<string, any>> = [];
const groups: Array<{props: Record<string, any>; invoke(id: string, value: any): void;}> = [];

let resetState: () => void = () => {};
const ReactMock = {
    createElement(type: unknown, props: Record<string, any> | null, ...children: unknown[]): Element {
        const nextProps = {...props};
        if (children.length === 1) nextProps.children = children[0];
        if (children.length > 1) nextProps.children = children;
        return {type, props: nextProps};
    },
    useState: (() => {
        let initialized = false;
        let state: any;
        let setState: (next: any) => void;

        resetState = () => {
            initialized = false;
            state = undefined;
        };

        return (initial: any) => {
            if (!initialized) {
                state = typeof initial === "function" ? initial() : initial;
                initialized = true;
            }

            setState = (next: any) => {
                state = typeof next === "function" ? next(state) : next;
            };
            return [state, setState];
        };
    })(),
    reset: () => resetState()
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function Group(props: Record<string, any>) {
    const group = {
        props,
        invoke(id: string, value: any) {
            const setting = props.settings.find((item: Record<string, any>) => item.id === id);
            setting?.onChange?.(value);
            props.onChange?.(props.id, id, value);
        }
    };
    groups.push(group);
    return {type: Group, props};
}

function buildSetting(setting: Record<string, any>) {
    buildCalls.push(setting);
    return {type: buildSetting, props: setting};
}

mock.module("react", () => ({"default": ReactMock, "useState": ReactMock.useState}));
mock.module("@modules/ipc", () => ({"default": {}}));
mock.module("@ui/modals", () => ({"default": {}}));
mock.module("@stores/toasts", () => ({"default": {}}));
mock.module("@ui/notices", () => ({"default": {}}));
mock.module("@ui/tooltip", () => ({"default": {}}));
mock.module("@ui/settings/group", () => ({"default": Group, buildSetting}));
mock.module("@ui/errorboundary", () => ({"default": (props: Record<string, any>) => props}));
mock.module("@stores/settings", () => ({"default": {}}));
mock.module("@ui/notifications", () => ({"default": {}}));
mock.module("@ui/floatingwindows", () => ({"default": {}}));

const {default: UI} = await import("../../../src/betterdiscord/api/ui");
const ui = new UI();

function renderPanel(settings: any[], onChange?: (...args: any[]) => void) {
    const panel = ui.buildSettingsPanel({settings, onChange}) as unknown as Element;
    if (!(panel.type instanceof Function)) return panel;

    const boundary = (panel.type as (props: Record<string, any>) => Element)(panel.props);
    const children = boundary.props.children as Element[];
    for (const child of children) {
        if (child?.type === Group) Group(child.props);
    }
    return boundary;
}

function latestBuilt(id: string) {
    const setting = [...buildCalls].reverse().find(item => item.id === id);
    assert(setting, `No built setting for ${id}`);
    return setting;
}

function testBuildSettingItemMapping() {
    buildCalls.length = 0;
    const color = {
        type: "color",
        id: "color",
        value: "#112233",
        defaultValue: "#445566"
    };
    const original = JSON.stringify(color);
    ui.buildSettingItem(color as any);
    const mapped = buildCalls.at(-1)!;
    assert(mapped.value === undefined, "value should be removed from color props");
    assert(mapped.defaultValue === "#112233", "current color should become defaultValue");
    assert(mapped.defaultColor === "#445566", "legacy color default should become defaultColor");
    assert(JSON.stringify(color) === original, "buildSettingItem mutated the color setting");

    ui.buildSettingItem({
        type: "color",
        id: "explicit-color",
        value: "#112233",
        defaultValue: "#445566",
        defaultColor: 0
    } as any);
    const explicit = buildCalls.at(-1)!;
    assert(explicit.defaultValue === "#112233", "explicit color current value was lost");
    assert(explicit.defaultColor === 0, "numeric zero defaultColor must win");

    const button = {type: "button", id: "button", children: "button"};
    ui.buildSettingItem(button as any);
    const passthrough = buildCalls.at(-1)!;
    assert(JSON.stringify(passthrough) === JSON.stringify(button), "button without value should pass through safely");
}

function testTopLevelDependenciesAndCallbacks() {
    ReactMock.reset();
    buildCalls.length = 0;
    const changes: unknown[][] = [];
    const panel: unknown[][] = [];
    const settings = [
        {type: "switch", id: "controller", value: false, onChange: (value: boolean) => changes.push(["setting", value])},
        {type: "text", id: "enabled", value: "enabled", enableWith: "controller"},
        {type: "text", id: "disabled", value: "disabled", disableWith: "controller"}
    ];
    const boundary = renderPanel(settings, (...args) => panel.push(args)) as any;
    assert(latestBuilt("enabled").disabled === true, "top-level enableWith should start disabled");
    assert(latestBuilt("disabled").disabled === false, "top-level disableWith should start enabled");
    assert(boundary.props.id === "buildSettingsPanel", "panel error boundary identity changed");

    const controller = latestBuilt("controller");
    controller.onChange(true);
    assert(changes.length === 1 && changes[0].join(":") === "setting:true", "individual callback was duplicated");
    assert(panel.length === 1 && panel[0].join(":") === ":controller:true", "root panel callback IDs changed");

    buildCalls.length = 0;
    renderPanel(settings);
    assert(latestBuilt("enabled").disabled === false, "top-level enableWith did not update");
    assert(latestBuilt("disabled").disabled === true, "top-level disableWith did not update");
}

function testNestedDependenciesAndCallbacks() {
    ReactMock.reset();
    groups.length = 0;
    const individual: unknown[] = [];
    const settings = [{
        type: "category",
        id: "category",
        settings: [
            {type: "switch", id: "controller", value: false},
            {type: "text", id: "enabled", value: "enabled", enableWith: "controller"},
            {type: "text", id: "disabled", value: "disabled", disableWith: "controller"}
        ]
    }];

    renderPanel(settings);
    let group = groups.at(-1)!;
    const nested = (id: string) => group.props.settings.find((item: any) => item.id === id);
    assert(nested("enabled").disabled === true, "nested enableWith should start disabled");
    assert(nested("disabled").disabled === false, "nested disableWith should start enabled");

    group.invoke("controller", true);
    renderPanel(settings);
    group = groups.at(-1)!;
    assert(nested("enabled").disabled === false, "nested enableWith did not update");
    assert(nested("disabled").disabled === true, "nested disableWith did not update");

    const callbackSettings = [{
        type: "category",
        id: "callbacks",
        settings: [{
            type: "switch",
            id: "switch",
            value: false,
            onChange(value: boolean) {individual.push(value);}
        }]
    }];
    const callbackPanel: unknown[][] = [];
    ReactMock.reset();
    renderPanel(callbackSettings, (...args) => callbackPanel.push(args));
    const callbackGroup = groups.at(-1)!;
    callbackGroup.invoke("switch", true);
    assert(individual.length === 1, "individual callback was duplicated");
    assert(callbackPanel.length === 1 && callbackPanel[0].join(":") === "callbacks:switch:true", "panel callback IDs changed");
}

testBuildSettingItemMapping();
testTopLevelDependenciesAndCallbacks();
testNestedDependenciesAndCallbacks();
process.stdout.write("ui-settings-builder: ok\n");
