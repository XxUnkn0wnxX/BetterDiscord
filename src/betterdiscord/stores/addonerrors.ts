import type AddonError from "@structs/addonerror";
import Store from "./base";

export default new class AddonErrorsStore extends Store {
    pluginErrors: AddonError[] = [];
    themeErrors: AddonError[] = [];

    addPluginError(errors: AddonError) {
        this.pluginErrors.push(errors);
        this.emitChange();
    }

    addThemeError(errors: AddonError) {
        this.themeErrors.push(errors);
        this.emitChange();
    }

    clearErrors() {
        this.pluginErrors = [];
        this.themeErrors = [];
        this.emitChange();
    }
};