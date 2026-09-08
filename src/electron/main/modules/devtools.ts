import type {WebContents} from "electron";

import {parseWebpackSourceLink} from "@common/webpackSource";

/** Wait for this window's DevTools, releasing every listener on completion or failure. */
export function waitForDevTools(sender: WebContents, timeoutMs = 5000): Promise<WebContents> {
    if (sender.isDestroyed()) return Promise.reject(new Error("The inspected window has closed"));

    const current = sender.devToolsWebContents;
    if (sender.isDevToolsOpened() && current && !current.isDestroyed()) return Promise.resolve(current);

    return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
            clearTimeout(timeout);
            sender.removeListener("devtools-opened", opened);
            sender.removeListener("devtools-closed", closed);
            sender.removeListener("destroyed", closed);
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const closed = () => fail(new Error("DevTools or the inspected window closed before becoming ready"));
        const opened = () => {
            if (settled) return;
            if (sender.isDestroyed()) return closed();
            const contents = sender.devToolsWebContents;
            if (!contents || contents.isDestroyed()) return;
            settled = true;
            cleanup();
            resolve(contents);
        };

        const timeout = setTimeout(() => fail(new Error("Timed out waiting for DevTools")), timeoutMs);
        sender.on("devtools-opened", opened);
        sender.on("devtools-closed", closed);
        sender.on("destroyed", closed);
        try {
            if (!sender.isDevToolsOpened()) sender.openDevTools();
            if (sender.isDevToolsOpened()) opened();
        }
        catch (error) {fail(error instanceof Error ? error : new Error(String(error)));}
    });
}

async function runDevToolsCommand(sender: WebContents, method: "revealSourceLine" | "enterInspectElementMode", args: unknown[]) {
    const contents = await waitForDevTools(sender);
    if (sender.isDestroyed() || contents.isDestroyed() || sender.devToolsWebContents !== contents) {
        throw new Error("DevTools closed before the operation could run");
    }

    // Only these two internal operations are accepted; arguments are data, never JavaScript source.
    const completed = await contents.executeJavaScript(`(() => {
        if (typeof DevToolsAPI === "undefined" || typeof DevToolsAPI[${JSON.stringify(method)}] !== "function") return false;
        DevToolsAPI[${JSON.stringify(method)}](...${JSON.stringify(args)});
        return true;
    })();`);
    if (completed !== true) throw new Error(`DevTools does not support ${method} in this client`);
}

export function inspectElement(sender: WebContents) {
    return runDevToolsCommand(sender, "enterInspectElementMode", []);
}

export function openDevtoolsSource(sender: WebContents, url: unknown, line: unknown, column: unknown) {
    const source = parseWebpackSourceLink(url);
    if (!source) return Promise.reject(new TypeError("Invalid Webpack source URL"));
    if (typeof line !== "number" || !Number.isSafeInteger(line) || line < 0
        || typeof column !== "number" || !Number.isSafeInteger(column) || column < 0) {
        return Promise.reject(new TypeError("Source positions must be nonnegative safe integers"));
    }

    return runDevToolsCommand(sender, "revealSourceLine", [source.url, line, column]);
}
