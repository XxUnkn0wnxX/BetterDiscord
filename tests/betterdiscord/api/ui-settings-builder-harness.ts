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

let notificationEnabled = false;
const notificationShowCalls: Array<Record<string, any>> = [];
const notificationHandle = {
    isVisible: () => true,
    close: () => {}
};

mock.module("react", () => ({"default": ReactMock, "useState": ReactMock.useState}));
mock.module("@modules/ipc", () => ({"default": {}}));
mock.module("@ui/modals", () => ({"default": {}}));
mock.module("@stores/toasts", () => ({"default": {}}));
mock.module("@ui/notices", () => ({"default": {}}));
mock.module("@ui/tooltip", () => ({"default": {}}));
mock.module("@ui/settings/group", () => ({"default": Group, buildSetting}));
mock.module("@ui/errorboundary", () => ({"default": (props: Record<string, any>) => props}));
mock.module("@stores/settings", () => ({"default": {
    get: () => notificationEnabled
}}));
mock.module("@stores/notifications", () => ({"default": {
    show(notification: Record<string, any>) {
        notificationShowCalls.push(notification);
        return notificationHandle;
    }
}}));
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

function testTopLevelNonSwitchCallbacks() {
    ReactMock.reset();
    buildCalls.length = 0;
    const callbackOrder: string[] = [];
    const panel: unknown[][] = [];
    const settings = [{
        type: "text",
        id: "root-text",
        value: "enabled",
        onChange(value: string) {
            callbackOrder.push(`setting:${value}`);
        }
    }];

    renderPanel(settings, (...args) => {
        callbackOrder.push(`panel:${String(args[0])}:${String(args[1])}:${String(args[2])}`);
        panel.push(args);
    });

    const text = latestBuilt("root-text");
    text.onChange("next");

    assert(callbackOrder.length === 2, "root non-switch callback was not dispatched once each");
    assert(callbackOrder[0] === "setting:next", "root individual callback was not first");
    assert(callbackOrder[1] === "panel:null:root-text:next", "root panel callback payload changed");
    assert(panel.length === 1, "root panel callback fired unexpected number of times");
    assert(panel[0][0] === null && panel[0][1] === "root-text" && panel[0][2] === "next", "root panel callback payload changed");
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

function testCategoryNonSwitchCallbacks() {
    ReactMock.reset();
    groups.length = 0;
    const individual: string[] = [];
    const panel: unknown[][] = [];
    const callbackOrder: string[] = [];
    const settings = [{
        type: "category",
        id: "callbacks",
        settings: [{
            type: "text",
            id: "setting",
            value: "enabled",
            onChange(value: string) {
                individual.push(`setting:${value}`);
                callbackOrder.push(`setting:${value}`);
            }
        }]
    }];

    renderPanel(settings, (...args) => {
        callbackOrder.push(`panel:${String(args[0])}:${String(args[1])}:${String(args[2])}`);
        panel.push(args);
    });
    const group = groups.at(-1)!;
    group.invoke("setting", "next");
    const lastPanelArgs = panel[0] as [unknown, unknown, unknown];
    assert(individual.length === 1, "category non-switch individual callback was duplicated");
    assert(panel.length === 1, "category non-switch panel callback was duplicated");
    assert(individual[0] === "setting:next", "category non-switch individual callback payload changed");
    assert(lastPanelArgs[0] === "callbacks" && lastPanelArgs[1] === "setting" && lastPanelArgs[2] === "next", "category panel callback payload changed");
    assert(callbackOrder.length === 2, "category non-switch callback dispatch order changed");
    assert(callbackOrder[0] === "setting:next", "category non-switch individual callback was not first");
    assert(callbackOrder[1] === "panel:callbacks:setting:next", "category non-switch panel callback was not second");
}

function testColorSettingNormalizationAndCallbacks() {
    ReactMock.reset();
    buildCalls.length = 0;
    groups.length = 0;

    const rootColorCallbacks: string[] = [];
    const rootLegacyColor = {
        type: "color",
        id: "legacy-root-color",
        value: "#112233",
        defaultValue: "#445566",
        onChange(value: string) {
            rootColorCallbacks.push(`setting:${value}`);
        }
    };
    const rootExplicitColor = {
        type: "color",
        id: "explicit-root-color",
        value: "#001100",
        defaultValue: "#002200",
        defaultColor: 0 as any,
        onChange(value: string) {
            rootColorCallbacks.push(`setting-explicit:${value}`);
        }
    };

    renderPanel([rootLegacyColor, rootExplicitColor], (...args) => {
        rootColorCallbacks.push(`panel:${String(args[0])}:${String(args[1])}:${String(args[2])}`);
    });

    const legacyColor = latestBuilt("legacy-root-color");
    const explicitColor = latestBuilt("explicit-root-color");
    assert(legacyColor.value === undefined, "root legacy color value was not removed");
    assert(legacyColor.defaultValue === "#112233", "root legacy color current value was not promoted");
    assert(legacyColor.defaultColor === "#445566", "root legacy defaultValue did not become defaultColor");
    assert(explicitColor.value === undefined, "root explicit color value was not removed");
    assert(explicitColor.defaultValue === "#001100", "root explicit color current value was not promoted");
    assert(explicitColor.defaultColor === 0, "explicit root defaultColor should win even when falsy");

    rootColorCallbacks.length = 0;
    const legacyColorSetting = latestBuilt("legacy-root-color");
    legacyColorSetting.onChange("#556677");
    assert(rootColorCallbacks.length === 2, "root color callbacks were not fired exactly once each");
    assert(rootColorCallbacks[0] === "setting:#556677", "root color individual callback changed");
    assert(rootColorCallbacks[1] === "panel:null:legacy-root-color:#556677", "root color panel callback should be last");

    buildCalls.length = 0;
    renderPanel([{
        type: "category",
        id: "color-category",
        settings: [{
            type: "color",
            id: "category-color",
            value: "#332211",
            defaultValue: "#445500"
        }]
    }]);
    const categoryGroup = groups.at(-1)!;
    const categoryColor = categoryGroup.props.settings.find((item: any) => item.id === "category-color");
    assert(categoryColor, "category color setting missing");
    assert(categoryColor.value === undefined, "category color value was not removed");
    assert(categoryColor.defaultValue === "#332211", "category color current value was not promoted");
    assert(categoryColor.defaultColor === "#445500", "category legacy defaultValue was not migrated to defaultColor");
}

function testShowNotification() {
    notificationShowCalls.length = 0;
    notificationEnabled = false;
    const disabledResult = ui.showNotification({content: "disabled"});
    assert(disabledResult === undefined, "disabled notifications should return undefined");
    assert(notificationShowCalls.length === 0, "disabled notifications should not call store.show");

    notificationEnabled = true;
    const render = () => null;
    const options = {content: "enabled", render};
    const result = ui.showNotification(options);
    assert(options.content === "enabled" && options.render === render && Object.keys(options).length === 2, "notification options were mutated");
    const showCalls = notificationShowCalls.slice();
    assert(showCalls.length === 1, "enabled notifications should call store.show once");

    const finalNotification = showCalls[0];
    assert(finalNotification.content === "enabled", "notification content changed");
    assert(finalNotification.title === "", "notification title default changed");
    assert(finalNotification.type === "info", "notification type default changed");
    assert(finalNotification.duration === 5000, "notification duration default changed");
    assert(Array.isArray(finalNotification.actions) && finalNotification.actions.length === 0, "notification actions default changed");
    assert(!Object.hasOwn(finalNotification, "id"), "anonymous notification received a synthetic id");
    assert(finalNotification.render === render, "notification render reference changed");
    assert(result === notificationHandle, "UI did not return the store notification handle");
}

testBuildSettingItemMapping();
testTopLevelDependenciesAndCallbacks();
testNestedDependenciesAndCallbacks();
testTopLevelNonSwitchCallbacks();
testCategoryNonSwitchCallbacks();
testColorSettingNormalizationAndCallbacks();
testShowNotification();
process.stdout.write("ui-settings-builder: ok\n");
