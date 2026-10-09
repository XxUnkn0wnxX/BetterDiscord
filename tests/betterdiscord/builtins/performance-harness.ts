import {mock} from "bun:test";

class MockBuiltin {}
mock.module("@structs/builtin", () => ({"default": MockBuiltin}));

const {default: Performance} = await import("../../../src/betterdiscord/builtins/performance");

class Rule {
    constructor(public selectorText: string) {}
}

class GroupingRule {}

class Sheet {
    deleted: number[] = [];

    constructor(public rules: unknown[]) {}

    get cssRules() {return this.rules as unknown as CSSRuleList;}

    deleteRule(index: number) {
        this.deleted.push(index);
        this.rules.splice(index, 1);
    }
}

class Link {
    nodeType = 1;
    onLoad?: () => void;

    constructor(public sheet: Sheet | null = null, public stylesheet = true) {}

    matches(selector: string) {return selector === "link[rel=\"stylesheet\"]" && this.stylesheet;}

    addEventListener(type: string, callback: () => void) {
        if (type === "load") this.onLoad = callback;
    }
}

class TestObserver {
    static instances: TestObserver[] = [];
    disconnected = 0;
    target?: unknown;
    options?: MutationObserverInit;

    constructor(public callback: MutationCallback) {TestObserver.instances.push(this);}

    observe(target: Node, options: MutationObserverInit) {this.target = target; this.options = options;}
    disconnect() {this.disconnected++;}
    emit(...nodes: Node[]) {
        this.callback([{addedNodes: nodes} as unknown as MutationRecord], this as unknown as MutationObserver);
    }
}

Object.assign(globalThis, {
    Node: {ELEMENT_NODE: 1},
    CSSStyleRule: Rule,
    MutationObserver: TestObserver
});

const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
};

async function initialize(...links: Link[]) {
    Performance.found = false;
    Performance.observer = undefined;
    const head = {} as Node;
    Object.assign(globalThis, {
        document: {
            head,
            querySelectorAll: (selector: string) => selector === "link[rel=\"stylesheet\"]" ? links : []
        }
    });
    await Performance.initialize();
    return {head, observer: TestObserver.instances.at(-1)};
}

const beforeTarget = new Rule(".gameOption_unrelated");
const afterTarget = new Rule(".unrelated:has(.other)");
const existingMatch = new Sheet([beforeTarget, new Rule(".gameOption_:has(.gameOption_item)"), afterTarget]);
const existing = await initialize(new Link(existingMatch));
assert(existingMatch.deleted[0] === 1 && existingMatch.rules.length === 2 && existingMatch.rules[0] === beforeTarget && existingMatch.rules[1] === afterTarget, "The matching rule was not removed at its own index while preserving adjacent rules.");
assert(Performance.found && !existing.observer, "An initial match should avoid creating an observer.");

const delayed = await initialize();
assert(delayed.observer!.target === delayed.head && delayed.observer!.options?.childList === true && !delayed.observer!.options?.subtree, "Observation must retain upstream's direct head-child scope.");
const pendingMatch = new Link();
const lateLink = new Link();
delayed.observer!.emit(pendingMatch as unknown as Node, lateLink as unknown as Node);
assert(typeof pendingMatch.onLoad === "function" && typeof lateLink.onLoad === "function", "Inserted stylesheet links did not receive load listeners.");
pendingMatch.sheet = new Sheet([new Rule(".gameOption_:has(.gameOption_item)")]);
pendingMatch.onLoad!();
assert(pendingMatch.sheet.rules.length === 0, "A delayed matching stylesheet rule was not removed.");
assert(delayed.observer!.disconnected === 1 && Performance.observer === undefined, "The observer was not released after a match.");
lateLink.sheet = new Sheet([new Rule(".gameOption_:has(.gameOption_late)")]);
lateLink.onLoad!();
assert(lateLink.sheet.rules.length === 1, "A late load callback acted after a prior match.");

const unreadable = new Link();
const unreadableSheet = new Sheet([]);
Object.defineProperty(unreadableSheet, "cssRules", {get() {throw new Error("cross-origin stylesheet");}});
const preservedRules = [new Rule(".other:has(.other)")];
const nonmatching = new Link(new Sheet([new Rule(".gameOption_other"), new GroupingRule(), ...preservedRules]));
const guarded = await initialize(unreadable, nonmatching);
const unreadableLoad = unreadable.onLoad;
unreadable.sheet = unreadableSheet;
unreadableLoad!();
assert(!Performance.found && guarded.observer!.disconnected === 0, "Unreadable CSS rules should be ignored without stopping observation.");
assert(nonmatching.sheet!.rules.length === 3 && nonmatching.sheet!.deleted.length === 0, "Nonmatching and grouping CSS rules should remain untouched.");

process.stdout.write("performance-cssom: ok\n");
