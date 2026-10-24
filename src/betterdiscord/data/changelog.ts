import config from "@stores/config";
import type {ChangelogProps} from "@ui/modals/changelog";

// fixed, improved, added, progress
export default {
    title: "BetterDiscord",
    subtitle: `v${config.get("version")}`,
    // https://youtu.be/BZq1eb9d0HI?si=67V2eArlF4atnGnz
    video: "https://www.youtube.com/embed/Qv1HUqqUgkg?si=67V2eArlF4atnGnz&vq=hd720p&hd=1&rel=0&showinfo=0&mute=0&loop=1&autohide=1",
    // banner: "https://i.imgur.com/wuh5yMK.png",
    blurb: "Upstream 1.14.4 focus improvements with older-runtime support and this fork's custom reinjection retained.",
    changes: [
        {
            type: "fixed",
            title: "Modal and Floating Editor Focus",
            items: [
                "Adds modal accessibility attributes while preserving older-client focus fallbacks",
                "Coordinates floating editor focus with Discord's native focus locks where available"
            ]
        },
        {
            type: "improved",
            title: "Recovery Page",
            items: [
                "Includes upstream's revamped crash screen and patch-assisted suspected-plugin detection",
                "Retains this fork's extra report targets, Manual report and recovery safeguards"
            ]
        },
        {
            type: "improved",
            title: "Custom Reinjection Retained",
            items: [
                "Retains this fork's custom macOS reinjection, recovery, and OpenAsar handoff",
                "Keeps the existing wrappers and recovery behavior for pinned older Discord builds"
            ]
        },
        {
            type: "improved",
            title: "Fork Compatibility",
            items: [
                "Preserves editor autofocus, selection safeguards and Settings-close sequencing",
                "Keeps Store context-menu navigation, external addon updates and disabled-plugin behavior"
            ]
        },
        {
            type: "added",
            title: "For Developers",
            items: [
                "Adds generic typing to the existing BdApi.Webpack.getById module lookup",
                "BdApi.Utils.loadEntry retains its older-runtime compatibility fallback",
                "Optional helper examples and limitations are documented in docs/plugin-api-notes.md"
            ]
        }
    ]
} as ChangelogProps;
