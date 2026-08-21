import React, {useCallback, useMemo, useRef, type MouseEvent} from "react";
import {useItemProps, type BaseSettingProps} from "./utils";

export interface SliderMarker {
    value: number;
    label: string;
}

interface BaseSliderProps {
    min: number;
    max: number;
    step?: number;
    units?: string;
    markers?: Array<number | SliderMarker>;
}

export type SliderProps = BaseSliderProps & BaseSettingProps<number>;

export default function Slider(props: SliderProps) {
    const {min, max, step, units = "", markers = []} = props;
    const {state, setState, disabled} = useItemProps<number>(props);
    const inputRef = useRef<HTMLInputElement>(null);

    const setFiniteValue = useCallback((newValue: number) => {
        if (disabled || !Number.isFinite(newValue)) return;
        setState(newValue);
    }, [disabled, setState]);

    const change = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFiniteValue(event.currentTarget.valueAsNumber);
    }, [setFiniteValue]);

    const percent = useCallback((val: number) => {
        return (val - min) * 100 / (max - min);
    }, [min, max]);

    const labelOffset = useMemo(() => {
        const slope = (-62.5 - -25) / (max - min);
        const offset = (state * slope) + -25;
        if (offset < -62.5) return -62.5;
        return offset;
    }, [state, min, max]);

    const trackClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (disabled) return;

        const bounds = e.currentTarget.getBoundingClientRect();
        const offsetX = e.clientX - bounds.left;
        const offsetPercent = (offsetX / bounds.width);
        const newValue = (offsetPercent * (max - min)) + min;
        if (!Number.isFinite(newValue) || !inputRef.current) return;

        inputRef.current.value = newValue.toString();
        setFiniteValue(inputRef.current.valueAsNumber);

    }, [disabled, max, min, setFiniteValue]);

    return <div className={`bd-slider-wrap ${disabled ? "bd-slider-disabled" : ""} ${markers.length > 0 ? "bd-slider-markers" : ""}`}>
        <input onChange={change} type="range" className="bd-slider-input" min={min} max={max} step={step} value={state} disabled={disabled} ref={inputRef} />
        <div className="bd-slider-label" style={{left: `${percent(state)}%`, transform: `translateX(${labelOffset}%)`}}>{state}{units}</div>
        <div className="bd-slider-track" style={{backgroundSize: percent(state) + "% 100%"}} onClick={trackClick}></div>
        {markers?.length > 0 && <div className="bd-slider-marker-container">
            {markers.map(m => {
                const markerValue = typeof m === "number" ? m : m.value;
                const markerLabel = typeof m === "number" ? m : m?.label;
                const showUnits = units && typeof m === "number";
                return <div key={`${markerValue}-${markerLabel}`} className="bd-slider-marker" style={{left: percent(markerValue) + "%"}} onClick={() => setFiniteValue(markerValue)}>
                    {markerLabel}{showUnits && units}
                </div>;
            })}
        </div>}
    </div>;
}



/*
 * label offset left:
 *
 * value - min
 * -----------   x 100
 *  max - min
 */
