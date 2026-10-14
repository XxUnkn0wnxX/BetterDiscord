import {afterEach, beforeEach, expect, mock, spyOn, test} from "bun:test";
import React, {act, type PropsWithChildren, type RefObject} from "react";
import {createRoot, type Root} from "react-dom/client";
import {transformSync} from "esbuild";
import type {Webpack} from "@typed/discord";

// Load package source at runtime so its separate TS compiler conventions do
// not become part of the repository's typecheck.
const {default: RealFocusRingScope}: {default: typeof import("react-focus-rings").FocusRingScope} = await import(
    new URL("../../../node_modules/react-focus-rings/src/FocusRingScope.tsx", import.meta.url).href
);
const {default: FocusRingContext}: {default: React.Context<{container: Element | null; invalidate: () => void}>} = await import(
    new URL("../../../node_modules/react-focus-rings/src/FocusRingContext.tsx", import.meta.url).href
);

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const moduleCache: Record<string, Webpack.Module> = {};
const sources: Record<string, Webpack.RawModule> = {};
const cachedIds = new Map<string, string>();
const roots: Root[] = [];
const lookups: string[] = [];
const refs: Array<RefObject<Element | null>> = [];
const managers: Array<React.ContextType<typeof FocusRingContext>> = [];
const legacyProps: Array<Record<string, unknown>> = [];
const renderErrors: unknown[][] = [];
const springConfigs: any[] = [];
const focusLocks: Array<RefObject<HTMLElement | null>> = [];
const pendingFocus: Array<() => void> = [];
const focusLockProps: Array<Record<string, unknown>> = [];
let legacyReads = 0;
const accessibilityContext = React.createContext({reducedMotion: {enabled: false}});
const childContext = React.createContext("default");

mock.module(import.meta.resolve("../../../src/betterdiscord/webpack/require"), () => ({webpackRequire: {c: moduleCache, m: sources}, lazyListeners: new Set()}));
mock.module(import.meta.resolve("../../../src/betterdiscord/webpack/cache"), () => ({"default": {
    get: (id: string) => {lookups.push(id); return cachedIds.get(id);},
    set: (id: string, moduleId: string) => cachedIds.set(id, moduleId),
    getIdFromStack: () => undefined
}}));
mock.module("@common/logger", () => ({"default": {warn: () => {}}}));

// Keep production factory filtering, module search and export mapping.
const searching = await import("../../../src/betterdiscord/webpack/searching");
const webpack = await import("../../../src/betterdiscord/webpack/webpack");
const Filters = await import("../../../src/betterdiscord/webpack/filter");
mock.module("@webpack", () => ({...searching, ...webpack, Filters}));

const AnimatedDiv = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>((props, ref) => <div {...props} ref={ref}/>);
mock.module("@modules/discordmodules", () => ({"default": {
    AccessibilityContext: accessibilityContext,
    ReactSpring: {
        animated: {div: AnimatedDiv},
        useSpring: (config: any) => {springConfigs.push(config); return {opacity: config.opacity, transform: config.transform};}
    }
}}));

function add(id: string, exports: any, source = "fixture") {
    moduleCache[id] = {id, exports, declarations: {}, loaded: true};
    sources[id] = Object.assign(() => undefined, {toString: () => source});
}

const easing = {inOut: (value: unknown) => value, back: () => "back", quad: "quad"};
add("615300", {Easing: easing});
const {default: ModalRoot} = await import("../../../src/betterdiscord/ui/modals/root.tsx");

// Execute the package's actual scope implementation; only its factory text is
// formatted like Discord's minified bundle for the production export mapper.
const scopeSource = transformSync(`export default (${String(RealFocusRingScope)})`, {
    minifyWhitespace: true,
    minifySyntax: true
}).code;
function Scope(props: React.ComponentProps<typeof RealFocusRingScope>) {
    refs.push(props.containerRef);
    return RealFocusRingScope(props);
}
Object.defineProperty(Scope, "toString", {value: () => scopeSource});

const legacyRender = (_props: PropsWithChildren<{disableTrack?: boolean}>, _ref: React.ForwardedRef<unknown>) => {
    legacyProps.push(_props);
    const ref = React.useRef<HTMLDivElement>(null);
    useNativeFocusLock(ref);
    return <div role="dialog" ref={ref} tabIndex={-1}><Scope containerRef={ref}>{_props.children}</Scope></div>;
};
const LegacyFocusLock = React.forwardRef(legacyRender);
Object.defineProperty(legacyRender, "toString", {
    value: () => {legacyReads++; return "function(){impressionProperties;return x.Provider;}";}
});
function FunctionalDialog(props: PropsWithChildren<{disableTrack?: boolean}>) {
    return legacyRender(props, null);
}
Object.defineProperty(FunctionalDialog, "toString", {value: () => "function(){impressionProperties;return x.Provider;}"});

function addScope() {
    add("42", {scope: Scope}, "function(){return 'focus-rings-ring';}");
}

// Representative native lock ordering: only the newest layer redirects focus,
// and a queued focusin checks that ownership again before moving it.
function useNativeFocusLock(containerRef: RefObject<HTMLElement | null>, disableReturn?: boolean) {
    const previous = React.useRef(document.activeElement as HTMLElement | null);
    React.useLayoutEffect(() => {
        focusLocks.push(containerRef);
        const focusFirst = () => {
            const container = containerRef.current;
            const target = container?.querySelector<HTMLElement>("input, button, [tabindex='0']") ?? container;
            target?.focus();
        };
        const onFocus = (event: FocusEvent) => {
            const target = event.target as Node;
            pendingFocus.push(() => {
                if (focusLocks[focusLocks.length - 1] === containerRef && !containerRef.current?.contains(target)) focusFirst();
            });
        };
        document.addEventListener("focusin", onFocus, true);
        if (!containerRef.current?.contains(document.activeElement)) focusFirst();
        return () => {
            document.removeEventListener("focusin", onFocus, true);
            focusLocks.splice(focusLocks.indexOf(containerRef), 1);
            if (!disableReturn) {
                pendingFocus.push(() => {
                    const target = previous.current;
                    const current = focusLocks[focusLocks.length - 1]?.current;
                    if (target?.isConnected && (!current || current.contains(target))) target.focus();
                });
            }
        };
    }, [containerRef, disableReturn]);
}

function NativeFocusLock(props: PropsWithChildren<{containerRef: RefObject<HTMLElement | null>; disableReturn?: boolean}>) {
    focusLockProps.push(props);
    useNativeFocusLock(props.containerRef, props.disableReturn);
    return props.children;
}
Object.defineProperty(NativeFocusLock, "toString", {value: () => "function(e){lock(e.containerRef,{disableReturn:e.disableReturn});return e.children}"});

function addFocusLock() {
    add("73", {lock: NativeFocusLock}, "function(){containerElementRef;disableReturnRef;}");
}

function SettingsOwner({children}: PropsWithChildren) {
    const ref = React.useRef<HTMLDivElement>(null);
    useNativeFocusLock(ref);
    return <><div ref={ref}><input aria-label="Background search" defaultValue="original search"/></div>{children}</>;
}

function settleFocus() {
    act(() => {
        // Bound the queue so a runaway redirect is reported, not hidden.
        for (let count = 0; pendingFocus.length && count < 20; count++) {
            const callbacks = pendingFocus.splice(0);
            for (const callback of callbacks) callback();
        }
    });
    expect(pendingFocus.length).toBe(0);
}

function typeIntoActiveElement(value: string) {
    const input = document.activeElement as HTMLInputElement;
    act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

function Input({onMount}: {onMount?: () => void}) {
    const context = React.useContext(childContext);
    const manager = React.useContext(FocusRingContext);
    managers.push(manager);
    const [value, setValue] = React.useState("");
    React.useEffect(() => {onMount?.();}, [onMount]);
    return <>
        <input aria-label="Modal input" value={value} onInput={event => setValue(event.currentTarget.value)}/>
        <span data-context>{context}</span>
    </>;
}

function render(element: React.ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(element));
    return {container, root};
}

beforeEach(() => {
    for (const id of Object.keys(moduleCache)) delete moduleCache[id];
    for (const id of Object.keys(sources)) delete sources[id];
    cachedIds.clear();
    lookups.length = 0;
    refs.length = 0;
    managers.length = 0;
    legacyProps.length = 0;
    renderErrors.length = 0;
    springConfigs.length = 0;
    focusLocks.length = 0;
    pendingFocus.length = 0;
    focusLockProps.length = 0;
    legacyReads = 0;
    document.documentElement.classList.remove("reduce-motion");
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {renderErrors.push(args);});
});

afterEach(() => {
    act(() => {for (const root of roots) root.unmount();});
    roots.length = 0;
    expect(focusLocks.length).toBe(0);
    pendingFocus.length = 0;
    document.body.replaceChildren();
    document.documentElement.classList.remove("reduce-motion");
    expect(renderErrors.length).toBe(0);
    mock.restore();
});

test("combines native focus management and the actual ring scope while preserving its ref and child context", () => {
    expect(Filters.byStrings(".current),", ".Provider,{value:", ".current.setThemeOptions")(Scope)).toBe(true);
    addScope();
    addFocusLock();
    add("305866", {legacy: LegacyFocusLock});
    const {container, root} = render(<childContext.Provider value="Settings owner">
        <ModalRoot transitionState={1} size={ModalRoot.Sizes.SMALL} style={ModalRoot.Styles.STANDARD} className="custom-modal">
            <Input/>
        </ModalRoot>
    </childContext.Provider>);

    const modal = container.querySelector<HTMLDivElement>(".bd-modal-root")!;
    expect(modal.className).toBe("bd-modal-root bd-modal-small custom-modal bd-modal-standard");
    expect(refs[0].current === modal, "The ring ref targets the animated container").toBe(true);
    expect(container.querySelector("[data-context]")?.textContent).toBe("Settings owner");
    expect(legacyProps.length).toBe(0);
    expect(legacyReads).toBe(0);
    expect(lookups).toContain("core-modalroot-focus-manager");
    expect(lookups).not.toContain("core-modalroot-dialog");
    expect(focusLockProps[0].containerRef === refs[0], "Native management shares the ring container ref").toBe(true);
    expect(focusLocks.length).toBe(1);

    const manager = managers[0];
    expect(manager.container === modal, "Ring context owns the modal container").toBe(true);
    const invalidate = manager.invalidate;
    const heldRef = refs[0];
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(heldRef.current === null, "Unmount clears the container ref").toBe(true);
    expect(modal.isConnected).toBe(false);
    expect(manager.invalidate).not.toBe(invalidate);
    expect(focusLocks.length).toBe(0);
});

test("typing stays in a modal above Settings after its queued focus redirect settles, with close and reopen cleanup", () => {
    addScope();
    addFocusLock();
    const element = (open: boolean) => <SettingsOwner>{open && <ModalRoot transitionState={1}><Input/></ModalRoot>}</SettingsOwner>;
    const {container, root} = render(element(false));
    const search = container.querySelector<HTMLInputElement>("[aria-label='Background search']")!;
    search.focus();
    settleFocus();

    for (let cycle = 0; cycle < 2; cycle++) {
        act(() => root.render(element(true)));
        const input = container.querySelector<HTMLInputElement>("[aria-label='Modal input']")!;
        input.focus();
        settleFocus();
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Modal input");
        expect(document.activeElement === input).toBe(true);
        typeIntoActiveElement(`modal value ${cycle}`);
        expect(input.value).toBe(`modal value ${cycle}`);
        expect(search.value).toBe("original search");
        expect(focusLocks.length).toBe(2);
        expect(Object.prototype.hasOwnProperty.call(focusLockProps[focusLockProps.length - 1], "disableReturn")).toBe(false);
        act(() => root.render(element(false)));
        settleFocus();
        expect(document.activeElement === search, "Closing restores the underlying Settings search").toBe(true);
        expect(focusLocks.length).toBe(1);
    }
});

test("preserves input state, focus and identity when capabilities change during an open modal", () => {
    let mounts = 0;
    const onMount = () => {mounts++;};
    const element = (state: number) => <ModalRoot transitionState={state}><Input onMount={onMount}/></ModalRoot>;
    const {container, root} = render(element(1));
    const input = container.querySelector<HTMLInputElement>("input")!;
    input.focus();
    act(() => {
        input.value = "typed text";
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
    addScope();
    addFocusLock();
    act(() => root.render(element(2)));
    expect(container.querySelector("input") === input, "Late capability discovery preserves input identity").toBe(true);
    expect(input.value).toBe("typed text");
    expect(document.activeElement === input, "Late capability discovery preserves input focus").toBe(true);
    expect(mounts).toBe(1);
    expect(refs.length).toBe(0);
    expect(focusLockProps.length).toBe(0);

    render(element(1));
    expect(refs.length).toBe(1);
    expect(refs[0].current?.classList.contains("bd-modal-root")).toBe(true);
    expect(focusLockProps.length).toBe(1);
});

test("keeps selected manager and scope identities if mapped exports are replaced during rerender", () => {
    addScope();
    addFocusLock();
    const {container, root} = render(<ModalRoot transitionState={1}><Input/></ModalRoot>);
    const input = container.querySelector<HTMLInputElement>("input")!;
    input.focus();
    act(() => {
        input.value = "scope input";
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
    const firstRef = refs[0];
    expect(firstRef.current === container.querySelector(".bd-modal-root"), "Scope ref targets the original modal").toBe(true);
    moduleCache["42"].exports.scope = () => <div>replacement</div>;
    moduleCache["73"].exports.lock = () => <div>replacement lock</div>;
    act(() => root.render(<ModalRoot transitionState={2}><Input/></ModalRoot>));
    expect(container.querySelector("input") === input, "Export replacement preserves input identity").toBe(true);
    expect(input.value).toBe("scope input");
    expect(document.activeElement === input, "Export replacement preserves input focus").toBe(true);
    expect(refs[refs.length - 1] === firstRef, "Export replacement preserves the scope ref").toBe(true);
    expect(container.textContent).not.toContain("replacement");
    expect(focusLocks.length).toBe(1);
    expect(focusLockProps[focusLockProps.length - 1].containerRef === firstRef, "Export replacement preserves the manager ref").toBe(true);
});

test("uses functional and forwardRef native dialogs when the manager factory or its mapped export is missing", () => {
    addScope();
    for (const [index, dialog] of [FunctionalDialog, LegacyFocusLock].entries()) {
        if (index === 1) add("73", {unrelated: () => null}, "containerElementRef;disableReturnRef;");
        add("81", {dialog});
        const element = (open: boolean) => <SettingsOwner>{open && <ModalRoot transitionState={1}><Input/></ModalRoot>}</SettingsOwner>;
        const {container, root} = render(element(false));
        const search = container.querySelector<HTMLInputElement>("[aria-label='Background search']")!;
        search.focus();
        settleFocus();
        const before = refs.length;
        act(() => root.render(element(true)));
        const input = container.querySelector<HTMLInputElement>("[aria-label='Modal input']")!;
        input.focus();
        settleFocus();
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Modal input");
        typeIntoActiveElement(`dialog ${index}`);
        expect(input.value).toBe(`dialog ${index}`);
        expect(search.value).toBe("original search");
        expect(focusLockProps.length).toBe(0);
        expect(focusLocks.length).toBe(2);
        expect(new Set(refs.slice(before)).size).toBe(1); // Only the dialog's own scope; no extra outer scope.
        expect(refs[refs.length - 1].current?.getAttribute("role")).toBe("dialog");
        expect(legacyProps[legacyProps.length - 1].disableTrack).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(legacyProps[legacyProps.length - 1], "containerRef")).toBe(false);
        act(() => root.render(element(false)));
        settleFocus();
        expect(document.activeElement === search).toBe(true);
        act(() => root.unmount());
        roots.splice(roots.indexOf(root), 1);
        settleFocus();
        expect(focusLocks.length).toBe(0);
    }
});

test("rejects arbitrary render objects and degrades to a visual scope or Fragment when no native manager exists", () => {
    add("81", {invalid: {render: legacyRender}, invalidForwardRef: {$$typeof: Symbol.for("react.forward_ref"), render: "not callable"}});
    addScope();
    const {container: scoped} = render(<ModalRoot transitionState={1}><Input/></ModalRoot>);
    expect(refs[0].current === scoped.querySelector(".bd-modal-root"), "Degraded visual scope keeps its container ref").toBe(true);
    expect(legacyProps.length).toBe(0);
    expect(focusLocks.length).toBe(0);
    delete moduleCache["42"];
    const before = refs.length;
    const {container} = render(<ModalRoot transitionState={1}><input defaultValue="Fragment"/></ModalRoot>);
    expect(container.children.length).toBe(1);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Fragment");
    expect(refs.length).toBe(before);
    expect(legacyProps.length).toBe(0);
});

test("native management works without a ring scope and focuses an empty container without making it a tab stop", () => {
    add("42", {manager: {}}, "focus-rings-ring");
    addFocusLock();
    const element = (open: boolean) => <SettingsOwner>{open && <ModalRoot transitionState={1}><span>No controls</span></ModalRoot>}</SettingsOwner>;
    const {container, root} = render(element(false));
    const search = container.querySelector<HTMLInputElement>("[aria-label='Background search']")!;
    search.focus();
    settleFocus();
    act(() => root.render(element(true)));
    settleFocus();
    const modal = container.querySelector<HTMLDivElement>(".bd-modal-root")!;
    expect(modal.tabIndex).toBe(-1);
    expect(document.activeElement === modal).toBe(true);
    expect(refs.length).toBe(0);
    expect((focusLockProps[0].containerRef as RefObject<HTMLElement>).current === modal).toBe(true);
    act(() => root.render(element(false)));
    settleFocus();
    expect(document.activeElement === search).toBe(true);
});

test("retains transition durations, scaling, reduced motion and mapped modal constants", () => {
    const {container, root} = render(<ModalRoot transitionState={2}/>);
    expect(springConfigs[0]).toMatchObject({opacity: 0, transform: "scale(0.7)", config: {duration: 100, clamp: true}});
    expect(container.querySelector<HTMLDivElement>(".bd-modal-root")?.style.transform).toBe("scale(0.7)");
    act(() => root.render(<ModalRoot transitionState={0}/>));
    expect(springConfigs[springConfigs.length - 1]).toMatchObject({opacity: 1, transform: "scale(1)", config: {duration: 300, clamp: true}});
    document.documentElement.classList.add("reduce-motion");
    act(() => root.render(<accessibilityContext.Provider value={undefined as any}><ModalRoot transitionState={2}/></accessibilityContext.Provider>));
    expect(springConfigs[springConfigs.length - 1].transform).toBe("scale(1)");
    expect(ModalRoot.Sizes.DYNAMIC).toBe("");
    expect(ModalRoot.Styles.CUSTOM).toBe("");
});
