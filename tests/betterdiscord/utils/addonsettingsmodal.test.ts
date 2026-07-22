import {describe, expect, test} from "bun:test";

import Events from "@modules/emitter";
import {watchAddonSettingsUnload} from "@utils/addonsettingsmodal";

describe("addon settings modal hot reload", () => {
    test("closes a plugin modal only for its matching unload", () => {
        let closeCount = 0;
        const cleanup = watchAddonSettingsUnload({id: "ExamplePlugin", type: "plugin"}, () => closeCount++);

        Events.emit("theme-unloaded", {id: "ExamplePlugin"});
        Events.emit("plugin-unloaded", {id: "OtherPlugin"});
        expect(closeCount).toBe(0);

        Events.emit("plugin-unloaded", {id: "ExamplePlugin"});
        Events.emit("plugin-unloaded", {id: "ExamplePlugin"});
        expect(closeCount).toBe(1);

        cleanup();
    });

    test("closes a theme modal only for its matching unload", () => {
        let closeCount = 0;
        const cleanup = watchAddonSettingsUnload({id: "ExampleTheme", type: "theme"}, () => closeCount++);

        Events.emit("theme-unloaded", {id: "OtherTheme"});
        expect(closeCount).toBe(0);

        Events.emit("theme-unloaded", {id: "ExampleTheme"});
        expect(closeCount).toBe(1);

        cleanup();
    });

    test("removes the listener after manual close", () => {
        let closeCount = 0;
        const cleanup = watchAddonSettingsUnload({id: "ExampleTheme", type: "theme"}, () => closeCount++);

        cleanup();
        Events.emit("theme-unloaded", {id: "ExampleTheme"});
        expect(closeCount).toBe(0);
    });
});
