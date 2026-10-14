import clsx from "clsx";
import React, {type PropsWithChildren} from "react";
import DiscordModules from "@modules/discordmodules";
import {Filters, getByKeys, getModule} from "@webpack";


// TODO: rewrite these types properly
const Anims: any = getByKeys(["Easing"], {firstId: 615300, cacheId: "core-modalroot-anims"});


export const ModalSizes = Object.freeze({
    SMALL: "bd-modal-small",
    MEDIUM: "bd-modal-medium",
    LARGE: "bd-modal-large",
    DYNAMIC: ""
});

export const ModalStyles = Object.freeze({
    STANDARD: "bd-modal-standard",
    CUSTOM: ""
});


function getFocusWrapper() {
    const focusRings = getModule<typeof import("react-focus-rings")>(Filters.bySource("focus-rings-ring"), {
        cacheId: "core-react-focus-rings",
        map: {
            FocusRing: Filters.byStrings("FocusRing was given a focusTarget"),
            FocusRingScope: Filters.byStrings(".current),", ".Provider,{value:", ".current.setThemeOptions"),
            FocusRingManager: x => typeof x === "object"
        }
    });
    const FocusRingScope = typeof focusRings?.FocusRingScope === "function" ? focusRings.FocusRingScope : React.Fragment;
    // A ring scope only draws focus outlines. The native manager must also
    // register this modal above the underlying Settings focus lock.
    const focusManager = getModule<{FocusLock?: React.ComponentType<PropsWithChildren<{containerRef: React.RefObject<HTMLDivElement | null>}>>}>(Filters.bySource("containerElementRef", "disableReturnRef"), {
        cacheId: "core-modalroot-focus-manager",
        map: {FocusLock: Filters.byStrings(".containerRef", "disableReturn:", "children")}
    });
    if (typeof focusManager?.FocusLock === "function") return {FocusRingScope, Component: focusManager.FocusLock, kind: "manager" as const};

    // Older clients may expose the dialog as a function or a real forwardRef.
    const matchesDialog = Filters.byStrings("impressionProperties", ".Provider");
    const FocusLock = getModule<React.ElementType>(m => typeof m === "function" ? matchesDialog(m)
        : m?.$$typeof === Symbol.for("react.forward_ref") && typeof m.render === "function" && matchesDialog(m.render), {
        searchExports: true,
        cacheId: "core-modalroot-dialog"
    });
    // The native dialog supplies its own ring scope and focus management.
    return {FocusRingScope: FocusLock ? React.Fragment : FocusRingScope, Component: FocusLock ?? React.Fragment, kind: FocusLock ? "dialog" as const : "fragment" as const};
}

type RootProps = PropsWithChildren<{
    className?: string;
    transitionState?: number;
    size?: typeof ModalSizes[keyof typeof ModalSizes];
    style?: typeof ModalStyles[keyof typeof ModalStyles];
}>;

export default function ModalRoot({className, transitionState, children, size = ModalSizes.DYNAMIC, style = ModalStyles.CUSTOM}: RootProps) {
    const ref = React.useRef<HTMLDivElement>(null);
    // Retry discovery for each new modal, without remounting an open modal's children.
    const [{Component: FocusWrapper, FocusRingScope, kind}] = React.useState(getFocusWrapper);
    const focusProps = kind === "manager" ? {containerRef: ref} : kind === "dialog" ? {disableTrack: true} : {};
    const visible = transitionState == 0 || transitionState == 1; // 300 ms

    const preferences: any = React.useContext(DiscordModules.AccessibilityContext ?? {});
    const reducedMotion = preferences?.reducedMotion?.enabled ?? document.documentElement?.classList.contains("reduce-motion");

    const springStyles = DiscordModules.ReactSpring.useSpring({
        opacity: visible ? 1 : 0,
        transform: visible || reducedMotion ? "scale(1)" : "scale(0.7)",
        config: {
            duration: visible ? 300 : 100,
            easing: visible ? Anims.Easing.inOut(Anims.Easing.back()) : Anims.Easing.quad,
            clamp: true
        }
    });

    const modal = <DiscordModules.ReactSpring.animated.div
        ref={ref}
        tabIndex={-1}
        className={clsx("bd-modal-root", size, className, style)}
        style={springStyles}
    >
        {children}
    </DiscordModules.ReactSpring.animated.div>;

    return <FocusWrapper {...focusProps}>
        {FocusRingScope === React.Fragment ? modal : <FocusRingScope containerRef={ref}>{modal}</FocusRingScope>}
    </FocusWrapper>;
}

ModalRoot.Sizes = ModalSizes;
ModalRoot.Styles = ModalStyles;
