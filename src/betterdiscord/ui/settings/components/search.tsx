import React, {useCallback, useEffect, useRef, type KeyboardEvent} from "react";
import Button from "@ui/base/button";
import {SearchIcon, XIcon} from "lucide-react";
import clsx from "clsx";
import {useItemProps, type BaseSettingProps} from "./utils";

interface BaseSearchProps {
    className?: string;
    placeholder?: string;
    max?: number;
    onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
}

type SearchStateProps = BaseSettingProps<string> | {
    value?: never;
    defaultValue?: never;
    onChange?(value: string): void;
    disabled?: boolean;
};

export type SearchProps = BaseSearchProps & SearchStateProps;

export default function Search(props: SearchProps) {
    const {className, onKeyDown, placeholder, max = 50} = props;
    const itemProps: BaseSearchProps & BaseSettingProps<string> = "value" in props || "defaultValue" in props
            ? props as BaseSearchProps & BaseSettingProps<string>
            : {...props, defaultValue: ""};
    const {state, setState, disabled} = useItemProps<string, string | React.ChangeEvent<HTMLInputElement>>(itemProps, (value) => {
        if (typeof value === "object") return value.currentTarget.value;
        return value;
    });

    const input = useRef<HTMLInputElement>(null);

    const reset = useCallback(() => {
        if (disabled) return;

        setState("");
        input.current?.focus();
    }, [disabled, setState]);

    useEffect(() => {
        if (!disabled) input.current?.focus();
    }, [disabled]);

    return <div className={clsx("bd-search-wrapper", disabled && "bd-search-disabled", className)}>
        <input autoFocus={!disabled} disabled={disabled} onChange={setState} onKeyDown={onKeyDown} type="text" className="bd-search" placeholder={placeholder} maxLength={max} value={state} ref={input} />
        {!state && <SearchIcon size="18px" />}
        {state && (
            <Button look={Button.Looks.BLANK} color={Button.Colors.TRANSPARENT} size={Button.Sizes.NONE} onClick={reset}>
                <XIcon size="16px" />
            </Button>
        )}
    </div>;

}
