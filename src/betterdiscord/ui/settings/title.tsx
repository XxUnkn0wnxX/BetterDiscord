import React, {type MouseEvent, type PropsWithChildren} from "react";

import Button from "../base/button";

const {useCallback, useLayoutEffect} = React;


const basicClass = "bd-settings-title";
const groupClass = "bd-settings-title bd-settings-group-title";

export type SettingsTitleProps = PropsWithChildren<{
    isGroup?: boolean;
    className?: string;
    button?: {title: string; onClick(e: MouseEvent): void;};
    onClick?(): void;
    text?: React.ReactNode;
}>;

export interface SettingsTitlePublisherProps {
    publish(value: React.ReactNode): unknown;
    title: React.ReactElement<SettingsTitleProps>;
}

export function SettingsTitlePublisher({publish, title}: SettingsTitlePublisherProps) {
    // Settings titles render in a separate retained root. Publish only after
    // this owner commits so a remount cannot leave the previous callbacks alive.
    useLayoutEffect(() => {
        publish(title);
    }, [publish, title]);

    return null;
}

export default function SettingsTitle({isGroup = false, className = "", button = undefined, onClick = undefined, text, children = []}: SettingsTitleProps) {
    const click = useCallback((event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
        button?.onClick?.(event);
    }, [button]);


    const baseClass = isGroup ? groupClass : basicClass;
    const titleClass = className ? `${baseClass} ${className}` : baseClass;
    return <h2 className={titleClass} onClick={() => {onClick?.();}}>
        {text}
        {button && <Button className="bd-button-title" onClick={click} size={Button.Sizes.NONE}>{button.title}</Button>}
        {children}
    </h2>;

}
