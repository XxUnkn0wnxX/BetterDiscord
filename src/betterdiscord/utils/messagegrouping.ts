export interface MessageGroupingState {
    first: boolean,
    last: boolean,
}

type MessageGroupingListener = (state: MessageGroupingState) => void;

export type MessageGroupingSubscriber = (listener: MessageGroupingListener) => () => void;

interface MessageGroupingEntry {
    state?: MessageGroupingState,
    listeners: Set<MessageGroupingListener>,
    subscribe: MessageGroupingSubscriber,
}

interface PendingMessageGroupingEntry {
    entry: MessageGroupingEntry,
    state: MessageGroupingState,
}

export interface MessageGroupingRender {
    createSubscriber(id: string, state: MessageGroupingState): MessageGroupingSubscriber,
}

export interface MessageGroupingStore {
    createRender(): MessageGroupingRender,
    commit(render: MessageGroupingRender): void,
    dispose(): void,
}

export function createMessageGroupingStore(): MessageGroupingStore {
    let entries = new Map<string, MessageGroupingEntry>();
    const pending = new WeakMap<MessageGroupingRender, Map<string, PendingMessageGroupingEntry>>();

    function createEntry(): MessageGroupingEntry {
        const listeners = new Set<MessageGroupingListener>();
        const entry: MessageGroupingEntry = {
            listeners,
            subscribe(listener) {
                listeners.add(listener);
                if (entry.state) listener(entry.state);
                return () => void listeners.delete(listener);
            }
        };
        return entry;
    }

    return {
        createRender() {
            const nextEntries = new Map<string, PendingMessageGroupingEntry>();
            const render: MessageGroupingRender = {
                createSubscriber(id, state) {
                    let nextEntry = nextEntries.get(id);
                    if (!nextEntry) {
                        nextEntry = {entry: entries.get(id) ?? createEntry(), state};
                        nextEntries.set(id, nextEntry);
                    }
                    else {
                        nextEntry.state = state;
                    }

                    return nextEntry.entry.subscribe;
                }
            };

            pending.set(render, nextEntries);
            return render;
        },
        commit(render) {
            const nextEntries = pending.get(render);
            if (!nextEntries) return;

            const next = new Map<string, MessageGroupingEntry>();
            for (const [id, {entry, state}] of nextEntries) {
                const previous = entry.state;
                entry.state = state;
                next.set(id, entry);

                if (!previous || previous.first !== state.first || previous.last !== state.last) {
                    for (const listener of entry.listeners) {
                        listener(state);
                    }
                }
            }

            entries = next;
        },
        dispose() {
            entries.clear();
            entries = new Map();
        }
    };
}
