import React, {useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent} from "react";

import Button from "@ui/base/button";
import {KeyboardIcon, XIcon} from "lucide-react";
import {useItemProps, type BaseSettingProps} from "./utils";
import {useCallbackRef} from "@ui/hooks";


interface BaseKeybindProps {
    max?: number;
    clearable?: boolean;
}

export type KeybindProps = BaseKeybindProps & BaseSettingProps<string[]>;

export default function Keybind(props: KeybindProps) {
    const {max = 4, clearable = false} = props;
    const {state, setState, disabled} = useItemProps<string[]>(props);

    const [isRecording, setRecording] = useState(false);
    const accum = useRef<string[]>([]);

    useLayoutEffect(() => {
        if (!disabled) return;

        accum.current.length = 0;
        setRecording(false);
    }, [disabled]);

    const dispatch = useCallback(() => {
        setRecording(false);

        const value = accum.current.slice();
        accum.current.length = 0;
        if (value.length > 0) setState(value);
    }, [setState]);

    const keyDownHandler = useCallbackRef((event: KeyboardEvent) => {
        if (disabled || !isRecording) return;

        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();

        if (event.repeat || accum.current.includes(event.key)) return;

        accum.current.push(event.key);

        if (accum.current.length >= max) dispatch();
    });

    const keyUpHandler = useCallbackRef((event: KeyboardEvent) => {
        if (disabled || !isRecording) return;

        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();

        if (event.key === accum.current[0]) dispatch();
    });

    useEffect(() => {
        window.addEventListener("keydown", keyDownHandler, true);
        window.addEventListener("keyup", keyUpHandler, true);

        return () => {
            window.removeEventListener("keydown", keyDownHandler, true);
            window.removeEventListener("keyup", keyUpHandler, true);
        };
    }, [keyDownHandler, keyUpHandler]);

    const clearKeybind = useCallback((event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();

        if (disabled) return;

        setRecording(false);
        accum.current.length = 0;
        setState([]);
    }, [disabled, setState]);

    const onClick = useCallback((event: MouseEvent) => {
        if (disabled) return;
        if (event.currentTarget?.className?.includes?.("bd-keybind-clear") || event.currentTarget?.closest(".bd-button")?.className?.includes("bd-keybind-clear")) return clearKeybind(event);

        accum.current.length = 0;
        setRecording(value => !value);
    }, [disabled, clearKeybind]);

    const activeRecording = isRecording && !disabled;
    const displayValue = !state.length ? "" : state.map(k => k === "Control" ? "Ctrl" : k).join(" + ");
    return (
        <div className={"bd-keybind-wrap" + (activeRecording ? " recording" : "") + (disabled ? " bd-keybind-disabled" : "")} onClick={onClick}>
            <Button size={Button.Sizes.ICON} look={Button.Looks.FILLED} color={activeRecording ? Button.Colors.RED : Button.Colors.PRIMARY} className="bd-keybind-record" onClick={onClick} disabled={disabled}>
                <KeyboardIcon size="24px" />
            </Button>

            <input readOnly={true} type="text" className="bd-keybind-input" value={displayValue} placeholder="No keybind set" disabled={disabled} />

            {clearable && (
                <Button size={Button.Sizes.ICON} look={Button.Looks.BLANK} onClick={clearKeybind} className="bd-keybind-clear" disabled={disabled}>
                    <XIcon size="24px" />
                </Button>
            )}
        </div>
    );
}
