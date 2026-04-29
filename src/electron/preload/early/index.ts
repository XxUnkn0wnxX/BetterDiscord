import Logger from "@common/logger";
import type {RawModule} from "../../../betterdiscord/types/discord/webpack";
import * as acorn from "acorn";

const getPrefix = /^(.*?)\(/;
// Functions like ones from objects ({ a() {} }) will throw so we replace 'a' with 'function'
function toStringFunction(fn: (...args: any[]) => any): string {
    const stringed = Function.prototype.toString.call(fn);
    const match = stringed.match(getPrefix);

    if (!match || !match[1]) return stringed;

    if (match[1].includes("=>") && !/^[['"]/.test(match[1])) return stringed;

    if (!match[1]) return stringed;

    return stringed.replace(match[1], "function");
}

(window.webpackChunkdiscord_app ??= [])
    .push([[Symbol()], {}, (require: any) => {
        if (!require.b) return;

        require.d = (target: object, exports: any) => {
            for (const key in exports) {
                if (!Reflect.has(exports, key)) continue;
                if (Reflect.has(target, key)) continue;

                try {
                    Object.defineProperty(target, key, {
                        get: () => exports[key](),
                        set: v => {exports[key] = () => v;},
                        enumerable: true,
                        configurable: true
                    });
                }
                catch (error) {
                    // eslint-disable-next-line no-console
                    console.error(error);
                }
            }
        };

        const IS_CLASSNAME_MODULE = /^\d+(?:e\d+)?\((.{1,3}),.{1,3},.{1,3}\){("use strict";)?\1.exports={.+}}$/;
        const EXTRACT_CLASS = /^(.+?)_/;

        // const USES_STEMMER = /\((\d+)\)\.newStemmer\("[^"]+"\);/;

        function setter(original: RawModule, id: string | symbol): RawModule {
            if ((original.__BD__?.originalModule || original).__early_patched__) return original;

            const trueOriginal = original.__BD__?.originalModule || original;

            const originalStr = String(original);
            const isClassModule = IS_CLASSNAME_MODULE.test(originalStr);

            let rawModule: RawModule | null = null;
            function getRawModule() {
                if (rawModule) return rawModule;

                try {
                    let stringedModule = `(${toStringFunction(trueOriginal)})`;

                    const ast = acorn.parse(stringedModule, {ecmaVersion: "latest", sourceType: "script"});

                    const kid = id.toString();
                    const nid = typeof id === "symbol" ? NaN : Number(id);

                    const path = isNaN(nid) ? `misc/${kid}.js` : `${Math.floor(nid / 1_000)}/${kid}.js`;

                    if (ast.body[0]?.type !== "ExpressionStatement" || ast.body[0].expression.type !== "FunctionExpression") {
                        return rawModule = original;
                    }

                    const func = ast.body[0].expression;

                    const vars: acorn.Identifier[] = [];

                    function stripVars(declaration: acorn.Pattern) {
                        switch (declaration.type) {
                            case "Identifier":
                                vars.push(declaration);
                                break;
                            case "ArrayPattern":
                                for (const ele of declaration.elements) {
                                    if (ele) stripVars(ele);
                                }
                                break;
                            case "AssignmentPattern":
                                stripVars(declaration.left);
                                break;
                            case "ObjectPattern":
                                for (const prop of declaration.properties) {
                                    if (prop.type === "RestElement") {
                                        stripVars(prop.argument);
                                    }
                                    else {
                                        stripVars(prop.value);
                                    }
                                }
                                break;
                            case "MemberExpression":
                                // idk
                                // vars.push(declaration.object as acorn.Identifier);
                                break;
                            case "RestElement":
                                stripVars(declaration.argument);
                                break;

                            default:
                                break;
                        }
                    }

                    for (let index = 0; index < func.body.body.length; index++) {
                        const element = func.body.body[index];

                        if (element.type === "FunctionDeclaration") {
                            stripVars(element.id);
                        }
                        else if (element.type === "VariableDeclaration") {
                            for (const declaration of element.declarations) {
                                stripVars(declaration.id);
                            }
                        }
                    }

                    stringedModule = `(()=>
function(){
/*
    Module Id: ${typeof id === "symbol" ? `Symbol(${id.description})` : id}
    Exposed ${vars.length} variables
    Is Probably Class Module: ${isClassModule}
*/
(${stringedModule.slice(0, func.end - 1)};
{
    arguments[0].declarations={${vars.map((node) => `\n\t\tget ${node.name}(){return ${node.name}},set ${node.name}(_${node.name}){${node.name}=_${node.name}}`).join(",")}${vars.length ? "\n\t" : ""}};
}
${stringedModule.slice(func.end - 1)}).apply(this, arguments)
})()
//# sourceURL=betterdiscord://BD/webpack-modules/patched/${path}`;

                    // eslint-disable-next-line no-eval
                    rawModule = (0, eval)(stringedModule);
                }
                catch (err) {
                    rawModule = original;

                    Logger.error("WebpackModules", `Failed to parse module ${id.toString()} for patching, using original module instead.`, err instanceof Error ? err : new Error(String(err)));
                }

                return rawModule!;
            }
            // const usesStemmerMatch = originalStr.match(USES_STEMMER);

            function newModule(this: any, module: any, exports: any, _require: any) {
                try {
                    getRawModule().call(this, module, exports, _require);

                    if (isClassModule) {
                        const definers: PropertyDescriptorMap = {
                            [Symbol.for("BetterDiscord.Polyfilled.class")]: {
                                value: true
                            }
                        };

                        for (const key in module.exports) {
                            if (!Object.hasOwn(module.exports, key)) continue;

                            const element = module.exports[key];

                            if (typeof element !== "string") return;

                            const match = element.match(EXTRACT_CLASS);

                            if (!match) continue;
                            if (match[1] in module.exports) continue;

                            definers[match[1]] = {value: element, enumerable: true};
                            definers[key] = {value: element, enumerable: false};
                        }

                        Object.defineProperties(module.exports, definers);
                    }
                }
                finally {
                    if (original.__BD__) {
                        original.__BD__.runListeners.call(this, module, exports, _require);
                    }
                }
            }

            newModule.toString = () => originalStr;
            newModule.__early_patched__ = true;
            newModule.__raw_module__ = getRawModule;

            return newModule;
        }

        const sym = Symbol.for("BetterDiscord.ModulesTest");

        const fakeModule = require.m[sym] = () => {};
        const isModulesProxied = fakeModule !== require.m[sym];

        if (isModulesProxied) {
            const definers: PropertyDescriptorMap = {};

            for (const key in require.m) {
                if (!Object.hasOwn(require.m, key)) continue;
                if (Object.hasOwn(require.c, key)) continue;

                definers[key] = {
                    value: setter(require.m[key], key),
                    configurable: true,
                    writable: true,
                    enumerable: true
                };
            }

            Object.defineProperties(require.m, definers);
        }
        else {
            for (const key in require.m) {
                if (!Object.hasOwn(require.m, key)) continue;
                if (Object.hasOwn(require.c, key)) continue;

                require.m[key] = setter(require.m[key], key);
            }
        }

        require.m = new Proxy(require.m, {
            set(target, p, newValue, receiver) {
                return Reflect.set(target, p, setter(newValue, p), receiver);
            },
        });
    }]);
