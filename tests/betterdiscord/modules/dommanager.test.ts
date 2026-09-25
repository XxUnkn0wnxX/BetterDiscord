import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import type {Window as HappyDOMWindow} from "happy-dom";
import {DOM, BoundDOM} from "@api/dom";
import DOMManager from "@modules/dommanager";


describe("DOMManager", () => {
    describe("escapeID", () => {
        test("should return a valid id", () => {
            expect(DOMManager.escapeID("123abc")).toBe(CSS.escape("123abc"));
            expect(DOMManager.escapeID("test@#$%")).toBe(CSS.escape("test@#$%"));
            expect(DOMManager.escapeID("valid-id")).toBe("valid-id");
            expect(DOMManager.escapeID("mixed_special@chars")).toBe(CSS.escape("mixed_special@chars"));
            expect(DOMManager.escapeID("multiCASE_madness")).toBe("multiCASE_madness");
        });
    });

    describe("createElement", () => {
        test("should create element with given type", () => {
            const div = DOMManager.createElement("div");
            expect(div).toBeInstanceOf(HTMLDivElement);
        });

        test("should set element properties from options", () => {
            const div = DOMManager.createElement("div", {id: "test-id"});
            expect(div.id).toBe("test-id");
        });

        test("should append children", () => {
            const span1 = document.createElement("span");
            const span2 = document.createElement("span");
            const div = DOMManager.createElement("div", {}, span1, span2);
            expect(div.children.length).toBe(2);
            expect(div.children[0]).toBe(span1);
            expect(div.children[1]).toBe(span2);
        });

        test("should handle nested arrays of children", () => {
            const span1 = document.createElement("span");
            const span2 = document.createElement("span");
            const div = DOMManager.createElement("div", {}, [span1, [span2]]);
            expect(div.children.length).toBe(2);
            expect(div.children[0]).toBe(span1);
            expect(div.children[1]).toBe(span2);
        });

        test("should handle text nodes", () => {
            const div = DOMManager.createElement("div", {}, "text content");
            expect(div.textContent).toBe("text content");
        });
    });

    describe("parseHTML", () => {
        test("should parse single element", () => {
            const result = DOMManager.parseHTML("<div>test</div>");
            expect(result).toBeInstanceOf(HTMLDivElement);
            expect((result as HTMLDivElement).textContent).toBe("test");
        });

        test("should return NodeList for multiple elements when fragment=false", () => {
            const result = DOMManager.parseHTML("<span>1</span><span>2</span>");
            expect(result).toBeInstanceOf(NodeList);
            expect((result as NodeList).length).toBe(2);
        });

        test("should return DocumentFragment when fragment=true", () => {
            const result = DOMManager.parseHTML("<div>test</div>", true);
            expect(result).toBeInstanceOf(DocumentFragment);
        });

        test("should handle complex HTML", () => {
            const html = `
                <div class="container">
                    <h1>Title</h1>
                    <p>Paragraph</p>
                </div>`;
            const result = DOMManager.parseHTML(html) as HTMLDivElement;
            expect(result).toBeInstanceOf(HTMLDivElement);
            expect(result.querySelector("h1")?.textContent).toBe("Title");
            expect(result.querySelector("p")?.textContent).toBe("Paragraph");
        });
    });

    describe("getElement", () => {
        let container: HTMLElement;

        beforeEach(() => {
            container = document.createElement("div");
            container.innerHTML = `
                <div id="test">
                    <span class="item">Item 1</span>
                    <span class="item">Item 2</span>
                </div>
            `;
        });

        test("should return element when given a selector string", () => {
            const element = DOMManager.getElement("#test", container);
            expect(element?.id).toBe("test");
        });

        test("should return node when given a node", () => {
            const node = container.querySelector("#test")!;
            const result = DOMManager.getElement(node!, container);
            expect(result).toBe(node);
        });

        test("should use baseElement for scoped queries", () => {
            const items = container.querySelectorAll(".item");
            expect(items.length).toBe(2);

            const empty = document.createElement("div");
            const noItems = DOMManager.getElement(".item", empty);
            expect(noItems).toBeNull();
        });
    });

    describe("Style Management", () => {
        const testId = "test-style";
        const testCSS = "body { background: red; }";

        afterEach(() => {
            // Clean up any added styles
            const style = document.querySelector(`#${testId}`);
            style?.remove();
        });

        test("should inject and remove style", () => {
            DOMManager.injectStyle(testId, testCSS);
            const style = DOMManager.getElement(`#${testId}`, DOMManager.bdStyles);
            expect(style).not.toBeNull();
            expect((style as HTMLStyleElement).textContent).toBe(testCSS);

            DOMManager.removeStyle(testId);
            const removed = DOMManager.getElement(`#${testId}`, DOMManager.bdStyles);
            expect(removed).toBeNull();
        });

        test("should update existing style", () => {
            DOMManager.injectStyle(testId, testCSS);
            const newCSS = "body { background: blue; }";
            DOMManager.injectStyle(testId, newCSS);

            const style = DOMManager.getElement(`#${testId}`, DOMManager.bdStyles) as HTMLStyleElement;
            expect(style.textContent).toBe(newCSS);
        });
    });

    describe("Theme Management", () => {
        const testId = "test-theme";
        const testCSS = ".theme { color: blue; }";

        afterEach(() => {
            // Clean up any added themes
            const theme = document.querySelector(`#${testId}`);
            theme?.remove();
        });

        test("should inject and remove theme", () => {
            DOMManager.injectTheme(testId, testCSS);
            const theme = DOMManager.getElement(`#${testId}`, DOMManager.bdThemes);
            expect(theme).not.toBeNull();
            expect((theme as HTMLStyleElement).textContent).toBe(testCSS);

            DOMManager.removeTheme(testId);
            const removed = DOMManager.getElement(`#${testId}`, DOMManager.bdThemes);
            expect(removed).toBeNull();
        });

        test("should update existing theme", () => {
            DOMManager.injectTheme(testId, testCSS);
            const newCSS = ".theme { color: red; }";
            DOMManager.injectTheme(testId, newCSS);

            const theme = DOMManager.getElement(`#${testId}`, DOMManager.bdThemes) as HTMLStyleElement;
            expect(theme.textContent).toBe(newCSS);
        });
    });

    describe("literal ID lookup and ownership", () => {
        const ids = ["plain-id", "plugin.name", "plugin:name", "123plugin", "plugin name", "test@#$%", "back\\slash"];
        const browserSettings = (window as unknown as HappyDOMWindow).happyDOM.settings;
        let originalSettings: typeof browserSettings;
        const foreignNodes: Element[] = [];

        beforeEach(() => {
            originalSettings = {...browserSettings};
            browserSettings.disableCSSFileLoading = true;
            browserSettings.disableJavaScriptFileLoading = true;
            browserSettings.handleDisabledFileLoadingAsSuccess = true;
        });

        afterEach(() => {
            for (const id of [...ids, "owned-link", "collision-id"]) {
                DOMManager.removeStyle(id);
                DOMManager.removeScript(id);
            }
            for (const node of foreignNodes.splice(0)) node.remove();
            Object.assign(browserSettings, originalSettings);
        });

        function foreignElement(tag: string, id: string, parent: Element = document.body) {
            const node = document.createElement(tag);
            node.id = CSS.escape(id);
            node.textContent = "unrelated content";
            parent.append(node);
            foreignNodes.push(node);
            return node;
        }

        for (const id of ids) {
            test(`public style APIs update and remove the same node for ${JSON.stringify(id)}`, () => {
                const api = new DOM();
                const bound = new BoundDOM(id);
                api.addStyle(id, "body { color: red; }");
                const first = DOMManager.bdStyles.lastElementChild!;
                bound.addStyle("body { color: blue; }");
                expect(DOMManager.bdStyles.lastElementChild === first).toBe(true);
                expect(first.textContent).toBe("body { color: blue; }");
                expect(Array.from(DOMManager.bdStyles.children).filter(node => node.id === first.id)).toHaveLength(1);
                bound.removeStyle();
                expect(first.isConnected).toBe(false);
                api.removeStyle(id);
            });

            test(`scripts reuse and remove their node for ${JSON.stringify(id)}`, async () => {
                await DOMManager.injectScript(id, "data:text/javascript,void 0");
                const first = DOMManager.bdScripts.lastElementChild!;
                await DOMManager.injectScript(id, "data:text/javascript,void 1");
                expect(DOMManager.bdScripts.lastElementChild === first).toBe(true);
                expect(Array.from(DOMManager.bdScripts.children).filter(node => node.id === first.id)).toHaveLength(1);
                DOMManager.removeScript(id);
                expect(first.isConnected).toBe(false);
            });
        }

        test("style and script operations leave colliding host and theme IDs alone", async () => {
            const id = "collision-id";
            const host = foreignElement("div", id);
            document.body.prepend(host);
            const theme = foreignElement("style", id, DOMManager.bdThemes);
            const hostParent = host.parentNode;
            const themeParent = theme.parentNode;
            DOMManager.removeStyle(id);
            DOMManager.removeScript(id);
            DOMManager.injectStyle(id, "body { color: red; }");
            await DOMManager.injectScript(id, "data:text/javascript,void 0");
            DOMManager.removeStyle(id);
            DOMManager.removeScript(id);
            for (const node of [host, theme]) {
                expect(node.isConnected).toBe(true);
                expect(node.textContent).toBe("unrelated content");
            }
            expect(host.parentNode === hostParent).toBe(true);
            expect(theme.parentNode === themeParent).toBe(true);
        });

        test("linked styles retain identity when updated and moved between managed containers", async () => {
            const id = "plugin.name";
            await DOMManager.linkStyle(id, "data:text/css,body{}", {documentHead: true});
            const first = document.head.lastElementChild!;
            await DOMManager.linkStyle(id, "data:text/css,html{}", {documentHead: true});
            expect(document.head.lastElementChild === first).toBe(true);
            await DOMManager.linkStyle(id, "data:text/css,div{}");
            expect(first.parentNode === DOMManager.bdStyles).toBe(true);
            await DOMManager.linkStyle(id, "data:text/css,span{}", {documentHead: true});
            expect(first.parentNode === document.head).toBe(true);
            DOMManager.unlinkStyle(id);
            expect(first.isConnected).toBe(false);
        });

        test("head links do not reuse or remove an unrelated colliding link", async () => {
            const foreign = foreignElement("link", "owned-link", document.head);
            await DOMManager.linkStyle("owned-link", "data:text/css,body{}", {documentHead: true});
            const owned = document.head.lastElementChild!;
            expect(owned === foreign).toBe(false);
            DOMManager.unlinkStyle("owned-link");
            expect(owned.isConnected).toBe(false);
            expect(foreign.parentNode === document.head).toBe(true);
            expect(foreign.hasAttribute("href")).toBe(false);
        });

        test("a detached head link is not reused after an unrelated replacement appears", async () => {
            await DOMManager.linkStyle("owned-link", "data:text/css,body{}", {documentHead: true});
            const previous = document.head.lastElementChild!;
            previous.remove();
            const foreign = foreignElement("link", "owned-link", document.head);
            await DOMManager.linkStyle("owned-link", "data:text/css,html{}", {documentHead: true});
            const replacement = document.head.lastElementChild!;
            expect(replacement === previous).toBe(false);
            expect(replacement === foreign).toBe(false);
            expect(previous.isConnected).toBe(false);
            DOMManager.unlinkStyle("owned-link");
            expect(replacement.isConnected).toBe(false);
            expect(foreign.parentNode === document.head).toBe(true);
        });

        test("a renamed head link is no longer owned under its old ID", async () => {
            await DOMManager.linkStyle("owned-link", "data:text/css,body{}", {documentHead: true});
            const previous = document.head.lastElementChild!;
            previous.id = "renamed-link";
            foreignNodes.push(previous);
            DOMManager.unlinkStyle("owned-link");
            expect(previous.parentNode === document.head).toBe(true);
            await DOMManager.linkStyle("owned-link", "data:text/css,html{}", {documentHead: true});
            expect(document.head.lastElementChild === previous).toBe(false);
        });
    });
});
