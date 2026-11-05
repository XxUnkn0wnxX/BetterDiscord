import config from "@stores/config";
import type {ChangelogProps} from "@ui/modals/changelog";

// fixed, improved, added, progress
export default {
    title: "BetterDiscord",
    subtitle: `v${config.get("version")}`,
    // https://youtu.be/BZq1eb9d0HI?si=67V2eArlF4atnGnz
    video: "https://www.youtube.com/embed/Qv1HUqqUgkg?si=67V2eArlF4atnGnz&vq=hd720p&hd=1&rel=0&showinfo=0&mute=0&loop=1&autohide=1",
    // banner: "https://i.imgur.com/wuh5yMK.png",
    blurb: "BetterDiscord 1.14.5 with Rspack compatibility and this fork's older-runtime safeguards.",
    changes: [
        {
            type: "fixed",
            title: "Rspack Compatibility",
            items: [
                "Includes upstream's fix for the new Rspack export format",
                "Uses upstream's getter/setter fix with writable exports and getter patch/unpatch support"
            ]
        },
        {
            type: "improved",
            title: "Recovery and Modal Improvements",
            items: [
                "Includes the previously integrated React error decoder and shared modal padding fix",
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
            type: "improved",
            title: "Updated Translations",
            items: [
                "Includes the previously integrated Crowdin translation refresh",
                "Translations are maintained at https://translate.betterdiscord.app/"
            ]
        }
    ]
} as ChangelogProps;
