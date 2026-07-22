import {comparator as compareSemver, regex as semverRegex} from "@common/semver";
import parseJsDoc from "@common/utils/jsdoc";
import {getAddonRepositoryIdentity} from "./addonupdateurl";

import type {AddonType} from "@typed/addon";


export type AddonVersionComparison = "newer" | "equal" | "older" | "uncomparable";

export type AddonContentRejectionCode =
    | "unsupported-filename"
    | "wrong-addon-type"
    | "html-response"
    | "binary-response"
    | "git-lfs-pointer"
    | "missing-jsdoc"
    | "misplaced-jsdoc"
    | "invalid-jsdoc"
    | "invalid-name"
    | "invalid-version";

export interface ValidatedAddonMetadata {
    type: AddonType;
    name: string;
    version: string;
    author?: string;
    authorId?: string;
    updateUrl?: string;
    source?: string;
    website?: string;
}

export type AddonContentValidationResult =
    | {ok: true; metadata: ValidatedAddonMetadata;}
    | {ok: false; code: AddonContentRejectionCode; reason: string;};

export interface AddonIdentityInput {
    author?: unknown;
    authors?: unknown;
    authorId?: unknown;
    authorIds?: unknown;
    source?: unknown;
    website?: unknown;
    updateUrl?: unknown;
    repositoryUrl?: unknown;
    repositoryUrls?: unknown;
    /** Pre-normalized repository keys restored from the updater's URL cache. */
    repositoryIdentity?: unknown;
    repositoryIdentities?: unknown;
    latestSourceUrl?: unknown;
    discordSnowflake?: unknown;
    githubName?: unknown;
    displayName?: unknown;
    discordName?: unknown;
    authorNames?: unknown;
}

export type AddonIdentityStatus = "eligible" | "rejected" | "unknown";
export type AddonIdentityEvidence = "repository" | "author-id" | "author";

export interface AddonIdentityResult {
    status: AddonIdentityStatus;
    matchedBy: AddonIdentityEvidence[];
    repository: "match" | "mismatch" | "unknown";
    authorId: "match" | "mismatch" | "unknown";
    author: "match" | "mismatch" | "unknown";
    installedRepositories: string[];
    candidateRepositories: string[];
}

export type AddonUpdateSource = "update-url" | "store";

export interface AddonUpdateCandidate<T = unknown> {
    source: AddonUpdateSource;
    version: string;
    identity: AddonIdentityResult;
    data?: T;
}

const looseVersionRegex = /^\d+(?:\.\d+)*$/;
const discordSnowflakeRegex = /^\d{15,22}$/;
const opaqueMetadataValues = new Set(["?", "n/a", "none", "null", "undefined", "unknown"]);
const authorStopWords = new Set(["author", "authors", "developer", "developers", "team", "unknown"]);

function compareNumericToken(left: string, right: string) {
    const normalizedLeft = left.replace(/^0+(?=\d)/, "");
    const normalizedRight = right.replace(/^0+(?=\d)/, "");

    if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length > normalizedRight.length ? 1 : -1;
    if (normalizedLeft === normalizedRight) return 0;
    return normalizedLeft > normalizedRight ? 1 : -1;
}

function isComparableAddonVersion(version: string) {
    return semverRegex.test(version) || looseVersionRegex.test(version);
}

/**
 * Compares the remote version against the installed version. The explicit result avoids the
 * upstream updater's unsafe lexical fallback for non-SemVer addon versions.
 */
export function compareAddonVersions(installedVersion: string, remoteVersion: string): AddonVersionComparison {
    if (typeof installedVersion !== "string" || typeof remoteVersion !== "string") return "uncomparable";

    const installed = installedVersion.trim();
    const remote = remoteVersion.trim();
    if (!installed || !remote) return "uncomparable";

    if (semverRegex.test(installed) && semverRegex.test(remote)) {
        const comparison = compareSemver(installed, remote);
        if (comparison > 0) return "newer";
        if (comparison < 0) return "older";
        return "equal";
    }

    if (!looseVersionRegex.test(installed) || !looseVersionRegex.test(remote)) return "uncomparable";

    const installedParts = installed.split(".");
    const remoteParts = remote.split(".");
    const partCount = Math.max(installedParts.length, remoteParts.length);

    for (let index = 0; index < partCount; index++) {
        const comparison = compareNumericToken(remoteParts[index] ?? "0", installedParts[index] ?? "0");
        if (comparison > 0) return "newer";
        if (comparison < 0) return "older";
    }

    return "equal";
}

export function getAddonTypeFromFilename(filename: string): AddonType | null {
    const normalized = filename.trim().toLowerCase();
    if (normalized.endsWith(".plugin.js")) return "plugin";
    if (normalized.endsWith(".theme.css")) return "theme";
    return null;
}

function looksLikeHtmlResponse(content: string) {
    const prefix = content.trimStart().slice(0, 2048).toLowerCase();
    if (prefix.startsWith("<")) return true;
    return /^(?:authentication required|log[ -]?in required|sign in to (?:github|gitlab))\b/.test(prefix);
}

function containsBinaryData(content: string) {
    // Decoded addon source should never contain raw control bytes. Rejecting them also catches
    // the common case where a binary response was accidentally decoded as text.
    for (let index = 0; index < content.length; index++) {
        const code = content.charCodeAt(index);
        if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) return true;
    }
    return false;
}

function isGitLfsPointer(content: string) {
    return content.trimStart().startsWith("version https://git-lfs.github.com/spec/v1");
}

function readMetadataScalar(metadata: Record<string, string | string[]>, field: string, maxLength: number) {
    const matchingKey = Object.keys(metadata).find(key => key.toLowerCase() === field.toLowerCase());
    if (!matchingKey) return null;

    const value = metadata[matchingKey];
    if (typeof value !== "string") return null;

    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || containsBinaryData(normalized)) return null;
    return normalized;
}

function readSafeMetadataUrl(metadata: Record<string, string | string[]>, field: string) {
    const value = readMetadataScalar(metadata, field, 4096);
    if (!value) return undefined;

    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return undefined;
        return url.toString();
    }
    catch {
        return undefined;
    }
}

function isOpaqueMetadata(value: string) {
    return opaqueMetadataValues.has(value.trim().toLowerCase());
}

/**
 * Validates a downloaded addon before it can replace an installed file. This intentionally reads
 * only the first JSDoc block so a later, injected metadata block cannot override the real header.
 */
export function validateAddonContent(filename: string, content: string, expectedType?: AddonType): AddonContentValidationResult {
    const filenameType = getAddonTypeFromFilename(filename);
    if (!filenameType) {
        return {ok: false, code: "unsupported-filename", reason: "The filename is not a BetterDiscord plugin or theme."};
    }
    if (expectedType && filenameType !== expectedType) {
        return {ok: false, code: "wrong-addon-type", reason: `Expected a ${expectedType}, but the filename identifies a ${filenameType}.`};
    }
    if (looksLikeHtmlResponse(content)) {
        return {ok: false, code: "html-response", reason: "The update server returned an HTML or login page instead of addon source."};
    }
    if (containsBinaryData(content)) {
        return {ok: false, code: "binary-response", reason: "The update server returned binary or control-byte data instead of addon source."};
    }
    if (isGitLfsPointer(content)) {
        return {ok: false, code: "git-lfs-pointer", reason: "The update server returned a Git LFS pointer instead of the addon file."};
    }

    const metadataSource = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
    const firstLineEnd = metadataSource.search(/[\r\n]/);
    const firstLine = metadataSource.slice(0, firstLineEnd === -1 ? metadataSource.length : firstLineEnd);
    const jsDocStart = metadataSource.indexOf("/**");
    if (jsDocStart < 0) {
        return {ok: false, code: "missing-jsdoc", reason: "The addon source does not contain a JSDoc metadata header."};
    }
    if (!/^\s*\/\*\*/.test(firstLine)) {
        return {ok: false, code: "misplaced-jsdoc", reason: "The addon metadata header is not on the first line."};
    }

    const jsDocEnd = metadataSource.indexOf("*/", jsDocStart + 3);
    if (jsDocEnd < 0) {
        return {ok: false, code: "invalid-jsdoc", reason: "The first JSDoc metadata header is incomplete."};
    }

    let metadata: Record<string, string | string[]>;
    try {
        metadata = parseJsDoc(metadataSource.slice(jsDocStart, jsDocEnd + 2));
    }
    catch {
        return {ok: false, code: "invalid-jsdoc", reason: "The first JSDoc metadata header could not be parsed."};
    }

    const declaredType = readMetadataScalar(metadata, "type", 32)?.toLowerCase();
    if ((declaredType === "plugin" || declaredType === "theme") && declaredType !== filenameType) {
        return {ok: false, code: "wrong-addon-type", reason: `The addon metadata declares a ${declaredType}, but its filename identifies a ${filenameType}.`};
    }

    const name = readMetadataScalar(metadata, "name", 256);
    if (!name || isOpaqueMetadata(name)) {
        return {ok: false, code: "invalid-name", reason: "The first JSDoc metadata header has no usable addon name."};
    }

    const version = readMetadataScalar(metadata, "version", 128);
    if (!version || isOpaqueMetadata(version) || !isComparableAddonVersion(version)) {
        return {ok: false, code: "invalid-version", reason: "The first JSDoc metadata header has no comparable addon version."};
    }

    const author = readMetadataScalar(metadata, "author", 512);
    const authorId = readMetadataScalar(metadata, "authorId", 128);
    const validated: ValidatedAddonMetadata = {
        type: filenameType,
        name,
        version
    };

    if (author && !isOpaqueMetadata(author)) validated.author = author;
    if (authorId && !isOpaqueMetadata(authorId)) validated.authorId = authorId;

    const updateUrl = readSafeMetadataUrl(metadata, "updateUrl");
    const source = readSafeMetadataUrl(metadata, "source");
    const website = readSafeMetadataUrl(metadata, "website");
    if (updateUrl) validated.updateUrl = updateUrl;
    if (source) validated.source = source;
    if (website) validated.website = website;

    return {ok: true, metadata: validated};
}

function collectStrings(value: unknown, output: string[]) {
    if (typeof value === "string") {
        const normalized = value.trim();
        if (normalized) output.push(normalized);
        return;
    }
    if (!Array.isArray(value)) return;
    for (const child of value) collectStrings(child, output);
}

/**
 * Extracts a stable repository key only when a forge URL exposes one deterministically. Unknown
 * generic download paths deliberately return null instead of manufacturing identity evidence.
 */
export function normalizeRepositoryIdentity(value: string): string | null {
    return getAddonRepositoryIdentity(value)?.repositoryIdentity ?? null;
}

export function normalizeAuthorTokens(...values: unknown[]): string[] {
    const authors: string[] = [];
    for (const value of values) collectStrings(value, authors);

    const tokens = new Set<string>();
    for (const author of authors) {
        const segments = author.split(/[,;&|+\n]|\band\b/gi);
        for (const segment of segments) {
            const normalized = segment
                .normalize("NFKD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/#\d{3,5}\s*$/, "")
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
            if (normalized.length < 3 || authorStopWords.has(normalized)) continue;
            tokens.add(normalized);
        }
    }

    return [...tokens].sort();
}

function collectRepositories(identity: AddonIdentityInput) {
    const values: string[] = [];
    collectStrings(identity.source, values);
    collectStrings(identity.website, values);
    collectStrings(identity.updateUrl, values);
    collectStrings(identity.repositoryUrl, values);
    collectStrings(identity.repositoryUrls, values);
    collectStrings(identity.latestSourceUrl, values);

    const repositories = new Set<string>();
    const normalizedValues: string[] = [];
    collectStrings(identity.repositoryIdentity, normalizedValues);
    collectStrings(identity.repositoryIdentities, normalizedValues);
    for (const value of normalizedValues) {
        if (/^[a-z0-9.-]+\/[a-z0-9~_./-]+$/i.test(value)) repositories.add(value.toLowerCase());
    }
    for (const value of values) {
        const repository = normalizeRepositoryIdentity(value);
        if (repository) repositories.add(repository);
    }
    return [...repositories].sort();
}

function collectAuthorIds(identity: AddonIdentityInput) {
    const values: string[] = [];
    collectStrings(identity.authorId, values);
    collectStrings(identity.authorIds, values);
    collectStrings(identity.discordSnowflake, values);
    return [...new Set(values.filter(value => discordSnowflakeRegex.test(value)))].sort();
}

function collectAuthorTokens(identity: AddonIdentityInput) {
    return normalizeAuthorTokens(
        identity.author,
        identity.authors,
        identity.authorNames,
        identity.githubName,
        identity.displayName,
        identity.discordName
    );
}

function compareEvidence(installed: string[], candidate: string[]): "match" | "mismatch" | "unknown" {
    if (!installed.length || !candidate.length) return "unknown";
    return installed.some(value => candidate.includes(value)) ? "match" : "mismatch";
}

/**
 * A matching filename is only a lookup key, never proof that two addons share an identity. A
 * confirmed repository mismatch rejects Store collisions unless an independent author match exists.
 */
export function compareAddonIdentity(installed: AddonIdentityInput, candidate: AddonIdentityInput): AddonIdentityResult {
    const installedRepositories = collectRepositories(installed);
    const candidateRepositories = collectRepositories(candidate);
    const repository = compareEvidence(installedRepositories, candidateRepositories);
    const authorId = compareEvidence(collectAuthorIds(installed), collectAuthorIds(candidate));
    const author = compareEvidence(collectAuthorTokens(installed), collectAuthorTokens(candidate));

    const matchedBy: AddonIdentityEvidence[] = [];
    if (repository === "match") matchedBy.push("repository");
    if (authorId === "match") matchedBy.push("author-id");
    if (author === "match") matchedBy.push("author");

    let status: AddonIdentityStatus = "unknown";
    if (matchedBy.length) status = "eligible";
    else if (repository === "mismatch") status = "rejected";

    return {
        status,
        matchedBy,
        repository,
        authorId,
        author,
        installedRepositories,
        candidateRepositories
    };
}

export function compareAddonCandidateIdentities(
    installed: AddonIdentityInput,
    updateUrlCandidate?: AddonIdentityInput,
    storeCandidate?: AddonIdentityInput
) {
    return {
        updateUrl: updateUrlCandidate ? compareAddonIdentity(installed, updateUrlCandidate) : undefined,
        store: storeCandidate ? compareAddonIdentity(installed, storeCandidate) : undefined
    };
}

/**
 * Chooses only an identity-approved upgrade. Equal remote versions favor the addon's declared
 * update URL, while mutually uncomparable candidates are rejected instead of guessed.
 */
export function chooseAddonUpdateCandidate<T>(
    installedVersion: string,
    candidates: Array<AddonUpdateCandidate<T> | null | undefined>
): AddonUpdateCandidate<T> | null {
    const newer = candidates.filter((candidate): candidate is AddonUpdateCandidate<T> => Boolean(
        candidate
        && candidate.identity.status === "eligible"
        && compareAddonVersions(installedVersion, candidate.version) === "newer"
    ));
    if (!newer.length) return null;

    let selected = newer[0];
    for (const candidate of newer.slice(1)) {
        const comparison = compareAddonVersions(selected.version, candidate.version);
        if (comparison === "newer") {
            selected = candidate;
            continue;
        }
        if (comparison === "equal" && candidate.source === "update-url" && selected.source !== "update-url") {
            selected = candidate;
            continue;
        }
        if (comparison === "uncomparable") return null;
    }

    return selected;
}
