const sourcePrefix = "betterdiscord://betterdiscord/webpack-modules/patched/";
const sourcePath = "/webpack-modules/patched/";

export interface WebpackSourceLocation {
    url: string;
    line: number;
    column: number;
}

/** Parse upstream source links without allowing a normalized URL to leave their namespace. */
export function parseWebpackSourceLink(value: unknown): WebpackSourceLocation | null {
    if (typeof value !== "string" || !value.startsWith(sourcePrefix)) return null;

    let url: URL;
    try {url = new URL(value);}
    catch {return null;}

    if (url.protocol !== "betterdiscord:" || url.host !== "betterdiscord"
        || !url.pathname.startsWith(sourcePath) || url.pathname.length === sourcePath.length) return null;

    const hash = url.hash.slice(1).split(":", 2);
    const [lineRaw, columnRaw] = hash.length === 2
        ? hash
        : [url.searchParams.get("line") || "", url.searchParams.get("column") || ""];

    const coordinate = (raw: string) => {
        const parsed = parseInt(raw, 10);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    };

    url.search = "";
    url.hash = "";
    return {url: url.href, line: coordinate(lineRaw), column: coordinate(columnRaw)};
}
