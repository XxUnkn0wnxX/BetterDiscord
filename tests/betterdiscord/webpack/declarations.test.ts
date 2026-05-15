import {describe, expect, test} from "bun:test";
import {getDeclaration} from "../../../src/betterdiscord/webpack/shared";
import {mapObject} from "../../../src/betterdiscord/utils/object";

describe("declaration access", () => {
    test("getDeclaration skips throwing declaration getters", () => {
        const module = {
            declarations: Object.create(null, {
                bad: {
                    enumerable: true,
                    get() {
                        throw new ReferenceError("bad declaration");
                    }
                },
                good: {
                    enumerable: true,
                    get() {
                        return {type: "good"};
                    }
                }
            })
        };

        expect(getDeclaration(module as any, value => value?.type === "good")).toEqual({type: "good"});
    });

    test("mapObject skips throwing declaration getters", () => {
        const module = Object.create(null, {
            bad: {
                enumerable: true,
                get() {
                    throw new ReferenceError("bad declaration");
                }
            },
            good: {
                enumerable: true,
                get() {
                    return {type: "good"};
                }
            }
        });

        const mapped = mapObject<{target: {type: string}; missing: undefined}>(module, {
            target: value => value?.type === "good",
            missing: value => value?.type === "missing"
        });

        expect(mapped.target).toEqual({type: "good"});
        expect(mapped.missing).toBeUndefined();
    });

    test("mapObject returns undefined entries when module is missing", () => {
        const mapped = mapObject<{target: undefined; missing: undefined}>(undefined, {
            target: value => value?.type === "good",
            missing: value => value?.type === "missing"
        });

        expect(mapped.target).toBeUndefined();
        expect(mapped.missing).toBeUndefined();
    });
});
