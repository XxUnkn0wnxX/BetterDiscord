import React from "react";

// Geometry is adapted to JSX attributes from Forgejo v16.0.6's official logo:
// https://code.forgejo.org/forgejo/forgejo/raw/tag/v16.0.6/assets/logo.svg
// Created by Caesar Schinas; licensed under CC BY-SA 4.0. Attribution exemption
// granted to the Forgejo project does not apply to this BetterDiscord use.
export default function ForgejoIcon({size = 24}: {size?: number;}) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 212 212"
            role="img"
            aria-hidden="true"
            focusable="false"
            data-forgejo-icon="true"
        >
            <metadata>
                Forgejo logo by Caesar Schinas (https://caesarschinas.com/). CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/.
                Adapted to JSX presentation attributes; original geometry and colours retained.
                Source geometry: https://code.forgejo.org/forgejo/forgejo/raw/tag/v16.0.6/assets/logo.svg.
            </metadata>
            <g transform="translate(6,6)" fill="none">
                <path d="M58 168 v-98 a50 50 0 0 1 50-50 h20" stroke="#ff6600" strokeWidth={25}/>
                <path d="M58 168 v-30 a50 50 0 0 1 50-50 h20" stroke="#d40000" strokeWidth={25}/>
                <circle cx={142} cy={20} r={18} stroke="#ff6600" strokeWidth={15}/>
                <circle cx={142} cy={88} r={18} stroke="#d40000" strokeWidth={15}/>
                <circle cx={58} cy={180} r={18} stroke="#d40000" strokeWidth={15}/>
            </g>
        </svg>
    );
}
