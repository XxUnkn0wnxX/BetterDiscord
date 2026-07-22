/**
 * Pure URL classification and normalization for plugin/theme update sources.
 *
 * This module deliberately performs no network requests. Direct file URLs can
 * be fetched as-is, while multi-file containers (gists and snippets) return a
 * descriptor that the updater must resolve through the provider API. Callers
 * must still validate the downloaded addon's type, metadata, identity and
 * version before offering or installing it.
 */

export type AddonUpdateProvider =
    | "github"
    | "github-gist"
    | "gitlab"
    | "gitlab-snippet"
    | "gitea-forgejo"
    | "bitbucket-cloud"
    | "bitbucket-server"
    | "bitbucket-snippet"
    | "azure-devops"
    | "sourcehut"
    | "pastebin"
    | "dpaste"
    | "pastes-io"
    | "hastebin"
    | "generic";

export type AddonUpdateIdentityConfidence = "high" | "medium" | "low" | "none";

export type AddonUpdateDescriptorKind = "github-gist" | "gitlab-snippet" | "bitbucket-snippet";

export interface AddonUpdateDescriptor {
    kind: AddonUpdateDescriptorKind;
    /** Provider-specific metadata endpoint used to resolve a file; it is not addon source. */
    apiUrl: string;
    /** Expected installed filename, when the caller knows it. */
    expectedFilename: string | null;
    /**
     * Consumers must select the exact expected filename. Without one, they may
     * select only when the response contains exactly one plugin/theme file.
     */
    selection: "exact-filename-or-single-addon";
    /**
     * Some GitLab versions expose a legacy single file only through top-level
     * metadata. This fallback is safe only when the normal selection rule
     * accepts that one filename; it must never choose among multiple files.
     */
    metadataFallback: {
        filenameField: "file_name";
        rawUrlField: "raw_url";
    } | null;
}

export interface NormalizedAddonUpdateUrl {
    valid: true;
    /** Parsed HTTPS URL with its fragment removed. */
    originalUrl: string;
    /** Direct addon URL. Null means the descriptor must be resolved first. */
    fetchUrl: string | null;
    provider: AddonUpdateProvider;
    /** Canonical repository identity when the URL proves one. */
    repositoryIdentity: string | null;
    identityConfidence: AddonUpdateIdentityConfidence;
    resolution: "direct" | "descriptor";
    descriptor: AddonUpdateDescriptor | null;
}

export type AddonUpdateUrlRejectionReason =
    | "invalid-url"
    | "https-required"
    | "credentials-not-allowed"
    | "encrypted-paste-unsupported"
    | "unsupported-page";

export interface RejectedAddonUpdateUrl {
    valid: false;
    reason: AddonUpdateUrlRejectionReason;
}

export type AddonUpdateUrlResult = NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl;

export interface AddonUpdateUrlNormalizerOptions {
    expectedFilename?: string;
    /** Additional trusted GitHub Enterprise hosts using GitHub's /blob/ grammar. */
    githubHosts?: readonly string[];
    /** Additional older GitLab hosts using /blob/ without the modern /-/ sentinel. */
    gitlabHosts?: readonly string[];
    /** Additional maintained Hastebin-compatible hosts using /raw/{key}. */
    hastebinHosts?: readonly string[];
    /** Additional PrivateBin/ZeroBin hosts whose client-side encrypted pages must be rejected. */
    encryptedPasteHosts?: readonly string[];
}

export interface AddonRepositoryIdentity {
    repositoryIdentity: string;
    identityConfidence: AddonUpdateIdentityConfidence;
}

const DEFAULT_GITHUB_HOSTS = ["github.com"] as const;
const DEFAULT_GITLAB_HOSTS = ["gitlab.com"] as const;
const DEFAULT_GITEA_FORGEJO_HOSTS = ["codeberg.org", "gitea.com", "git.slowb.ro"] as const;
const DEFAULT_HASTEBIN_HOSTS = ["hastebin.com", "hasteb.in", "paste.pythondiscord.com"] as const;
const DEFAULT_ENCRYPTED_PASTE_HOSTS = ["privatebin.net", "privatebin.info", "privatebin.pw", "zerobin.net"] as const;

const ADDON_FILE_PATTERN = /\.(?:plugin\.js|theme\.css)$/i;
const NUMERIC_ID_PATTERN = /^\d+$/;
const SIMPLE_PASTE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const GITEA_REFERENCE_KINDS = new Set(["branch", "tag", "commit"]);
const AZURE_API_CONTROL_QUERY_KEYS = new Set([
    "_a",
    "path",
    "version",
    "versiondescriptor.version",
    "versiondescriptor.versiontype",
    "versiondescriptor.versionoptions",
    "download",
    "includecontent",
    "$format",
    "api-version"
]);

interface ParsedUrl {
    originalUrl: string;
    url: URL;
}

function parseSecureUrl(input: string): ParsedUrl | RejectedAddonUpdateUrl {
    const trimmed = input.trim();
    let url: URL;

    try {
        url = new URL(trimmed);
    }
    catch {
        return {valid: false, reason: "invalid-url"};
    }

    if (url.protocol !== "https:") return {valid: false, reason: "https-required"};
    if (url.username || url.password) return {valid: false, reason: "credentials-not-allowed"};

    url.hash = "";
    return {originalUrl: url.toString(), url};
}

function hostSet(defaults: readonly string[], additions: readonly string[] | undefined): Set<string> {
    const hosts = new Set<string>();
    for (const host of defaults) hosts.add(host.toLowerCase());
    if (additions) {
        for (const host of additions) hosts.add(host.toLowerCase());
    }
    return hosts;
}

function pathSegments(url: URL): string[] {
    return url.pathname.split("/").filter(Boolean);
}

function replacePathSegment(url: URL, index: number, replacement: string): URL {
    const normalized = new URL(url.toString());
    const segments = normalized.pathname.split("/");
    let found = -1;

    for (let i = 0; i < segments.length; i++) {
        if (!segments[i]) continue;
        found++;
        if (found !== index) continue;
        segments[i] = replacement;
        break;
    }

    normalized.pathname = segments.join("/");
    return normalized;
}

function urlAtPath(source: URL, origin: string, pathname: string): URL {
    const target = new URL(pathname, origin);
    target.search = source.search;
    return target;
}

function repositoryIdentity(hostname: string, segments: readonly string[]): string | null {
    if (segments.length === 0) return null;

    const normalized = [...segments];
    const lastIndex = normalized.length - 1;
    normalized[lastIndex] = normalized[lastIndex].replace(/\.git$/i, "");
    if (!normalized[lastIndex]) return null;

    return `${hostname.toLowerCase()}/${normalized.join("/").toLowerCase()}`;
}

function isKnownEncryptedPaste(url: URL, configuredHosts: ReadonlySet<string>): boolean {
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (configuredHosts.has(host)) return true;
    if (/(?:^|[.-])(?:privatebin|zerobin)(?:[.-]|$)/i.test(host)) return true;

    return pathSegments(url).some(segment => /^(?:privatebin|zerobin)$/i.test(segment));
}

function singleQueryValue(url: URL, key: string): string | null {
    let result: string | null = null;
    for (const [candidateKey, value] of url.searchParams) {
        if (candidateKey.toLowerCase() !== key.toLowerCase()) continue;
        if (result !== null) return null;
        result = value;
    }
    return result;
}

function isSafeQueryPart(value: string, maxLength: number): boolean {
    if (value.length > maxLength) return false;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return false;
    }
    return true;
}

function parseAzureVersion(value: string): {version: string; type: "branch" | "tag" | "commit";} | null {
    if (value.length < 3 || value.length > 1026 || !isSafeQueryPart(value, 1026)) return null;

    const prefix = value.slice(0, 2);
    const version = value.slice(2);
    if (!version || !isSafeQueryPart(version, 1024)) return null;
    if (prefix === "GC" && !/^[A-Fa-f0-9]{7,64}$/.test(version)) return null;
    if (prefix === "GB") return {version, type: "branch"};
    if (prefix === "GT") return {version, type: "tag"};
    if (prefix === "GC") return {version, type: "commit"};
    return null;
}

function addPreservedAzureQuery(source: URL, target: URL): void {
    for (const [key, value] of source.searchParams) {
        if (AZURE_API_CONTROL_QUERY_KEYS.has(key.toLowerCase())) continue;
        if (!isSafeQueryPart(key, 128) || !isSafeQueryPart(value, 4096)) continue;
        target.searchParams.append(key, value);
    }
}

function direct(
    parsed: ParsedUrl,
    fetchUrl: URL,
    provider: AddonUpdateProvider,
    identity: string | null = null,
    confidence: AddonUpdateIdentityConfidence = identity ? "high" : "none"
): NormalizedAddonUpdateUrl {
    return {
        valid: true,
        originalUrl: parsed.originalUrl,
        fetchUrl: fetchUrl.toString(),
        provider,
        repositoryIdentity: identity,
        identityConfidence: confidence,
        resolution: "direct",
        descriptor: null
    };
}

function descriptor(
    parsed: ParsedUrl,
    provider: "github-gist" | "gitlab-snippet" | "bitbucket-snippet",
    kind: AddonUpdateDescriptorKind,
    apiUrl: URL,
    expectedFilename: string | undefined,
    metadataFallback: AddonUpdateDescriptor["metadataFallback"] = null
): NormalizedAddonUpdateUrl {
    return {
        valid: true,
        originalUrl: parsed.originalUrl,
        fetchUrl: null,
        provider,
        repositoryIdentity: null,
        identityConfidence: "none",
        resolution: "descriptor",
        descriptor: {
            kind,
            apiUrl: apiUrl.toString(),
            expectedFilename: expectedFilename ?? null,
            selection: "exact-filename-or-single-addon",
            metadataFallback
        }
    };
}

function findSequence(segments: readonly string[], sequence: readonly string[]): number {
    for (let i = 0; i <= segments.length - sequence.length; i++) {
        let matches = true;
        for (let j = 0; j < sequence.length; j++) {
            if (segments[i + j] !== sequence[j]) {
                matches = false;
                break;
            }
        }
        if (matches) return i;
    }
    return -1;
}

function githubGistResult(parsed: ParsedUrl, expectedFilename: string | undefined): NormalizedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    const segments = pathSegments(url);

    if (host === "gist.githubusercontent.com") {
        if (segments.length < 4 || segments[2] !== "raw") return null;
        return direct(parsed, url, "github-gist");
    }

    if (host !== "gist.github.com" || segments.length < 2) return null;

    const rawIndex = segments.indexOf("raw", 2);
    if (rawIndex !== -1) return direct(parsed, url, "github-gist");

    const gistId = segments[1];
    if (!/^[A-Fa-f0-9]+$/.test(gistId)) return null;

    const apiUrl = urlAtPath(url, "https://api.github.com", `/gists/${gistId}`);
    return descriptor(parsed, "github-gist", "github-gist", apiUrl, expectedFilename);
}

function gitlabSnippetResult(
    parsed: ParsedUrl,
    expectedFilename: string | undefined,
    gitlabHosts: ReadonlySet<string>
): NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl | null {
    const {url} = parsed;
    if (!gitlabHosts.has(url.hostname.toLowerCase())) return null;

    const segments = pathSegments(url);
    let markerIndex = findSequence(segments, ["-", "snippets"]);
    let idIndex = markerIndex === -1 ? -1 : markerIndex + 2;
    let projectSegments = markerIndex === -1 ? [] : segments.slice(0, markerIndex);

    if (markerIndex === -1 && segments[0] === "snippets") {
        markerIndex = 0;
        idIndex = 1;
        projectSegments = [];
    }

    if (idIndex === -1) return null;
    if (!NUMERIC_ID_PATTERN.test(segments[idIndex] ?? "")) return {valid: false, reason: "unsupported-page"};

    const snippetId = segments[idIndex];
    if (segments[idIndex + 1] === "raw") return direct(parsed, url, "gitlab-snippet");
    if (segments.length !== idIndex + 1) return {valid: false, reason: "unsupported-page"};

    let apiPath: string;
    if (projectSegments.length > 0) {
        // Joining already-encoded path segments avoids decoding and rebuilding
        // user-provided namespace components.
        const encodedProject = projectSegments.join("%2F");
        apiPath = `/api/v4/projects/${encodedProject}/snippets/${snippetId}`;
    }
    else {
        apiPath = `/api/v4/snippets/${snippetId}`;
    }

    return descriptor(
        parsed,
        "gitlab-snippet",
        "gitlab-snippet",
        urlAtPath(url, url.origin, apiPath),
        expectedFilename,
        {filenameField: "file_name", rawUrlField: "raw_url"}
    );
}

function bitbucketSnippetResult(
    parsed: ParsedUrl,
    expectedFilename: string | undefined
): NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    const segments = pathSegments(url);

    if (host === "api.bitbucket.org") {
        if (segments[0] !== "2.0" || segments[1] !== "snippets") return null;
        if (segments.length < 4) return {valid: false, reason: "unsupported-page"};
        if (segments.length === 4) {
            return descriptor(parsed, "bitbucket-snippet", "bitbucket-snippet", url, expectedFilename);
        }

        // The API exposes both current-HEAD and revision-pinned raw file routes.
        if (segments.length >= 6 && segments[4] === "files") return direct(parsed, url, "bitbucket-snippet");
        if (segments.length >= 7 && segments[5] === "files") return direct(parsed, url, "bitbucket-snippet");
        return {valid: false, reason: "unsupported-page"};
    }

    if (host !== "bitbucket.org" || segments[0] !== "snippets" || segments.length < 3) return null;

    const workspace = segments[1];
    const snippetId = segments[2];
    const apiUrl = urlAtPath(url, "https://api.bitbucket.org", `/2.0/snippets/${workspace}/${snippetId}`);
    return descriptor(parsed, "bitbucket-snippet", "bitbucket-snippet", apiUrl, expectedFilename);
}

function githubResult(
    parsed: ParsedUrl,
    githubHosts: ReadonlySet<string>
): NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    const segments = pathSegments(url);

    if (host === "raw.githubusercontent.com") {
        const identity = segments.length >= 2 ? repositoryIdentity("github.com", segments.slice(0, 2)) : null;
        return direct(parsed, url, "github", identity);
    }

    if (host === "raw.githack.com" || host === "rawcdn.githack.com") {
        const identity = segments.length >= 2 ? repositoryIdentity("github.com", segments.slice(0, 2)) : null;
        return direct(parsed, url, "github", identity);
    }

    if (host === "cdn.jsdelivr.net" && segments[0] === "gh" && segments.length >= 3) {
        const repository = segments[2].split("@")[0];
        const identity = repositoryIdentity("github.com", [segments[1], repository]);
        return direct(parsed, url, "github", identity);
    }

    if (!githubHosts.has(host)) return null;

    // Owners and Enterprise path prefixes may themselves contain these words;
    // a GitHub file sentinel can occur only after at least owner/repository.
    const blobIndex = segments.indexOf("blob", 2);
    if (blobIndex >= 2 && segments.length > blobIndex + 2) {
        const identity = repositoryIdentity(host, segments.slice(0, blobIndex));
        return direct(parsed, replacePathSegment(url, blobIndex, "raw"), "github", identity);
    }

    const rawIndex = segments.indexOf("raw", 2);
    if (rawIndex >= 2 && segments.length > rawIndex + 2) {
        const identity = repositoryIdentity(host, segments.slice(0, rawIndex));
        return direct(parsed, url, "github", identity);
    }

    if (segments.length === 2 || segments.includes("tree")) {
        return {valid: false, reason: "unsupported-page"};
    }

    const identity = host === "github.com" && segments.length >= 2
        ? repositoryIdentity(host, segments.slice(0, 2))
        : null;
    return direct(parsed, url, "github", identity, identity ? "medium" : "none");
}

function gitlabResult(
    parsed: ParsedUrl,
    gitlabHosts: ReadonlySet<string>
): NormalizedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    const segments = pathSegments(url);
    const markerIndex = segments.indexOf("-");

    if (markerIndex > 0 && (segments[markerIndex + 1] === "blob" || segments[markerIndex + 1] === "raw")) {
        const identity = repositoryIdentity(host, segments.slice(0, markerIndex));
        if (segments[markerIndex + 1] === "raw") return direct(parsed, url, "gitlab", identity);
        return direct(parsed, replacePathSegment(url, markerIndex + 1, "raw"), "gitlab", identity);
    }

    if (!gitlabHosts.has(host)) return null;

    const blobIndex = segments.indexOf("blob");
    if (blobIndex > 0 && segments.length > blobIndex + 2) {
        const identity = repositoryIdentity(host, segments.slice(0, blobIndex));
        return direct(parsed, replacePathSegment(url, blobIndex, "raw"), "gitlab", identity);
    }

    const rawIndex = segments.indexOf("raw");
    if (rawIndex > 0 && segments.length > rawIndex + 2) {
        const identity = repositoryIdentity(host, segments.slice(0, rawIndex));
        return direct(parsed, url, "gitlab", identity);
    }

    return null;
}

function bitbucketResult(parsed: ParsedUrl): NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    const segments = pathSegments(url);

    if (host === "api.bitbucket.org") {
        if (segments[0] !== "2.0" || segments[1] !== "repositories") return null;
        if (segments.length < 7 || segments[4] !== "src") return {valid: false, reason: "unsupported-page"};
        const identity = repositoryIdentity("bitbucket.org", segments.slice(2, 4));
        return direct(parsed, url, "bitbucket-cloud", identity);
    }

    if (host !== "bitbucket.org" || segments.length < 2) return null;

    const identity = repositoryIdentity("bitbucket.org", segments.slice(0, 2));
    if (segments[2] === "src" && segments.length >= 5) {
        const apiUrl = urlAtPath(
            url,
            "https://api.bitbucket.org",
            `/2.0/repositories/${segments.slice(0, 2).join("/")}/${segments.slice(2).join("/")}`
        );
        return direct(parsed, apiUrl, "bitbucket-cloud", identity);
    }

    if (segments[2] === "raw" && segments.length >= 5) return direct(parsed, url, "bitbucket-cloud", identity);
    return null;
}

function bitbucketServerResult(parsed: ParsedUrl): NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl | null {
    const {url} = parsed;
    const segments = pathSegments(url);
    const isProjectRepository = segments[0] === "projects" && segments[2] === "repos";
    const isPersonalRepository = segments[0] === "users" && segments[2] === "repos";
    if (!isProjectRepository && !isPersonalRepository) return null;
    if (segments.length < 5 || !segments[1] || !segments[3]) return {valid: false, reason: "unsupported-page"};

    const action = segments[4];
    if (action !== "browse" && action !== "raw") return null;
    if (segments.length < 6) return {valid: false, reason: "unsupported-page"};

    const identity = repositoryIdentity(url.hostname, segments.slice(0, 4));
    if (action === "raw") return direct(parsed, url, "bitbucket-server", identity);
    return direct(parsed, replacePathSegment(url, 4, "raw"), "bitbucket-server", identity);
}

interface AzureRepositoryPath {
    apiPath: string;
    identity: string | null;
}

function azureRepositoryPath(url: URL, segments: readonly string[], directApi: boolean): AzureRepositoryPath | null {
    const host = url.hostname.toLowerCase();
    const lower = segments.map(segment => segment.toLowerCase());

    if (host === "dev.azure.com") {
        if (directApi) {
            if (segments.length !== 7
                || lower[2] !== "_apis"
                || lower[3] !== "git"
                || lower[4] !== "repositories"
                || lower[6] !== "items") return null;

            return {
                apiPath: url.pathname,
                identity: repositoryIdentity(host, [segments[0], segments[1], segments[5]])
            };
        }

        if (segments.length !== 4 || lower[2] !== "_git") return null;
        return {
            apiPath: `/${segments[0]}/${segments[1]}/_apis/git/repositories/${segments[3]}/items`,
            identity: repositoryIdentity(host, [segments[0], segments[1], segments[3]])
        };
    }

    if (!host.endsWith(".visualstudio.com")) return null;
    const hasDefaultCollection = lower[0] === "defaultcollection";
    const offset = hasDefaultCollection ? 1 : 0;

    if (directApi) {
        if (segments.length !== offset + 6
            || lower[offset + 1] !== "_apis"
            || lower[offset + 2] !== "git"
            || lower[offset + 3] !== "repositories"
            || lower[offset + 5] !== "items") return null;

        return {
            apiPath: url.pathname,
            identity: repositoryIdentity(host, [segments[offset], segments[offset + 4]])
        };
    }

    if (segments.length !== offset + 3 || lower[offset + 1] !== "_git") return null;
    const prefix = hasDefaultCollection ? `/${segments[0]}` : "";
    return {
        apiPath: `${prefix}/${segments[offset]}/_apis/git/repositories/${segments[offset + 2]}/items`,
        identity: repositoryIdentity(host, [segments[offset], segments[offset + 2]])
    };
}

function azureDevOpsResult(parsed: ParsedUrl): NormalizedAddonUpdateUrl | RejectedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    if (host !== "dev.azure.com" && !host.endsWith(".visualstudio.com")) return null;

    const segments = pathSegments(url);
    const directApi = azureRepositoryPath(url, segments, true);
    if (directApi) return direct(parsed, url, "azure-devops", directApi.identity);

    const webRepository = azureRepositoryPath(url, segments, false);
    if (!webRepository) {
        const lower = segments.map(segment => segment.toLowerCase());
        const apiMarker = findSequence(lower, ["_apis", "git", "repositories"]);
        if (lower.includes("_git") || apiMarker !== -1) return {valid: false, reason: "unsupported-page"};
        return null;
    }

    const path = singleQueryValue(url, "path");
    const versionValue = singleQueryValue(url, "version");
    const version = versionValue ? parseAzureVersion(versionValue) : null;
    if (!path || path === "/" || !isSafeQueryPart(path, 4096) || !version) {
        return {valid: false, reason: "unsupported-page"};
    }

    const apiUrl = new URL(webRepository.apiPath, url.origin);
    addPreservedAzureQuery(url, apiUrl);
    apiUrl.searchParams.set("path", path);
    apiUrl.searchParams.set("versionDescriptor.version", version.version);
    apiUrl.searchParams.set("versionDescriptor.versionType", version.type);
    apiUrl.searchParams.set("download", "true");
    apiUrl.searchParams.set("includeContent", "true");
    apiUrl.searchParams.set("api-version", "7.1");
    return direct(parsed, apiUrl, "azure-devops", webRepository.identity);
}

function sourcehutResult(parsed: ParsedUrl): NormalizedAddonUpdateUrl | null {
    const {url} = parsed;
    if (url.hostname.toLowerCase() !== "git.sr.ht") return null;

    const segments = pathSegments(url);
    if (segments.length < 2 || !segments[0].startsWith("~")) return null;

    const identity = repositoryIdentity("git.sr.ht", segments.slice(0, 2));
    if (segments[2] === "blob" && segments.length >= 5) return direct(parsed, url, "sourcehut", identity);

    if (segments[2] === "tree" && segments[4] === "item" && segments.length >= 6) {
        const normalized = new URL(url.toString());
        normalized.pathname = `/${[...segments.slice(0, 2), "blob", segments[3], ...segments.slice(5)].join("/")}`;
        return direct(parsed, normalized, "sourcehut", identity);
    }

    return null;
}

function forgeResult(parsed: ParsedUrl): NormalizedAddonUpdateUrl | null {
    const {url} = parsed;
    const segments = pathSegments(url);

    for (let i = 2; i < segments.length - 3; i++) {
        if ((segments[i] !== "src" && segments[i] !== "raw") || !GITEA_REFERENCE_KINDS.has(segments[i + 1])) continue;

        const identity = repositoryIdentity(url.hostname, segments.slice(0, i));
        if (segments[i] === "raw") return direct(parsed, url, "gitea-forgejo", identity);
        return direct(parsed, replacePathSegment(url, i, "raw"), "gitea-forgejo", identity);
    }

    return null;
}

function pasteResult(
    parsed: ParsedUrl,
    hastebinHosts: ReadonlySet<string>
): NormalizedAddonUpdateUrl | null {
    const {url} = parsed;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = pathSegments(url);

    if (host === "pastebin.com") {
        if (segments[0] === "raw" && segments.length === 2) return direct(parsed, url, "pastebin");
        if (url.pathname === "/raw.php" && url.searchParams.has("i")) return direct(parsed, url, "pastebin");
        if (segments.length === 1 && SIMPLE_PASTE_KEY_PATTERN.test(segments[0])) {
            const raw = new URL(url.toString());
            raw.pathname = `/raw/${segments[0]}`;
            return direct(parsed, raw, "pastebin");
        }
        return null;
    }

    if (host === "dpaste.com") {
        if (segments.length !== 1 || !SIMPLE_PASTE_KEY_PATTERN.test(segments[0].replace(/\.txt$/i, ""))) return null;
        if (/\.txt$/i.test(segments[0])) return direct(parsed, url, "dpaste");

        const raw = new URL(url.toString());
        raw.pathname = `/${segments[0]}.txt`;
        return direct(parsed, raw, "dpaste");
    }

    if (host === "pastes.io") {
        if (segments[0] === "raw" && segments.length === 2) return direct(parsed, url, "pastes-io");
        if (segments.length === 1 && SIMPLE_PASTE_KEY_PATTERN.test(segments[0])) {
            const raw = new URL(url.toString());
            raw.pathname = `/raw/${segments[0]}`;
            return direct(parsed, raw, "pastes-io");
        }
        return null;
    }

    if (!hastebinHosts.has(host)) return null;

    if (segments[0] === "raw" && segments.length === 2) return direct(parsed, url, "hastebin");
    if (segments[0] === "share" && segments.length === 2 && SIMPLE_PASTE_KEY_PATTERN.test(segments[1])) {
        const raw = new URL(url.toString());
        raw.pathname = `/raw/${segments[1]}`;
        return direct(parsed, raw, "hastebin");
    }
    if (segments.length === 1 && SIMPLE_PASTE_KEY_PATTERN.test(segments[0])) {
        const raw = new URL(url.toString());
        raw.pathname = `/raw/${segments[0]}`;
        return direct(parsed, raw, "hastebin");
    }

    return null;
}

/**
 * Normalize an addon update URL without making any network calls.
 *
 * Descriptor results are intentionally unresolved: the updater must ask the
 * provider API for a file list and apply the descriptor's strict selection
 * rule. This prevents guessing when a gist or snippet contains multiple files.
 */
export function normalizeAddonUpdateUrl(
    input: string,
    options: AddonUpdateUrlNormalizerOptions = {}
): AddonUpdateUrlResult {
    const parsed = parseSecureUrl(input);
    if (!("url" in parsed)) return parsed;

    const githubHosts = hostSet(DEFAULT_GITHUB_HOSTS, options.githubHosts);
    const gitlabHosts = hostSet(DEFAULT_GITLAB_HOSTS, options.gitlabHosts);
    const hastebinHosts = hostSet(DEFAULT_HASTEBIN_HOSTS, options.hastebinHosts);
    const encryptedPasteHosts = hostSet(DEFAULT_ENCRYPTED_PASTE_HOSTS, options.encryptedPasteHosts);

    if (isKnownEncryptedPaste(parsed.url, encryptedPasteHosts)) {
        return {valid: false, reason: "encrypted-paste-unsupported"};
    }

    const bitbucketServer = bitbucketServerResult(parsed);
    if (bitbucketServer) return bitbucketServer;

    const azureDevOps = azureDevOpsResult(parsed);
    if (azureDevOps) return azureDevOps;

    const gist = githubGistResult(parsed, options.expectedFilename);
    if (gist) return gist;

    const gitlabSnippet = gitlabSnippetResult(parsed, options.expectedFilename, gitlabHosts);
    if (gitlabSnippet) return gitlabSnippet;

    const bitbucketSnippet = bitbucketSnippetResult(parsed, options.expectedFilename);
    if (bitbucketSnippet) return bitbucketSnippet;

    const github = githubResult(parsed, githubHosts);
    if (github) return github;

    const gitlab = gitlabResult(parsed, gitlabHosts);
    if (gitlab) return gitlab;

    const bitbucket = bitbucketResult(parsed);
    if (bitbucket) return bitbucket;

    const sourcehut = sourcehutResult(parsed);
    if (sourcehut) return sourcehut;

    const paste = pasteResult(parsed, hastebinHosts);
    if (paste) return paste;

    const forge = forgeResult(parsed);
    if (forge) return forge;

    return direct(parsed, parsed.url, "generic");
}

/**
 * Extract a canonical repository identity from a repository or raw-file URL.
 * This helper is useful for comparing an addon's @source repository with the
 * repository proven by an @updateUrl. It never performs a network request.
 */
export function getAddonRepositoryIdentity(
    input: string,
    options: Pick<AddonUpdateUrlNormalizerOptions, "githubHosts" | "gitlabHosts"> = {}
): AddonRepositoryIdentity | null {
    const parsed = parseSecureUrl(input);
    if (!("url" in parsed)) return null;

    const normalized = normalizeAddonUpdateUrl(input, options);
    if (normalized.valid && normalized.repositoryIdentity) {
        return {
            repositoryIdentity: normalized.repositoryIdentity,
            identityConfidence: normalized.identityConfidence
        };
    }

    const {url} = parsed;
    const host = url.hostname.toLowerCase();
    const segments = pathSegments(url);
    const githubHosts = hostSet(DEFAULT_GITHUB_HOSTS, options.githubHosts);
    const gitlabHosts = hostSet(DEFAULT_GITLAB_HOSTS, options.gitlabHosts);

    const azureIdentity = azureRepositoryPath(url, segments, true) ?? azureRepositoryPath(url, segments, false);
    if (azureIdentity?.identity) {
        return {repositoryIdentity: azureIdentity.identity, identityConfidence: "high"};
    }

    if (segments.length >= 4
        && (segments[0] === "projects" || segments[0] === "users")
        && segments[2] === "repos") {
        const identity = repositoryIdentity(host, segments.slice(0, 4));
        return identity ? {repositoryIdentity: identity, identityConfidence: "high"} : null;
    }

    if (githubHosts.has(host) && segments.length >= 2) {
        const identitySegments = host === "github.com" ? segments.slice(0, 2) : segments;
        const identity = repositoryIdentity(host, identitySegments);
        return identity ? {repositoryIdentity: identity, identityConfidence: "high"} : null;
    }

    if (gitlabHosts.has(host) && segments.length >= 2) {
        const markerIndex = segments.indexOf("-");
        const identitySegments = markerIndex > 0
            && new Set(["tree", "blob", "raw"]).has(segments[markerIndex + 1])
            ? segments.slice(0, markerIndex)
            : segments;
        const identity = repositoryIdentity(host, identitySegments);
        return identity ? {repositoryIdentity: identity, identityConfidence: "medium"} : null;
    }

    if (host === "bitbucket.org" && segments.length >= 2 && segments[0] !== "snippets") {
        const identity = repositoryIdentity("bitbucket.org", segments.slice(0, 2));
        return identity ? {repositoryIdentity: identity, identityConfidence: "high"} : null;
    }

    if (host === "git.sr.ht" && segments.length >= 2 && segments[0].startsWith("~")) {
        const identity = repositoryIdentity("git.sr.ht", segments.slice(0, 2));
        return identity ? {repositoryIdentity: identity, identityConfidence: "high"} : null;
    }

    if (DEFAULT_GITEA_FORGEJO_HOSTS.includes(host as typeof DEFAULT_GITEA_FORGEJO_HOSTS[number]) && segments.length >= 2) {
        const sourceIndex = segments.findIndex((segment, index) => (
            index >= 2
            && (segment === "src" || segment === "raw")
            && GITEA_REFERENCE_KINDS.has(segments[index + 1])
        ));
        const identity = repositoryIdentity(host, sourceIndex >= 2 ? segments.slice(0, sourceIndex) : segments);
        return identity ? {repositoryIdentity: identity, identityConfidence: "medium"} : null;
    }

    return null;
}

/** True when a descriptor response filename is a possible BetterDiscord addon. */
export function isAddonUpdateFilename(filename: string): boolean {
    return ADDON_FILE_PATTERN.test(filename);
}
