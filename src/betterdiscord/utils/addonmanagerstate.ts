/**
 * Keep plugins.json/themes.json as live installed-addon inventories. The value is deliberately
 * ignored: enabled, disabled, and partial/broken addons all remain valid while their manager ID
 * is still present.
 */
export function pruneMissingAddonState(state: Record<string, boolean>, installedIds: Iterable<string>, inventoryComplete = true) {
    // A temporarily malformed addon file may be between editor writes. Until every addon-looking
    // file is representable, unknown saved IDs cannot be distinguished safely from deleted IDs.
    if (!inventoryComplete) return [];

    const installed = new Set(installedIds);
    const removed: string[] = [];

    for (const id of Object.keys(state)) {
        if (installed.has(id)) continue;
        delete state[id];
        removed.push(id);
    }

    return removed;
}

const addonStateCollator = new Intl.Collator("en", {numeric: true, sensitivity: "base"});

function addonStateSortBucket(id: string) {
    const first = id.trimStart().charAt(0);
    if (/[0-9]/.test(first)) return 0;
    if (/[a-z]/i.test(first)) return 1;
    return 2;
}

/** Serialize numeric-leading IDs first, then A-Z, with a deterministic natural order. */
export function sortAddonState(state: Record<string, boolean>) {
    return Object.fromEntries(Object.entries(state).sort(([left], [right]) => {
        const bucketDifference = addonStateSortBucket(left) - addonStateSortBucket(right);
        return bucketDifference || addonStateCollator.compare(left, right) || left.localeCompare(right);
    }));
}
