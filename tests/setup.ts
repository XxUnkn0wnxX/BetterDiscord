import {GlobalRegistrator} from "@happy-dom/global-registrator";
import {release} from "node:os";

export const hasLegacyBunIntlCrash = process.platform === "darwin"
    && process.versions.bun === "1.1.20"
    && release().startsWith("20.");

if (hasLegacyBunIntlCrash) {
    class LegacyPluralRules {
        select(value: number) {return Math.abs(value) === 1 ? "one" : "other";}
    }

    Object.defineProperty(Intl, "PluralRules", {configurable: true, value: LegacyPluralRules, writable: true});
}

GlobalRegistrator.register();
