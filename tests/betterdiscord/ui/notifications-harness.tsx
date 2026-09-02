import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act, type ReactNode} from "react";
import {createRoot as createRealRoot, type Root} from "react-dom/client";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

type SpringOptions = Record<string, any>;
type SpringCall = {
    options: SpringOptions;
    trigger(width: string): void;
};

const springCalls: SpringCall[] = [];
const roots: Root[] = [];
let rootCreateCount = 0;

const wrappedCreateRoot = (container: Element | DocumentFragment) => {
    rootCreateCount++;
    const root = createRealRoot(container);
    roots.push(root);
    return root;
};

const useSpring = (options: SpringOptions) => {
    const call: SpringCall = {
        options,
        trigger: (width: string) => {
            options.onChange?.({width, value: {width}});
        }
    };
    springCalls.push(call);

    return {
        width: options.from?.width ?? options.width ?? "100%"
    };
};

const AnimatedDiv = ({children, ...props}: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>;

mock.module("@modules/reactdom", () => ({
    "default": {
        createRoot: wrappedCreateRoot
    }
}));

mock.module("@modules/dommanager", () => ({
    "default": {
        get bdBody() {
            return document.body;
        }
    }
}));

mock.module("@modules/discordmodules", () => ({
    "default": {
        ReactSpring: {
            animated: {div: AnimatedDiv},
            useSpring
        }
    }
}));

mock.module("@stores/settings", () => ({
    "default": {
        addChangeListener: () => () => {},
        removeChangeListener: () => {},
        get: () => "bottom-right"
    }
}));

type StoreLike = {
    addChangeListener(listener: () => void): (() => void) | void;
    removeChangeListener?(listener: () => void): void;
};

mock.module("@ui/hooks", () => ({
    useStateFromStores: <T,>(store: StoreLike, factory: () => T): T => {
        const [state, setState] = React.useState<T>(factory);

        React.useEffect(() => {
            const listener = () => setState(factory());
            const unsubscribe = store.addChangeListener(listener);

            return typeof unsubscribe === "function"
                ? unsubscribe
                : () => store.removeChangeListener?.(listener);
        }, [store]);

        return state;
    }
}));

type MockButtonProps = {
    className?: string;
    children?: ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

const MockButton = ({className, children, onClick}: MockButtonProps) => (
    <button type="button" className={className} onClick={onClick}>{children}</button>
);

const buttonColors = {PRIMARY: "bd-button-color-primary"};
const buttonLooks = {FILLED: "bd-button-filled"};

mock.module("@ui/base/button", () => ({
    "default": Object.assign(MockButton, {Colors: buttonColors, Looks: buttonLooks}),
    "ButtonColors": buttonColors,
    "ButtonLooks": buttonLooks
}));

mock.module("@ui/base/text", () => ({
    "default": ({className, children, onClick}: {className?: string; children?: ReactNode; onClick?: React.MouseEventHandler<HTMLDivElement>}) => (
        <div className={className} onClick={onClick}>{children}</div>
    )
}));

mock.module("@ui/errorboundary", () => ({
    "default": ({children}: {children?: ReactNode}) => <>{children}</>
}));

mock.module("@structs/markdown", () => ({
    "default": {
        parseToReact: (content: string) => <span data-markdown>{content}</span>
    }
}));

const MockIcon = ({color, size}: {color?: string; size?: string}) => (
    <span data-icon style={{color, width: size, height: size}} />
);

mock.module("lucide-react", () => ({
    CircleAlertIcon: MockIcon,
    CircleCheckIcon: MockIcon,
    InfoIcon: MockIcon,
    TriangleAlertIcon: MockIcon
}));

const {default: Notifications} = await import("@stores/notifications");
const {initNotificationUI} = await import("@ui/notifications");

type NotificationHandle = {
    id?: string;
    isVisible(): boolean;
    close(): void;
};

type NotificationInput = Record<string, any>;

async function show(notification: NotificationInput): Promise<NotificationHandle> {
    let handle: NotificationHandle | undefined;
    await act(async () => {
        handle = Notifications.show(notification);
    });
    if (!handle) throw new Error("Notifications.show() did not return a handle");
    return handle;
}

async function hide(notification: string | NotificationInput): Promise<void> {
    await act(async () => {
        Notifications.hide(notification);
    });
}

async function flush(): Promise<void> {
    await act(async () => {});
}

function cardWithTitle(title: string): HTMLDivElement {
    const card = [...document.querySelectorAll<HTMLDivElement>(".bd-notification")]
        .find(element => element.querySelector(".bd-notification-title")?.textContent === title);
    if (!card) throw new Error(`Notification card ${title} was not rendered`);
    return card;
}

let customTokenSequence = 0;
const customNotificationProps = new Map<string, NotificationInput>();

const CustomCard = ({notification}: {notification: NotificationInput}) => {
    const token = React.useRef(`custom-${++customTokenSequence}`).current;
    customNotificationProps.set(token, notification);

    return <div className="custom-card" data-token={token} data-title={notification.title} />;
};

afterEach(async () => {
    await act(async () => {
        for (const root of roots) root.unmount();
    });
    document.body.replaceChildren();
    roots.length = 0;
    springCalls.length = 0;
    customNotificationProps.clear();
});

describe("notification store and UI", () => {
    test("keeps notification entries isolated and initializes the UI lazily", async () => {
        const weakMapDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "getOrInsertComputed");
        let changeCount = 0;
        const removeChangeListener = Notifications.addChangeListener(() => changeCount++);

        expect(document.getElementById("bd-notifications-container")).toBeNull();
        expect(rootCreateCount).toBe(0);
        expect(Object.getOwnPropertyDescriptor(WeakMap.prototype, "getOrInsertComputed")).toEqual(weakMapDescriptor);

        const anonymousBeforeInit = await show({title: "before init"});
        expect(anonymousBeforeInit.id).toBeUndefined();
        expect(anonymousBeforeInit.isVisible()).toBe(true);
        expect(document.getElementById("bd-notifications-container")).toBeNull();
        anonymousBeforeInit.close();
        expect(anonymousBeforeInit.isVisible()).toBe(false);

        const firstDuplicate = await show({id: "duplicate", title: "first payload"});
        const secondDuplicate = await show({id: "duplicate", title: "second payload"});
        const duplicateEntries = Notifications.notifications.filter((notification: NotificationInput) => notification.id === "duplicate");
        expect(duplicateEntries).toHaveLength(1);
        expect(duplicateEntries[0].title).toBe("first payload");
        expect(firstDuplicate.id).toBe("duplicate");
        expect(secondDuplicate.id).toBe("duplicate");
        expect(firstDuplicate.isVisible()).toBe(true);
        expect(secondDuplicate.isVisible()).toBe(true);

        const duplicateCloseCount = changeCount;
        firstDuplicate.close();
        expect(changeCount).toBe(duplicateCloseCount + 1);
        expect(firstDuplicate.isVisible()).toBe(false);
        expect(secondDuplicate.isVisible()).toBe(false);
        secondDuplicate.close();
        expect(changeCount).toBe(duplicateCloseCount + 1);

        const sameCaller = {title: "same caller"};
        const firstAnonymous = await show(sameCaller);
        const secondAnonymous = await show(sameCaller);
        expect(Notifications.notifications.filter((notification: NotificationInput) => notification.title === "same caller")).toHaveLength(2);
        expect(firstAnonymous.id).toBeUndefined();
        expect(secondAnonymous.id).toBeUndefined();
        expect(firstAnonymous.isVisible()).toBe(true);
        expect(secondAnonymous.isVisible()).toBe(true);

        const anonymousCloseCount = changeCount;
        firstAnonymous.close();
        expect(changeCount).toBe(anonymousCloseCount + 1);
        expect(firstAnonymous.isVisible()).toBe(false);
        expect(secondAnonymous.isVisible()).toBe(true);
        firstAnonymous.close();
        expect(changeCount).toBe(anonymousCloseCount + 1);
        secondAnonymous.close();
        expect(changeCount).toBe(anonymousCloseCount + 2);

        const hideStringTarget = await show({id: "hide-string", title: "hide string"});
        const hideStringOther = await show({id: "hide-string-other", title: "keep string"});
        const hideStringCount = changeCount;
        await hide("hide-string");
        expect(changeCount).toBe(hideStringCount + 1);
        expect(hideStringTarget.isVisible()).toBe(false);
        expect(hideStringOther.isVisible()).toBe(true);
        await hide("hide-string");
        expect(changeCount).toBe(hideStringCount + 1);

        const hideObjectTarget = await show({title: "hide object"});
        const hideObjectOtherNotification = {title: "keep object"};
        const hideObjectOther = await show(hideObjectOtherNotification);
        const storedObjectTarget = Notifications.notifications.find((notification: NotificationInput) => notification.title === "hide object");
        expect(storedObjectTarget).toBeTruthy();
        const hideObjectCount = changeCount;
        await hide(storedObjectTarget!);
        expect(changeCount).toBe(hideObjectCount + 1);
        expect(hideObjectTarget.isVisible()).toBe(false);
        expect(hideObjectOther.isVisible()).toBe(true);
        await hide(storedObjectTarget!);
        expect(changeCount).toBe(hideObjectCount + 1);
        await hide("hide-string-other");
        await hide(hideObjectOtherNotification);

        let preInitCloseCount = 0;
        const preInit = await show({
            id: "pre-init",
            title: "pre-init",
            content: "pre-init content",
            actions: [{label: "pre-init action", dontClose: true}],
            onClose: () => preInitCloseCount++
        });
        expect(document.getElementById("bd-notifications-container")).toBeNull();

        await act(async () => {
            initNotificationUI();
        });
        await flush();

        const container = document.getElementById("bd-notifications-container");
        expect(container).not.toBeNull();
        expect(rootCreateCount).toBe(1);
        expect(container?.querySelector("#bd-notifications-root")).not.toBeNull();
        const preInitCard = cardWithTitle("pre-init");
        expect(preInitCard.querySelector(".bd-notification-content")).not.toBeNull();
        expect(preInitCard.querySelector(".bd-notification-footer")).not.toBeNull();
        expect(preInitCard.querySelector(".bd-notification-action")).not.toBeNull();
        expect(preInitCard.querySelector(".bd-notification-close")).not.toBeNull();
        expect(preInitCard.querySelector(".bd-notification-progress")).not.toBeNull();
        expect(springCalls.at(-1)?.options.pause).toBe(false);

        const containerBeforeSecondInit = container;
        await act(async () => {
            initNotificationUI();
        });
        await flush();
        expect(document.getElementById("bd-notifications-container")).toBe(containerBeforeSecondInit);
        expect(document.querySelectorAll("#bd-notifications-container")).toHaveLength(1);
        expect(rootCreateCount).toBe(1);

        await act(async () => {
            preInitCard.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        });
        expect(springCalls.at(-1)?.options.pause).toBe(true);
        await act(async () => {
            preInitCard.dispatchEvent(new MouseEvent("mouseout", {bubbles: true}));
        });
        expect(springCalls.at(-1)?.options.pause).toBe(false);

        const springCloseCount = changeCount;
        await act(async () => springCalls.at(-1)!.trigger("0%"));
        expect(changeCount).toBe(springCloseCount + 1);
        expect(preInit.isVisible()).toBe(false);
        expect(preInitCloseCount).toBe(1);

        const sameAnonymousNotification = {title: "same anonymous rendered"};
        const firstAnonymousRendered = await show(sameAnonymousNotification);
        const secondAnonymousRendered = await show(sameAnonymousNotification);
        await flush();
        const anonymousCards = [...document.querySelectorAll<HTMLDivElement>(".bd-notification")]
            .filter(card => card.querySelector(".bd-notification-title")?.textContent === "same anonymous rendered");
        expect(anonymousCards).toHaveLength(2);
        const [firstAnonymousCard, secondAnonymousCard] = anonymousCards;
        expect(firstAnonymousRendered.isVisible()).toBe(true);
        expect(secondAnonymousRendered.isVisible()).toBe(true);

        await act(async () => {
            secondAnonymousCard.querySelector<HTMLElement>(".bd-notification-close")!.click();
        });
        await flush();
        const remainingAnonymousCards = [...document.querySelectorAll<HTMLDivElement>(".bd-notification")]
            .filter(card => card.querySelector(".bd-notification-title")?.textContent === "same anonymous rendered");
        expect(remainingAnonymousCards).toHaveLength(1);
        expect(remainingAnonymousCards[0]).toBe(firstAnonymousCard);
        expect(secondAnonymousCard.isConnected).toBe(false);
        expect(firstAnonymousRendered.isVisible()).toBe(true);
        expect(secondAnonymousRendered.isVisible()).toBe(false);

        await act(async () => firstAnonymousRendered.close());
        await flush();
        expect(firstAnonymousRendered.isVisible()).toBe(false);

        let closeButtonCount = 0;
        const closeButton = await show({id: "close-button", title: "close button", onClose: () => closeButtonCount++});
        await flush();
        await act(async () => {
            cardWithTitle("close button").querySelector<HTMLElement>(".bd-notification-close")!.click();
        });
        expect(closeButton.isVisible()).toBe(false);
        expect(closeButtonCount).toBe(1);

        let dontCloseActionCount = 0;
        const dontClose = await show({
            id: "dont-close",
            title: "dont close",
            actions: [{label: "keep", dontClose: true, onClick: () => dontCloseActionCount++}]
        });
        await flush();
        await act(async () => {
            cardWithTitle("dont close").querySelector<HTMLButtonElement>(".bd-notification-action")!.click();
        });
        expect(dontCloseActionCount).toBe(1);
        expect(dontClose.isVisible()).toBe(true);
        await hide("dont-close");

        let shiftActionCount = 0;
        let shiftCloseCount = 0;
        const shiftAction = await show({
            id: "shift-action",
            title: "shift action",
            actions: [{
                label: "shift-aware",
                dontCloseOnActionIfHoldingShiftKey: true,
                onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                    if (event.shiftKey) shiftActionCount++;
                }
            }],
            onClose: () => shiftCloseCount++
        });
        await flush();
        const shiftButton = cardWithTitle("shift action").querySelector<HTMLButtonElement>(".bd-notification-action")!;
        await act(async () => {
            shiftButton.dispatchEvent(new MouseEvent("click", {bubbles: true, shiftKey: true}));
        });
        expect(shiftActionCount).toBe(1);
        expect(shiftAction.isVisible()).toBe(true);
        expect(shiftCloseCount).toBe(0);
        await act(async () => {
            shiftButton.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        });
        expect(shiftAction.isVisible()).toBe(false);
        expect(shiftCloseCount).toBe(1);

        springCalls.length = 0;
        customTokenSequence = 0;
        customNotificationProps.clear();
        const customFirst = await show({render: CustomCard, title: "custom first"});
        const customSecond = await show({render: CustomCard, title: "custom second"});
        await flush();

        const customCards = [...document.querySelectorAll<HTMLDivElement>(".custom-card")];
        expect(customCards).toHaveLength(2);
        const firstToken = customCards[0].dataset.token!;
        const secondToken = customCards[1].dataset.token!;
        expect(customCards[0].closest(".bd-notification")).not.toBeNull();
        expect(customCards[0].closest(".bd-notification")?.querySelector(".bd-notification-content")).toBeNull();
        expect(customCards[0].closest(".bd-notification")?.querySelector(".bd-notification-footer")).toBeNull();
        expect(customCards[0].closest(".bd-notification")?.querySelector(".bd-notification-close")).toBeNull();
        expect(customCards[0].closest(".bd-notification")?.querySelector(".bd-notification-progress")).toBeNull();
        expect(customNotificationProps.get(firstToken)).toBe(Notifications.notifications.find((notification: NotificationInput) => notification.title === "custom first"));
        expect(customNotificationProps.get(secondToken)).toBe(Notifications.notifications.find((notification: NotificationInput) => notification.title === "custom second"));
        expect(springCalls.length).toBeGreaterThanOrEqual(2);
        expect(springCalls.slice(-2).every(call => call.options.pause === true)).toBe(true);

        await act(async () => customFirst.close());
        await flush();
        const remainingCustomCards = [...document.querySelectorAll<HTMLDivElement>(".custom-card")];
        expect(remainingCustomCards).toHaveLength(1);
        expect(remainingCustomCards[0].dataset.token).toBe(secondToken);
        expect(customFirst.isVisible()).toBe(false);
        expect(customSecond.isVisible()).toBe(true);
        expect(Object.getOwnPropertyDescriptor(WeakMap.prototype, "getOrInsertComputed")).toEqual(weakMapDescriptor);

        removeChangeListener?.();
    });
});
