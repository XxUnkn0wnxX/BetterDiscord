import config from "@stores/config";
import type {ChangelogProps} from "@ui/modals/changelog";

// fixed, improved, added, progress
export default {
    title: "BetterDiscord",
    subtitle: `v${config.get("version")}`,
    // https://youtu.be/BZq1eb9d0HI?si=67V2eArlF4atnGnz
    video: "https://www.youtube.com/embed/Qv1HUqqUgkg?si=67V2eArlF4atnGnz&vq=hd720p&hd=1&rel=0&showinfo=0&mute=0&loop=1&autohide=1",
    // banner: "https://i.imgur.com/wuh5yMK.png",
    blurb: "Upstream 1.14.2 changes with this fork's older-runtime compatibility and recovery support.",
    changes: [
        {
            type: "added",
            title: "New Settings",
            items: [
                "Rounded Corners – Control rounded corners on frameless windows where supported",
                "Accept First Mouse Click – Allow clicking through to an inactive macOS window",
                "Vibrancy and Visual Effect State – Control macOS window materials and their active appearance",
                "Background Material – Set the system-drawn Windows background material where supported"
            ]
        },
        {
            type: "progress",
            title: "Removed Settings",
            items: [
                "Recovery and Addon Store remain available as core features, without opt-out settings",
                "The obsolete In App Traffic Lights setting has been removed"
            ]
        },
        {
            type: "added",
            title: "Performance",
            items: [
                "Removed the targeted slow Discord CSS selector",
                "Shared plugin mutation observation now runs only while needed"
            ]
        },
        {
            type: "fixed",
            title: "Recovery and Compatibility",
            items: [
                "Includes upstream Windows/Linux reinjection improvements",
                "Preserves this fork's macOS recovery and OpenAsar handoff support",
                "Retains older-Electron compatibility and Theme Attributes toggle safety"
            ]
        },
        {
            type: "improved",
            title: "Disabled Plugins Stay Disabled",
            items: [
                "Plugins never run unless enabled"
            ]
        },
        {
            type: "added",
            title: "For Developers",
            items: [
                "Webpack now supports withKey, map, and mapDeclarations options; deprecated lookup helpers remain available",
                "BetterDiscord no longer calls plugin load() or metadata getters. Move initialization into supported startup code and provide metadata in headers",
                "Plugin observer() and onSwitch() remain supported but are deprecated",
                "Includes upstream plugin types, notification render support, and Modal/Checkbox components"
            ]
        }
    ]
} as ChangelogProps;
