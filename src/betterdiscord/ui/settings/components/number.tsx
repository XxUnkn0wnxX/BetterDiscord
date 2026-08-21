import React, {useCallback, type ChangeEvent} from "react";
import Button from "@ui/base/button";
import {Plus, Minus} from "lucide-react";
import {useItemProps, type BaseSettingProps} from "./utils";


interface BaseNumberInputProps {
    min?: number;
    max?: number;
    step?: number;
}

export type NumberInputProps = BaseNumberInputProps & BaseSettingProps<number>;

function coerceFiniteNumber(value: number | string) {
    if (typeof value === "string" && value.trim() === "") return;

    const numericValue = globalThis.Number(value);
    return globalThis.Number.isFinite(numericValue) ? numericValue : undefined;
}

export default function Number(props: NumberInputProps) {
    const {min, max, step = 1} = props;
    const {state, setState, disabled} = useItemProps<number>(props);

    const change = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const nextValue = e.currentTarget.valueAsNumber;
        if (!globalThis.Number.isFinite(nextValue)) {
            e.currentTarget.value = String(state);
            return;
        }

        setState(nextValue);
    }, [setState, state]);

    const increment = useCallback(() => {
        const currentValue = coerceFiniteNumber(state);
        if (currentValue === undefined) return;

        const incrementedValue = currentValue + step;
        if (max !== undefined && incrementedValue > max) return;

        setState(incrementedValue);
    }, [max, setState, state, step]);

    const decrement = useCallback(() => {
        const currentValue = coerceFiniteNumber(state);
        if (currentValue === undefined) return;

        const decrementedValue = currentValue - step;
        if (min !== undefined && decrementedValue < min) return;

        setState(decrementedValue);
    }, [min, setState, state, step]);

    return <div className={`bd-number-input-wrapper${disabled ? " bd-number-input-disabled" : ""}`}>
        <Button size={Button.Sizes.ICON} look={Button.Looks.FILLED} color={Button.Colors.PRIMARY} className="bd-number-input-decrement" onClick={decrement} disabled={disabled}><Minus size="24px" /></Button>
        <input onChange={change} type="number" className="bd-number-input" min={min} max={max} step={step} value={state} disabled={disabled} />
        <Button size={Button.Sizes.ICON} look={Button.Looks.FILLED} color={Button.Colors.PRIMARY} className="bd-number-input-increment" onClick={increment} disabled={disabled}><Plus size="24px" /></Button>
    </div>;
}
