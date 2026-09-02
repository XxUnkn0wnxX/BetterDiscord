import Store from "@stores/base.ts";
import type {Notification} from "@ui/notifications.tsx";

export interface NotificationEntry {
    readonly key: string;
    readonly notification: Notification;
}

class Notifications extends Store {
    private notificationEntries: NotificationEntry[] = [];
    private nextEntryKey = 0;

    private createEntry(notification: Notification): NotificationEntry {
        return {
            key: `notification-${this.nextEntryKey++}`,
            notification
        };
    }

    private removeEntry(entry: NotificationEntry): boolean {
        const index = this.notificationEntries.indexOf(entry);
        if (index === -1) return false;

        this.notificationEntries = [
            ...this.notificationEntries.slice(0, index),
            ...this.notificationEntries.slice(index + 1)
        ];
        this.emitChange();
        return true;
    }

    show(notification: Notification) {
        const existingEntry = typeof notification.id === "string"
            ? this.notificationEntries.find(entry => entry.notification.id === notification.id)
            : undefined;
        const entry = existingEntry ?? this.createEntry(notification);

        if (!existingEntry) {
            this.notificationEntries = [...this.notificationEntries, entry];
            this.emitChange();
        }

        return {
            id: entry.notification.id,
            isVisible: () => this.notificationEntries.includes(entry),
            close: () => {
                this.removeEntry(entry);
            }
        };
    }

    hide(notification: Notification | string) {
        const entry = typeof notification === "string"
            ? this.notificationEntries.find(candidate => candidate.notification.id === notification)
            : this.notificationEntries.find(candidate => candidate.notification === notification);

        if (entry) this.hideEntry(entry);
    }

    hideEntry(entry: NotificationEntry): void {
        this.removeEntry(entry);
    }

    get entries(): readonly NotificationEntry[] {
        return this.notificationEntries;
    }

    get notifications(): Notification[] {
        return this.notificationEntries.map(entry => entry.notification);
    }
};

export default new Notifications();
