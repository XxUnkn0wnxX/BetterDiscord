import {describe, test, expect} from "bun:test";
import findFunctionBodyStart from "@common/findFunctionBodyStart";

describe("findFunctionBodyStart", () => {
    test("classic function wrapper", () => {
        const tested = "function(e,t,n){\"use strict\";const a=1;}";
        const bodyStart = findFunctionBodyStart(tested);

        expect(bodyStart).toBe(tested.indexOf("{") + 1);
        expect(tested.slice(bodyStart)).toBe("\"use strict\";const a=1;}");
    });

    test("arrow function wrapper", () => {
        const tested = "(e,t,n)=>{\"use strict\";const a=1;}";
        const bodyStart = findFunctionBodyStart(tested);

        expect(bodyStart).toBe(tested.indexOf("{") + 1);
        expect(tested.slice(bodyStart)).toBe("\"use strict\";const a=1;}");
    });

    test("arrow function wrapper with whitespace", () => {
        const tested = "(e,t,n) => {\"use strict\";const a=1;}";
        const bodyStart = findFunctionBodyStart(tested);

        expect(bodyStart).toBe(tested.indexOf("{") + 1);
        expect(tested.slice(bodyStart)).toBe("\"use strict\";const a=1;}");
    });
});
