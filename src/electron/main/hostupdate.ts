import {EventEmitter} from "events";


const supportedPlatforms: NodeJS.Platform[] = ["win32", "linux"];

export function installHostUpdatedMigrationHook(platform: NodeJS.Platform, migrate: () => void, emitter: typeof EventEmitter = EventEmitter) {
    if (!supportedPlatforms.includes(platform)) return;

    emitter.prototype.emit = new Proxy(emitter.prototype.emit, {
        apply(target, thisArg, argArray) {
            if (argArray[0] === "host-updated") {
                try {migrate();}
                catch {/* Migration failures must never suppress the host update event. */}
            }

            return Reflect.apply(target, thisArg, argArray);
        },
    });
}
