# Optional BetterDiscord Plugin APIs

Quick notes for optional APIs that can simplify plugin code. These notes track
plugin-facing helpers separately from the fork's implementation contracts.
Availability below refers to the current repository branches, not a version
number guess.

| API | Availability in this checkout | What it is for |
| --- | --- | --- |
| `BdApi.Utils.loadEntry` | Present on `develop`; this fork includes an internal compatibility fallback for older runtimes. | Load entry modules referenced by a discovered lazy Webpack loader. |
| `BdApi.Webpack.Filters.byDestructure` | Present on `develop` from the 1.14.3 adaptation. Focused source/API checks pass; native pinned-client matching remains a runtime check. | Find exported functions whose source contains a matching destructuring assignment. |

## `BdApi.Webpack.Filters.byDestructure`

This filter accepts one or more property names and returns a predicate for
`BdApi.Webpack.getModule` or related Webpack searches. The [reviewed upstream
implementation](https://github.com/BetterDiscord/BetterDiscord/blob/3eafabae8c4ccc28aeb2ff97239f757ee87cbe17/src/betterdiscord/webpack/filter.ts)
checks function source for `}=` groups, takes the nearest
preceding `{`, splits the group on commas and `:`/`=`, and checks that every
requested name appears in the same group.

For example, a function containing `({channelId: c, guildId: g}=props)` can
match both names:

```js
const {Filters, getModule} = BdApi.Webpack;
if (typeof Filters.byDestructure === "function") {
    const filter = Filters.byDestructure("channelId", "guildId");
    const matchedExport = getModule(filter, {searchExports: true});
    // Inspect matchedExport before using it; these property names are illustrative.
}
```

This is a source-text heuristic, not a JavaScript parser. It does not match
ordinary function-parameter destructuring such as `function ({channelId}) {}`;
the source must contain the implementation's `}=` marker. Formatting and
minification can affect the result. Use it as a convenient search filter, then
check that the returned export has the behavior your plugin needs.

The implementation uses ordinary JavaScript string and array operations; it
does not depend on `Map.prototype.getOrInsertComputed` or browser/Electron
APIs. Its operations are already available to the fork's older Electron targets;
no new engine fallback is needed. Focused checks exercise the upstream matching
semantics and public API on pinned Bun 1.1.20. They do not prove a particular
Discord bundle contains a matching function: verify the source shape on the
client your plugin targets, and handle an absent match.

## `BdApi.Utils.loadEntry`

The fork exposes this helper in [`BdApi.Utils`](../src/betterdiscord/api/utils.ts)
and implements it in [`webpack/lazy.ts`](../src/betterdiscord/webpack/lazy.ts).
`loadEntry(loader)` takes a function or source string for an actual discovered
lazy Webpack loader. It recognizes the supported `Promise.all([...]).then(...)`
chunk-loader shape, loads eligible chunks, and returns an array of entry
module exports. It is not a general URL importer, a chunk-ID lookup, or a
replacement for discovering the loader in the current Discord build.

Pass a loader found through a verified Webpack query; do not copy an example
module ID and assume it is stable across Discord builds. Keep loading on a
plugin action or setup path where appropriate, rather than repeating it during
every render:

```js
async function loadFeatureEntries(discoveredLoader) {
    if (typeof BdApi.Utils.loadEntry !== "function") return [];
    if (typeof discoveredLoader !== "function") return [];

    try {
        const entries = await BdApi.Utils.loadEntry(discoveredLoader);
        if (entries === null || entries.length === 0) return [];
        return entries;
    }
    catch (error) {
        console.error("Could not load the feature entries", error);
        return [];
    }
}
```

`null` means the input was empty or its source did not match a supported lazy
loader pattern. An empty array means no entry exports were loaded. Chunk or
module loading can reject, so callers should handle errors. The helper skips
chunk files identified as workers and caches its worker check internally.

This fork keeps the public helper's upstream input and result contract while
choosing `Map.prototype.getOrInsertComputed` by capability and using a private
fallback when it is unavailable. That adaptation does not patch `Map.prototype`
or add a plugin-facing alternate API.

`BdApi.Utils.loadEntry` is unrelated to the removed legacy plugin-instance
`load()` lifecycle callback. A plugin should use the lifecycle contract
supported by its BetterDiscord host; the shared word “load” does not make these
APIs interchangeable.

## Keeping these notes current

When reviewing another optional upstream plugin API, add its purpose, a small
verified example, and its exact branch availability here. Update pending
compatibility status only after checking the implementation and relevant
supported clients. Keep this as a plugin-development quick reference, not a
second fork-contract ledger.
