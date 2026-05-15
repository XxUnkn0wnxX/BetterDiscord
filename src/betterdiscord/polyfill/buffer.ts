import Logger from "@common/logger";
import {Buffer} from "../../../node_modules/buffer/index";

let hasWarnedForGlobalBuffer = false;

Object.defineProperty(window, "Buffer", {
    get() {
        if (!hasWarnedForGlobalBuffer) {
            hasWarnedForGlobalBuffer = true;
            Logger.warn("Deprecated", "Usage of the Buffer global is deprecated. Consider using web standards such as Uint8Array and TextDecoder/TextEncoder.");
        }
        return Buffer;
    },
    configurable: true,
    enumerable: false
});

export default Buffer;
