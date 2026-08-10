type AccentColorChangeListener = (event: unknown, accentColor: string) => void;

type AccentColorUnsubscribe = () => void;

type AccentColorSubscriptionSystemPreferences = {
    on(event: "accent-color-changed", listener: AccentColorChangeListener): void;
    removeListener(event: "accent-color-changed", listener: AccentColorChangeListener): void;
    subscribeLocalNotification?: (name: string, listener: () => void) => number;
    unsubscribeLocalNotification?: (id: number) => void;
    subscribeNotification?: (name: string, listener: () => void) => number;
    unsubscribeNotification?: (id: number) => void;
};

type StyleWebContents = {
    isDestroyed(): boolean;
    insertCSS(css: string): Promise<string>;
    removeInsertedCSS(key: string): Promise<void>;
    on(event: "dom-ready" | "destroyed", listener: () => void): void;
    removeListener(event: "dom-ready" | "destroyed", listener: () => void): void;
};

const DEFAULT_ACCENT_COLOR = "#3E82E5";
const MAX_STALE_STYLES = 16;

type AccentColorController = {
    dispose(): void;
    waitForIdle(): Promise<void>;
};

type AccentColorControllerOptions = {
    webContents: StyleWebContents;
    subscribeAccentColorChanges: (listener: AccentColorChangeListener) => AccentColorUnsubscribe;
    getEnvironmentAccentColor: () => string;
    getSystemAccentColor: () => string;
};

export function normalizeAccentColor(accentColor: string) {
    accentColor = accentColor.trim();
    if (!accentColor) return "";
    return accentColor.startsWith("#") ? accentColor : `#${accentColor}`;
}

export function resolveAccentColor({
    getEnvironmentAccentColor,
    getSystemAccentColor,
    eventAccentColor,
}: {
    getEnvironmentAccentColor: () => string;
    getSystemAccentColor: () => string;
    eventAccentColor?: string;
}): string {
    const overrideColor = normalizeAccentColor(getEnvironmentAccentColor());
    if (overrideColor) return overrideColor;

    try {
        const accentColor = normalizeAccentColor(eventAccentColor ?? getSystemAccentColor());
        return accentColor || DEFAULT_ACCENT_COLOR;
    }
    catch {
        return DEFAULT_ACCENT_COLOR;
    }
}

const ACCENT_STYLE_VALUE = (accentColor: string) => `:root {--os-accent-color: ${accentColor};}`;

const normalizeStaleStyleKeys = (styleKeys: string[]) => {
    return [...new Set(styleKeys)].slice(-MAX_STALE_STYLES);
};

export const createAccentColorChangeSubscription = (systemPreferences: AccentColorSubscriptionSystemPreferences, platform = process.platform) => {
    const subscribeToAccentColorEvent = (listener: AccentColorChangeListener) => {
        systemPreferences.on("accent-color-changed", listener);
        return () => systemPreferences.removeListener("accent-color-changed", listener);
    };

    const subscribeToNotification = (
        listener: AccentColorChangeListener,
        name: string,
        subscribe: (name: string, listener: () => void) => number,
        unsubscribe: (id: number) => void,
    ) => {
        try {
            const subscriptionId = subscribe(name, () => {
                listener({}, "");
            });

            return () => {
                try {
                    unsubscribe(subscriptionId);
                }
                catch {
                    /* Nothing to clean up after Electron has already torn down. */
                }
            };
        }
        catch {
            return null;
        }
    };

    if (platform === "darwin") {
        return (listener: AccentColorChangeListener) => {
            if (typeof systemPreferences.subscribeLocalNotification === "function" && typeof systemPreferences.unsubscribeLocalNotification === "function") {
                const cleanup = subscribeToNotification(
                    listener,
                    "NSSystemColorsDidChangeNotification",
                    systemPreferences.subscribeLocalNotification.bind(systemPreferences),
                    systemPreferences.unsubscribeLocalNotification.bind(systemPreferences),
                );

                if (cleanup) return cleanup;
            }

            if (typeof systemPreferences.subscribeNotification === "function" && typeof systemPreferences.unsubscribeNotification === "function") {
                const cleanup = subscribeToNotification(
                    listener,
                    "AppleColorPreferencesChangedNotification",
                    systemPreferences.subscribeNotification.bind(systemPreferences),
                    systemPreferences.unsubscribeNotification.bind(systemPreferences),
                );

                if (cleanup) return cleanup;
            }

            return subscribeToAccentColorEvent(listener);
        };
    }

    return subscribeToAccentColorEvent;
};

export function createAccentColorController({
    webContents,
    subscribeAccentColorChanges,
    getEnvironmentAccentColor,
    getSystemAccentColor,
}: AccentColorControllerOptions): AccentColorController {
    let currentStyleKey: string | null = null;
    let staleStyleKeys: string[] = [];
    let domReady = false;
    let processing = false;
    let disposed = false;
    let waitingForColor: string | null = null;
    const waitingList: Array<() => void> = [];

    const updateIdleWaiters = () => {
        if (disposed || webContents.isDestroyed()) {
            waitingForColor = null;
            waitingList.splice(0).forEach(resolve => resolve());
            return;
        }

        if (waitingForColor === null && !processing) {
            waitingList.splice(0).forEach(resolve => resolve());
        }
    };

    const queueAccentColor = (accentColor?: string) => {
        if (disposed || webContents.isDestroyed()) return;

        const normalized = resolveAccentColor({
            getEnvironmentAccentColor,
            getSystemAccentColor,
            eventAccentColor: accentColor,
        });

        waitingForColor = normalized;
        void flushUpdates();
    };

    const onSystemAccentChange: AccentColorChangeListener = (_event, accentColor) => {
        queueAccentColor(accentColor || undefined);
    };

    const unsubscribeAccentColorChanges = subscribeAccentColorChanges(onSystemAccentChange);

    const cleanupOldStyles = async (newStyleKey: string) => {
        const cleanupKeys = staleStyleKeys;
        staleStyleKeys = [];

        for (const styleKey of cleanupKeys) {
            if (disposed || webContents.isDestroyed()) return;

            if (styleKey === newStyleKey) {
                staleStyleKeys.push(styleKey);
                continue;
            }

            try {
                await webContents.removeInsertedCSS(styleKey);
            }
            catch {
                staleStyleKeys.push(styleKey);
            }
        }

        staleStyleKeys = normalizeStaleStyleKeys(staleStyleKeys);
    };

    const applyAccentColor = async (accentColor: string) => {
        if (disposed || webContents.isDestroyed()) return;

        let styleKey: string | null = null;
        const style = ACCENT_STYLE_VALUE(accentColor);

        try {
            styleKey = await webContents.insertCSS(style);
        }
        catch {
            // Keep the prior style when insert fails.
            return;
        }

        if (disposed || webContents.isDestroyed()) return;

        const oldStyleKey = currentStyleKey;
        currentStyleKey = styleKey;
        staleStyleKeys = normalizeStaleStyleKeys(staleStyleKeys.concat(oldStyleKey ? [oldStyleKey] : []));
        await cleanupOldStyles(styleKey);
    };

    async function flushUpdates() {
        if (disposed || !domReady || webContents.isDestroyed() || processing) return;
        processing = true;

        try {
            while (true) {
                if (disposed || !domReady || webContents.isDestroyed() || waitingForColor === null) {
                    break;
                }

                const accentColor = waitingForColor;
                waitingForColor = null;
                await applyAccentColor(accentColor);
            }
        }
        finally {
            processing = false;
            updateIdleWaiters();

            if (!disposed && waitingForColor !== null) {
                void flushUpdates();
            }
        }
    }

    const onWebContentsDestroy = () => {
        if (disposed) return;

        disposed = true;
        waitingForColor = null;
        staleStyleKeys = [];
        updateIdleWaiters();
        webContents.removeListener("dom-ready", onDomReady);
        webContents.removeListener("destroyed", onWebContentsDestroy);
        unsubscribeAccentColorChanges();
    };

    const onDomReady = () => {
        if (disposed || webContents.isDestroyed()) return;

        domReady = true;
        if (waitingForColor === null) queueAccentColor();
        void flushUpdates();
    };

    webContents.on("dom-ready", onDomReady);
    webContents.on("destroyed", onWebContentsDestroy);

    queueAccentColor();

    return {
        dispose() {
            if (disposed) return;

            disposed = true;
            waitingForColor = null;
            staleStyleKeys = [];
            webContents.removeListener("dom-ready", onDomReady);
            webContents.removeListener("destroyed", onWebContentsDestroy);
            unsubscribeAccentColorChanges();
            updateIdleWaiters();
        },

        waitForIdle() {
            if (disposed || webContents.isDestroyed()) {
                return Promise.resolve();
            }

            if (waitingForColor === null && !processing) {
                return Promise.resolve();
            }

            return new Promise(resolve => {
                waitingList.push(resolve);
            });
        },
    };
}

export {DEFAULT_ACCENT_COLOR};
