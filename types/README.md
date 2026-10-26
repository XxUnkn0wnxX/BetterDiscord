# @betterdiscord/types

TypeScript type definitions for the
[BetterDiscord fork](https://github.com/XxUnkn0wnxX/BetterDiscord) plugin API
(`BdApi`).

Generated from BetterDiscord source, these types describe the global `BdApi`
object, the `window.BdApi` augmentation, and the `BetterDiscord` namespace.

## Installation

```sh
npm install --save-dev @betterdiscord/types
```

The package includes `@types/react`, `@types/react-dom`, and
`@types/react-reconciler` as dependencies.

## Usage

Add the package to `tsconfig.json` to load the types globally:

```jsonc
{
    "compilerOptions": {
        "types": ["@betterdiscord/types"]
    }
}
```

Or reference them directly from a source file:

```ts
/// <reference types="@betterdiscord/types" />
```

After referencing the package, `BdApi` and `BetterDiscord` are available
globally with full type information:

```ts
const { Webpack, Patcher } = new BdApi("MyPlugin");
```

## Versioning

This package is versioned independently from BetterDiscord. Type changes follow
semver for the API shape, not the BetterDiscord release version.

## License

[Apache-2.0](https://github.com/XxUnkn0wnxX/BetterDiscord/blob/develop/LICENSE.md)
