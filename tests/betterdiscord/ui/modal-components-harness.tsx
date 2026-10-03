import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import path from "node:path";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const roots: Root[] = [];
const loggerErrors: unknown[][] = [];
const accessibilityContext = React.createContext({reducedMotion: {enabled: false}});

const modalSizes = Object.freeze({
    SMALL: "bd-modal-small",
    MEDIUM: "bd-modal-medium",
    LARGE: "bd-modal-large",
    DYNAMIC: ""
});

const MockModalRoot = ({size, className, children}: {size?: string; className?: string; children?: ReactNode}) => (
    <div className={className} data-modal-root data-size={size}>{children}</div>
);

mock.module(path.resolve(import.meta.dir, "../../../src/betterdiscord/ui/modals/root.tsx"), () => ({
    "default": Object.assign(MockModalRoot, {Sizes: modalSizes})
}));

mock.module("@modules/discordmodules", () => ({
    "default": {AccessibilityContext: accessibilityContext}
}));

mock.module("@ui/errorboundary.tsx", () => ({
    "default": ({children}: {children?: ReactNode}) => <>{children}</>
}));

mock.module("@common/logger.ts", () => ({
    "default": {err: (...args: unknown[]) => loggerErrors.push(args)}
}));

const {default: Modal} = await import("../../../src/betterdiscord/ui/modals/modal.tsx");
const {default: Button} = await import("../../../src/betterdiscord/ui/base/button.tsx");
const {default: SettingItem} = await import("../../../src/betterdiscord/ui/settings/components/item.tsx");

type ModalProps = React.ComponentProps<typeof Modal>;

function render(element: React.ReactElement): {container: HTMLDivElement; root: Root} {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(element));
    return {container, root};
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    });
}

afterEach(async () => {
    await act(async () => {
        for (const root of roots) root.unmount();
    });
    document.body.replaceChildren();
    roots.length = 0;
    loggerErrors.length = 0;
});

describe("Modal", () => {
    test("renders its content, notice, custom icon, checkbox, and canonical mapped constants", () => {
        const customIcon = () => <span data-testid="custom-notice-icon"/>;
        const {container} = render(
            <Modal
                size="sm"
                title="Modal title"
                subtitle="Modal subtitle"
                notice={{message: "Notice text", type: "positive", icon: customIcon}}
                checkboxProps={{note: "Remember me", defaultValue: true, onChange: () => {}}}
                actions={[
                    {label: "Connected color", color: "success"},
                    {label: "Canonical green", color: "bd-button-color-green"},
                    {label: "Custom color", color: ""}
                ]}
            >
                <span>Body content</span>
            </Modal>
        );

        expect(container.querySelector("[data-modal-root]")?.getAttribute("data-size")).toBe(modalSizes.SMALL);
        expect(container.querySelector("h1")?.textContent).toBe("Modal title");
        expect(container.textContent).toContain("Modal subtitle");
        expect(container.textContent).toContain("Body content");
        expect(container.textContent).toContain("Notice text");
        expect(container.querySelector("[data-testid='custom-notice-icon']")).not.toBeNull();
        expect(container.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);

        const buttons = [...container.querySelectorAll<HTMLButtonElement>(".bd-modal-footer button")];
        expect(buttons[0].classList.contains("bd-button-color-green")).toBe(true);
        expect(buttons[1].classList.contains("bd-button-color-green")).toBe(true);
        expect(buttons[2].classList.contains("bd-button-color-primary")).toBe(false);
    });

    test("maps all size aliases and canonical dynamic size, with medium fallback", () => {
        const cases: Array<[ModalProps["size"], string]> = [
            ["sm", modalSizes.SMALL],
            ["md", modalSizes.MEDIUM],
            ["lg", modalSizes.LARGE],
            ["dy", modalSizes.DYNAMIC],
            [modalSizes.DYNAMIC, modalSizes.DYNAMIC],
            [undefined, modalSizes.MEDIUM]
        ];

        for (const [size, expected] of cases) {
            const {container} = render(<Modal size={size} title="Size"/>);
            expect(container.querySelector("[data-modal-root]")?.getAttribute("data-size")).toBe(expected);
        }
    });

    test("maps default and canonical colors, with primary fallback", () => {
        const cases: Array<[ModalProps["actions"], string, boolean]> = [
            [[{label: "Default alias", color: "default"}], "bd-button-color-primary", true],
            [[{label: "Alias", color: "brand"}], "bd-button-color-brand", true],
            [[{label: "Danger alias", color: "danger"}], "bd-button-color-red", true],
            [[{label: "Success alias", color: "success"}], "bd-button-color-green", true],
            [[{label: "Canonical", color: "bd-button-color-red"}], "bd-button-color-red", true],
            [[{label: "Default"}], "bd-button-color-primary", true],
            [[{label: "Custom", color: ""}], "bd-button-color-primary", false]
        ];

        for (const [actions, color, hasClass] of cases) {
            const {container} = render(<Modal title="Color" actions={actions}/>);
            expect(container.querySelector(".bd-modal-footer button")?.classList.contains(color)).toBe(hasClass);
        }
    });

    test("calls onCloseCallback on mount, checkbox change, and callback identity change", async () => {
        const calls: string[] = [];
        const firstCallback: NonNullable<ModalProps["onCloseCallback"]> = ({checked}) => calls.push(`first:${checked}`);
        const secondCallback: NonNullable<ModalProps["onCloseCallback"]> = ({checked}) => calls.push(`second:${checked}`);
        const onChange = (checked: boolean) => calls.push(`change:${checked}`);
        const {container, root} = render(
            <Modal title="Checkbox" checkboxProps={{note: "Enable", defaultValue: true, onChange}} onCloseCallback={firstCallback}/>
        );

        expect(calls).toEqual(["first:true"]);
        await click(container.querySelector("input[type=checkbox]")!);
        expect(calls).toEqual(["first:true", "change:false", "first:false"]);
        expect(container.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(false);

        await act(async () => {
            root.render(<Modal title="Checkbox" checkboxProps={{note: "Enable", defaultValue: true, onChange}} onCloseCallback={secondCallback}/>);
        });
        expect(calls).toEqual(["first:true", "change:false", "first:false", "second:false"]);
    });

    test("keeps actions open for false results and closeOnClick false", async () => {
        let closeCount = 0;
        const {container} = render(
            <Modal
                title="Actions"
                onClose={() => closeCount++}
                actions={[
                    {label: "False", onClick: () => false},
                    {label: "Keep open", closeOnClick: false, onClick: () => true}
                ]}
            />
        );

        const buttons = container.querySelectorAll(".bd-modal-footer button");
        await click(buttons[0]);
        await click(buttons[1]);
        expect(closeCount).toBe(0);
    });

    test("logs rejected action errors and leaves the modal open", async () => {
        const error = new Error("action rejected");
        let closeCount = 0;
        const {container} = render(
            <Modal title="Rejected" onClose={() => closeCount++} actions={[{label: "Reject", onClick: () => Promise.reject(error)}]}/>
        );

        await click(container.querySelector(".bd-modal-footer button")!);
        expect(closeCount).toBe(0);
        expect(loggerErrors).toEqual([["Components.Modal", "Action failed:", error]]);
        expect(container.querySelector<HTMLButtonElement>(".bd-modal-footer button")?.disabled).toBe(false);
    });

    test("shows a spinner and disables every action while pending, then closes once on fulfillment", async () => {
        let resolveAction!: (value: void) => void;
        const actionResult = new Promise<void>(resolve => {resolveAction = resolve;});
        let closeCount = 0;
        const {container} = render(
            <Modal
                title="Pending"
                onClose={() => closeCount++}
                actions={[
                    {label: "Wait", onClick: () => actionResult},
                    {label: "Other", onClick: () => {}}
                ]}
            />
        );

        const buttons = [...container.querySelectorAll<HTMLButtonElement>(".bd-modal-footer button")];
        await click(buttons[0]);
        expect(buttons.every(button => button.disabled)).toBe(true);
        expect(buttons[0].querySelector(".bd-spinner-pulsing-ellipsis")).not.toBeNull();
        expect(buttons[0].textContent).not.toContain("Wait");
        expect(buttons[1].textContent).toContain("Other");

        await act(async () => {
            resolveAction();
            await actionResult;
        });
        expect(buttons.every(button => !button.disabled)).toBe(true);
        expect(buttons[0].querySelector(".bd-spinner")).toBeNull();
        expect(buttons[0].textContent).toContain("Wait");
        expect(closeCount).toBe(1);
    });
});

describe("Button and SettingItem", () => {
    test("Button defaults to its children and submitting alone keeps it enabled", () => {
        const {container} = render(
            <>
                <Button>Default label</Button>
                <Button submitting>Loading label</Button>
            </>
        );
        const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];

        expect(buttons[0].textContent).toBe("Default label");
        expect(buttons[0].disabled).toBe(false);
        expect(buttons[1].querySelector(".bd-spinner")).not.toBeNull();
        expect(buttons[1].textContent).not.toContain("Loading label");
        expect(buttons[1].disabled).toBe(false);
    });

    test("SettingItem includes its divider by default and can omit it", () => {
        const {container} = render(
            <>
                <SettingItem id="default" name="Default"/>
                <SettingItem id="without-divider" name="No divider" divider={false}/>
            </>
        );

        const items = container.querySelectorAll(".bd-setting-item");
        expect(items[0].querySelector(".bd-setting-divider")).not.toBeNull();
        expect(items[1].querySelector(".bd-setting-divider")).toBeNull();
    });
});
