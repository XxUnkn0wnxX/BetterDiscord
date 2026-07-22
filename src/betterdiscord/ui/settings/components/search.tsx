import React, {type ChangeEvent, type KeyboardEvent} from "react";
import Button from "@ui/base/button";
import {SearchIcon, XIcon} from "lucide-react";

const {useState, useEffect, useCallback, useRef} = React;


export interface SearchProps {
    onChange?(event: ChangeEvent<HTMLInputElement>): void;
    className?: string;
    placeholder?: string;
    value?: string;
    onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
}

export default function Search(props: SearchProps) {
    const {onChange, className, onKeyDown, placeholder, value: controlledValue} = props;
    const input = useRef<HTMLInputElement>(null);
    const [internalValue, setInternalValue] = useState("");
    const isControlled = controlledValue !== undefined;
    const value = controlledValue ?? internalValue;

    // focus search bar on page select
    useEffect(() => {
        if (!input.current) return;
        input.current.focus();
    }, []);

    const change = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        onChange?.(e);
        if (!isControlled) setInternalValue(e.target.value);
    }, [isControlled, onChange]);

    const reset = useCallback(() => {
        if (!isControlled) setInternalValue("");
        onChange?.({target: {value: ""}, currentTarget: {value: ""}} as ChangeEvent<HTMLInputElement>);
        input.current?.focus();
    }, [isControlled, onChange]);

    return <div className={"bd-search-wrapper" + (className ? ` ${className}` : "")}>
        <input onChange={change} onKeyDown={onKeyDown} type="text" className="bd-search" placeholder={placeholder} maxLength={50} value={value} ref={input} />
        {!value && <SearchIcon size="18px" />}
        {value && <Button look={Button.Looks.BLANK} color={Button.Colors.TRANSPARENT} size={Button.Sizes.NONE} onClick={reset}><XIcon size="16px" /></Button>}
    </div>;

}
