/** Select the chunk queue used by Discord, preserving an already installed runtime. */
export default function getDiscordChunkGlobal() {
    return (window.rspackChunkdiscord_app ||= window.webpackChunkdiscord_app ||= []);
}
