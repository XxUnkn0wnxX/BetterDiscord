import config from "@stores/config";
import type {ChangelogProps} from "@ui/modals/changelog";

// fixed, improved, added, progress
export default {
    title: "BetterDiscord",
    subtitle: `v${config.get("version")}`,
    // https://youtu.be/BZq1eb9d0HI?si=67V2eArlF4atnGnz
    video: "https://www.youtube.com/embed/Qv1HUqqUgkg?si=67V2eArlF4atnGnz&vq=hd720p&hd=1&rel=0&showinfo=0&mute=0&loop=1&autohide=1",
    // banner: "https://i.imgur.com/wuh5yMK.png",
    blurb: "Upstream 1.14.3 fixes with older-runtime support and this fork's custom reinjection retained.",
    changes: [
        {
            type: "fixed",
            title: "Modal Inputs and Transparency",
            items: [
                "Uses upstream's modal focus scope where available, with a compatibility fallback for older Discord builds",
                "Preserves transparent window backgrounds when switching accounts"
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
                "The upstream recovery-page correction is already included in this fork",
                "Preserves Store context-menu navigation, editor focus, and disabled-plugin behavior"
            ]
        },
        {
            type: "added",
            title: "For Developers",
            items: [
                "Adds BdApi.Webpack.Filters.byDestructure for matching functions by destructured property names",
                "BdApi.Utils.loadEntry retains its older-runtime compatibility fallback",
                "Optional helper examples and limitations are documented in docs/plugin-api-notes.md"
            ]
        }
    ]
} as ChangelogProps;
