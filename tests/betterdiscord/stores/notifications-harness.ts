import {describe, expect, test} from "bun:test";

type NotificationInput = {
    id?: string;
    title?: string;
};

type NotificationHandle = {
    id?: string;
    isVisible(): boolean;
    close(): void;
};

type NotificationsStore = {
    notifications: NotificationInput[];
    show(notification: NotificationInput): NotificationHandle;
    hide(notification: string | NotificationInput): void;
    addChangeListener(listener: () => void): () => void;
};

const {default: Notifications} = await import("@stores/notifications") as {default: NotificationsStore};

describe("notification store contract", () => {
    test("keeps entries and handles consistent", () => {
        const weakMapDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "getOrInsertComputed");

        let changeCount = 0;
        const removeChangeListener = Notifications.addChangeListener(() => changeCount++);

        const firstDuplicatePayload: NotificationInput = {id: "store-duplicate", title: "first payload"};
        const secondDuplicatePayload: NotificationInput = {id: "store-duplicate", title: "second payload"};
        const firstDuplicate = Notifications.show(firstDuplicatePayload);
        const secondDuplicate = Notifications.show(secondDuplicatePayload);

        expect(changeCount).toBe(1);
        expect(Notifications.notifications).toHaveLength(1);
        expect(Notifications.notifications[0]).toBe(firstDuplicatePayload);
        expect(firstDuplicate.id).toBe("store-duplicate");
        expect(secondDuplicate.id).toBe("store-duplicate");
        expect(firstDuplicate.isVisible()).toBe(true);
        expect(secondDuplicate.isVisible()).toBe(true);

        firstDuplicate.close();
        expect(changeCount).toBe(2);
        expect(firstDuplicate.isVisible()).toBe(false);
        expect(secondDuplicate.isVisible()).toBe(false);
        secondDuplicate.close();
        expect(changeCount).toBe(2);

        const sameAnonymousPayload: NotificationInput = {title: "same anonymous payload"};
        const firstAnonymous = Notifications.show(sameAnonymousPayload);
        const secondAnonymous = Notifications.show(sameAnonymousPayload);

        expect(changeCount).toBe(4);
        expect(Notifications.notifications).toHaveLength(2);
        expect(Notifications.notifications[0]).toBe(sameAnonymousPayload);
        expect(Notifications.notifications[1]).toBe(sameAnonymousPayload);
        expect(firstAnonymous.id).toBeUndefined();
        expect(secondAnonymous.id).toBeUndefined();
        expect(firstAnonymous.isVisible()).toBe(true);
        expect(secondAnonymous.isVisible()).toBe(true);

        firstAnonymous.close();
        expect(changeCount).toBe(5);
        expect(firstAnonymous.isVisible()).toBe(false);
        expect(secondAnonymous.isVisible()).toBe(true);
        firstAnonymous.close();
        expect(changeCount).toBe(5);
        secondAnonymous.close();
        expect(changeCount).toBe(6);

        const hideStringTarget = Notifications.show({id: "store-hide-string", title: "hide string"});
        const hideStringOther = Notifications.show({id: "store-keep-string", title: "keep string"});
        expect(changeCount).toBe(8);
        Notifications.hide("store-hide-string");
        expect(changeCount).toBe(9);
        expect(hideStringTarget.isVisible()).toBe(false);
        expect(hideStringOther.isVisible()).toBe(true);
        Notifications.hide("store-hide-string");
        expect(changeCount).toBe(9);

        const hideObjectPayload: NotificationInput = {title: "hide object"};
        const keepObjectPayload: NotificationInput = {title: "keep object"};
        const hideObjectTarget = Notifications.show(hideObjectPayload);
        const hideObjectOther = Notifications.show(keepObjectPayload);
        expect(changeCount).toBe(11);
        Notifications.hide(hideObjectPayload);
        expect(changeCount).toBe(12);
        expect(hideObjectTarget.isVisible()).toBe(false);
        expect(hideObjectOther.isVisible()).toBe(true);
        Notifications.hide(hideObjectPayload);
        expect(changeCount).toBe(12);

        Notifications.hide("store-keep-string");
        Notifications.hide(keepObjectPayload);
        expect(changeCount).toBe(14);
        expect(Notifications.notifications).toHaveLength(0);

        removeChangeListener();
        expect(Object.getOwnPropertyDescriptor(WeakMap.prototype, "getOrInsertComputed")).toEqual(weakMapDescriptor);
    });
});
