import {expect, mock, test} from "bun:test";

const scenario = process.env.CONTEXTMENU_WEBPACK_SCENARIO;
if (!scenario) throw new Error("Missing context-menu webpack scenario");

const components = {
    bX: () => null,
    Dr: () => null,
    sL: () => null,
    iD: () => null,
    aK: () => null,
    rX: () => null,
    Menu: () => null
};
const moduleId = scenario === "rspack" ? "477782" : "legacy-menu";
const parserSource = [
    `n(${moduleId})`,
    "Menu API only allows Items and groups of Items as children",
    ".type===e.bX)return e.push({type:\"separator\",",
    ".type===e.iD)return e.push({type:\"radio\",",
    ".type===e.sL)return e.push({type:\"checkbox\",",
    ".type===e.aK)return e.push({type:\"control\",",
    ".type===e.Dr)return e.push({type:\"customitem\",",
    ".type===e.rX){x{type:\"groupstart\""
].join(";");
const currentFactorySource = "477782(e,t,n){\"use strict\";n.d(t,{},{Dr:function(e){return null},Yn:function(e){return null},aK:function(e){return null},bX:function(){return null},fP:function(e){return null},iD:function(e){return null},rX:function(e){return null},sL:function(e){return null}})}";
const legacyFactorySource = ["a", "b", "c", "d", "e"].map(name => `function ${name}(${name}){return null}`).join("");
const sourceModule = (source: string) => Object.assign(() => {}, {toString: () => source});
const requireModule = (id: string) => {
    if (scenario === "missing") throw new Error(`Unexpected require: ${id}`);
    expect(id).toBe(scenario === "rspack" ? "477782" : "legacy-menu");
    return components;
};
Object.assign(requireModule, {
    m: scenario === "missing" ? {} : {
        ...(scenario === "rspack" ? {477782: sourceModule(currentFactorySource)} : {"legacy-menu": sourceModule(legacyFactorySource)}),
        parser: sourceModule(parserSource)
    },
    c: {}
});

mock.module("@webpack", () => ({
    Filters: {bySource: () => () => true, byStrings: () => () => true},
    getByKeys: () => undefined,
    getLazyByKeys: async () => ({}),
    getBySource: () => ({closeContextMenu: () => {}, openContextMenu: () => {}}),
    getModule: () => components.Menu,
    webpackRequire: requireModule
}));
mock.module("@common/logger", () => ({"default": {error: () => {}, warn: () => {}, stacktrace: () => {}}}));
mock.module("@modules/discordmodules", () => ({"default": {Dispatcher: {addInterceptor: () => {}}}}));
mock.module("@modules/dommanager", () => ({"default": {injectStyle: () => {}}}));
mock.module("@modules/nodepatcher", () => ({"default": class {patch() {}}}));

const {default: ContextMenu} = await import("@api/contextmenu");
const menu = new ContextMenu();

test(`${scenario} fallback discovery`, () => {
    if (scenario === "missing") {
        expect(() => menu.patch("id", () => {})).not.toThrow();
        return;
    }
    expect(menu.Separator).toBe(components.bX);
    expect(menu.Item).toBe(components.Dr);
    expect(menu.CheckboxItem).toBe(components.sL);
    expect(menu.RadioItem).toBe(components.iD);
    expect(menu.ControlItem).toBe(components.aK);
    expect(menu.Group).toBe(components.rX);
    expect(menu.Menu).toBe(components.Menu);
});
