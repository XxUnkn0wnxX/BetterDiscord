import Builtin from "@structs/builtin";

import {parseWebpackSourceLink} from "@common/webpackSource";
import RemoteAPI from "@polyfill/remote";
import Settings from "@stores/settings";
import IPC from "@modules/ipc";
import {retainBetterDiscordProtocol} from "@utils/betterdiscordprotocol";

export default new class WebpackSourceViewer extends Builtin {
    private protocolRelease?: () => void;
    private hasInitialized = false;

    get name() {return "WebpackSourceViewer";}
    get category() {return "developer";}
    get id() {return "webpackSourceViewer";}

    private updateProtocolRegistration = () => {
        const enabled = this.get<boolean>("devTools") && this.get<boolean>(this.id);

        if (enabled) {
            this.protocolRelease ??= retainBetterDiscordProtocol();
            return;
        }

        this.protocolRelease?.();
        this.protocolRelease = undefined;
    };

    private handleProtocol = (link: string) => {
        if (!this.get<boolean>("devTools") || !this.get<boolean>(this.id)) return;

        const source = parseWebpackSourceLink(link);
        if (!source) return;

        try {
            void IPC.openDevtoolsSource(source.url, source.line, source.column).catch(error => {
                this.stacktrace("Could not open webpack source in DevTools", error instanceof Error ? error : new Error(String(error)));
            });
        }
        catch (error) {
            this.stacktrace("Could not open webpack source in DevTools", error instanceof Error ? error : new Error(String(error)));
        }
    };

    private handleDevToolsSetting = () => this.updateProtocolRegistration();

    async initialize() {
        if (this.hasInitialized) return;
        this.hasInitialized = true;

        RemoteAPI.addProtocolListener(this.handleProtocol);
        Settings.on(this.collection, this.category, "devTools", this.handleDevToolsSetting);

        return super.initialize();
    }

    async enabled() {
        this.updateProtocolRegistration();
    }

    async disabled() {
        this.updateProtocolRegistration();
    }
};
