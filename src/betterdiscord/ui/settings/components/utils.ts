import {useSettingsContext} from "@ui/contexts";
import {useCallbackRef} from "@ui/hooks";
import {useState} from "react";

export type BaseSettingProps<T> = ({
    value: T;
    defaultValue?: never;
} | {
    value?: never;
    defaultValue: T;
}) & {
    onChange?(value: T): void;
    disabled?: boolean;
};

interface HandledValue<T, V> {
    disabled: boolean | undefined;
    state: T;
    original: T;
    setState(value: V, stateOnly?: boolean): void;
}

export function useItemProps<T, V extends any = T>(props: BaseSettingProps<T>, convertValue: (newValue: V, currentValue: T) => T = (value) => value as unknown as T): HandledValue<T, V> {
    const context = useSettingsContext<T>();
    const [usesDefaultValue] = useState(() => !("value" in props));
    const [internalState, setInternalState] = useState(() => (usesDefaultValue ? props.defaultValue : props.value) as T);
    const [original] = useState(() => (context.fail ? usesDefaultValue ? props.defaultValue : props.value : context.value) as T);

    const hasContext = !context.fail;
    const state = (hasContext ? context.value : usesDefaultValue ? internalState : props.value) as T;
    const disabled = context.disabled || props.disabled;

    const change = useCallbackRef<HandledValue<T, V>["setState"]>((value, stateOnly) => {
        if (context.disabled || props.disabled) return;

        const currentValue = (hasContext ? context.value : usesDefaultValue ? internalState : props.value) as T;
        const nextValue = convertValue(value, currentValue);

        if (!stateOnly) props.onChange?.(nextValue);
        if (usesDefaultValue) setInternalState(nextValue);
    });

    return {
        original,
        state,
        disabled,
        setState: change
    };
}
