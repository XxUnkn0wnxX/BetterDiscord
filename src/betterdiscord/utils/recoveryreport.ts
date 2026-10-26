export type RecoveryReportSource = {
    provider: "github" | "forgejo" | "gitlab";
    repoUrl: string;
};

const REPORT_HOSTS = new Map<string, RecoveryReportSource["provider"]>([
    ["github.com", "github"],
    ["www.github.com", "github"],
    ["raw.githubusercontent.com", "github"],
    ["git.slowb.ro", "forgejo"],
    ["gitlab.com", "gitlab"]
]);

// eslint-disable-next-line no-control-regex -- Source URLs must reject control characters before parsing.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;
const SAFE_PATH_PART = /^[\p{L}\p{N}._-]+$/u;
const SOURCE_PROTOCOLS = new Set(["https:", "http:", "git:", "git+https:"]);

function hasDotSegment(source: string): boolean {
    const path = source.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i)?.[1] ?? "";
    return path.split("/").some(segment => {
        try {
            const decoded = decodeURIComponent(segment);
            return decoded === "." || decoded === "..";
        }
        catch {
            return true;
        }
    });
}

/** Parse only known source-host URLs into a safe canonical repository URL. */
export function getRecoveryReportSource(source: unknown): RecoveryReportSource | null {
    if (typeof source !== "string" || !source || source.includes("\\") || CONTROL_CHARACTERS.test(source) || ENCODED_SEPARATOR.test(source) || hasDotSegment(source)) return null;

    try {
        // Check the original scheme and port before building the HTTPS target.
        // In particular, git://host:443 is not a default-port HTTPS source.
        const url = new URL(source);
        const authority = source.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
        if (!authority || !SOURCE_PROTOCOLS.has(url.protocol) || authority.includes("@") || url.username || url.password || url.port) return null;

        const provider = REPORT_HOSTS.get(url.hostname.toLowerCase());
        if (!provider) return null;

        if (provider === "gitlab") {
            // GitLab supports arbitrarily nested groups. Its `/-/` delimiter
            // separates project source routes from the repository path.
            const pathParts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
            const sourceRoute = pathParts.indexOf("-");
            const repositoryParts = sourceRoute === -1 ? pathParts : pathParts.slice(0, sourceRoute);
            if (sourceRoute === 0 || repositoryParts.length < 2) return null;

            const projectIndex = repositoryParts.length - 1;
            const project = repositoryParts[projectIndex].replace(/\.git$/i, "");
            repositoryParts[projectIndex] = project;
            if (repositoryParts.some(part => !part || !SAFE_PATH_PART.test(part) || part === "." || part === "..")) return null;

            return {provider, repoUrl: `https://gitlab.com/${repositoryParts.join("/")}`};
        }

        const [rawOwner, rawRepo] = url.pathname.split("/").filter(Boolean);
        if (!rawOwner || !rawRepo) return null;

        const owner = decodeURIComponent(rawOwner);
        const repo = decodeURIComponent(rawRepo).replace(/\.git$/i, "");
        if (!owner || !repo || !SAFE_PATH_PART.test(owner) || !SAFE_PATH_PART.test(repo) || owner === "." || owner === ".." || repo === "." || repo === "..") return null;

        const host = provider === "github" ? "github.com" : "git.slowb.ro";
        return {provider, repoUrl: `https://${host}/${owner}/${repo}`};
    }
    catch {
        return null;
    }
}
