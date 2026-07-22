/**
 * Persisted addon-updater state is stored once per BetterDiscord channel.
 * Freshness remains per addon/URL so one recent check does not hide stale
 * plugins or themes from the scheduler.
 */

export const ADDON_UPDATE_STATE_VERSION = 1 as const;
export const ADDON_UPDATE_URL_FINGERPRINT_PREFIX = "url-sha256:";

export type AddonUpdateType = "plugin" | "theme";

export interface CachedAddonUpdateMetadata {
    type: AddonUpdateType;
    filename: string;
    name: string;
    version: string;
    author?: string;
    authorId?: string;
    repositoryIdentity?: string;
}

export interface AddonUpdateAddonState {
    lastCheckedAt?: number;
    /** Hash of the current metadata URL; raw URLs and sensitive queries are never persisted here. */
    urlFingerprint?: string;
    /** Hash of the validated direct body URL, including after descriptor resolution. */
    resolvedUrlFingerprint?: string;
    negativeLookupUntil?: number;
}

export interface AddonUpdateUrlState {
    lastCheckedAt?: number;
    negativeLookupUntil?: number;
    etag?: string;
    lastModified?: string;
    /** Lower-case SHA-256 hex digest of the validated remote addon body. */
    contentHash?: string;
    metadata?: CachedAddonUpdateMetadata;
}

export interface AddonUpdateOriginState {
    blockedUntil?: number;
    /** Number of consecutive provider throttles used by fallback backoff. */
    failureCount?: number;
}

export interface AddonUpdateState {
    version: typeof ADDON_UPDATE_STATE_VERSION;
    addons: Record<string, AddonUpdateAddonState>;
    /** Entries are keyed only by an opaque URL fingerprint, never by the raw update URL. */
    urls: Record<string, AddonUpdateUrlState>;
    /** Entries are keyed by canonical HTTPS origin, which cannot contain a query string. */
    origins: Record<string, AddonUpdateOriginState>;
    catalogueLastCheckedAt?: number;
    manualLastCheckedAt?: number;
}

export type AddonUpdateHeaderSource =
    | {get(name: string): string | null | undefined}
    | Readonly<Record<string, string | number | null | undefined>>;

export type AddonUpdateRateLimitSource =
    | "retry-after"
    | "x-ratelimit-reset"
    | "ratelimit-reset"
    | "fallback";

export interface AddonUpdateRateLimitOptions {
    now?: number;
    failureCount?: number;
    /** Returns additive milliseconds. Omit it for a deterministic base delay. */
    jitter?: (baseDelayMs: number, source: AddonUpdateRateLimitSource) => number;
}

export interface AddonUpdateRateLimitDelay {
    source: AddonUpdateRateLimitSource;
    baseDelayMs: number;
    delayMs: number;
    blockedUntil: number;
    nextFailureCount: number;
}

const ADDON_KEY_PATTERN = /^(plugin|theme):([^/\\\0]+)$/;
const URL_FINGERPRINT_PATTERN = /^url-sha256:[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_STATE_STRING_LENGTH = 4096;
const FALLBACK_RATE_LIMIT_DELAYS = [60_000, 300_000, 900_000, 3_600_000] as const;
const SHA256_ROUND_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRecordKey(key: string): boolean {
    return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function finiteNonNegative(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    return value;
}

function nonNegativeInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
    return value;
}

function boundedString(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_STATE_STRING_LENGTH) return undefined;
    return value;
}

function addonFilenameMatchesType(type: AddonUpdateType, filename: string): boolean {
    return type === "plugin" ? filename.toLowerCase().endsWith(".plugin.js") : filename.toLowerCase().endsWith(".theme.css");
}

function isAddonStateKey(key: string): boolean {
    const match = ADDON_KEY_PATTERN.exec(key);
    if (!match) return false;
    return addonFilenameMatchesType(match[1] as AddonUpdateType, match[2]);
}

function normalizeCachedMetadata(value: unknown): CachedAddonUpdateMetadata | undefined {
    if (!isRecord(value)) return undefined;

    const type = value.type === "plugin" || value.type === "theme" ? value.type : undefined;
    const filename = boundedString(value.filename);
    const name = boundedString(value.name);
    const version = boundedString(value.version);
    if (!type || !filename || !name || !version || !addonFilenameMatchesType(type, filename)) return undefined;

    const metadata: CachedAddonUpdateMetadata = {type, filename, name, version};
    const author = boundedString(value.author);
    const authorId = boundedString(value.authorId);
    const repositoryIdentity = boundedString(value.repositoryIdentity);
    if (author) metadata.author = author;
    if (authorId) metadata.authorId = authorId;
    if (repositoryIdentity) metadata.repositoryIdentity = repositoryIdentity;
    return metadata;
}

function normalizeAddonRecord(value: unknown): AddonUpdateAddonState | undefined {
    if (!isRecord(value)) return undefined;

    const result: AddonUpdateAddonState = {};
    const lastCheckedAt = finiteNonNegative(value.lastCheckedAt);
    const negativeLookupUntil = finiteNonNegative(value.negativeLookupUntil);
    const urlFingerprint = boundedString(value.urlFingerprint);
    const resolvedUrlFingerprint = boundedString(value.resolvedUrlFingerprint);
    if (lastCheckedAt !== undefined) result.lastCheckedAt = lastCheckedAt;
    if (negativeLookupUntil !== undefined) result.negativeLookupUntil = negativeLookupUntil;
    if (urlFingerprint && URL_FINGERPRINT_PATTERN.test(urlFingerprint)) result.urlFingerprint = urlFingerprint;
    if (resolvedUrlFingerprint && URL_FINGERPRINT_PATTERN.test(resolvedUrlFingerprint)) result.resolvedUrlFingerprint = resolvedUrlFingerprint;
    return Object.keys(result).length ? result : undefined;
}

function normalizeUrlRecord(value: unknown): AddonUpdateUrlState | undefined {
    if (!isRecord(value)) return undefined;

    const result: AddonUpdateUrlState = {};
    const lastCheckedAt = finiteNonNegative(value.lastCheckedAt);
    const negativeLookupUntil = finiteNonNegative(value.negativeLookupUntil);
    const etag = boundedString(value.etag);
    const lastModified = boundedString(value.lastModified);
    const contentHash = boundedString(value.contentHash);
    const metadata = normalizeCachedMetadata(value.metadata);
    if (lastCheckedAt !== undefined) result.lastCheckedAt = lastCheckedAt;
    if (negativeLookupUntil !== undefined) result.negativeLookupUntil = negativeLookupUntil;
    if (etag) result.etag = etag;
    if (lastModified) result.lastModified = lastModified;
    if (contentHash && SHA256_PATTERN.test(contentHash)) result.contentHash = contentHash.toLowerCase();
    if (metadata) result.metadata = metadata;
    return Object.keys(result).length ? result : undefined;
}

function normalizeOriginRecord(value: unknown): AddonUpdateOriginState | undefined {
    if (!isRecord(value)) return undefined;

    const result: AddonUpdateOriginState = {};
    const blockedUntil = finiteNonNegative(value.blockedUntil);
    const failureCount = nonNegativeInteger(value.failureCount);
    if (blockedUntil !== undefined) result.blockedUntil = blockedUntil;
    if (failureCount !== undefined) result.failureCount = failureCount;
    return Object.keys(result).length ? result : undefined;
}

function normalizeRecords<T>(
    value: unknown,
    normalizeKey: (key: string) => string | null,
    normalizeValue: (entry: unknown) => T | undefined
): Record<string, T> {
    const result: Record<string, T> = {};
    if (!isRecord(value)) return result;

    for (const [inputKey, inputValue] of Object.entries(value)) {
        if (!isSafeRecordKey(inputKey)) continue;
        const key = normalizeKey(inputKey);
        const entry = normalizeValue(inputValue);
        if (key && entry) result[key] = entry;
    }
    return result;
}

export function createAddonUpdateState(): AddonUpdateState {
    return {
        version: ADDON_UPDATE_STATE_VERSION,
        addons: {},
        urls: {},
        origins: {}
    };
}

/** Drops unknown versions and malformed fields rather than trusting persisted JSON. */
export function normalizeAddonUpdateState(value: unknown): AddonUpdateState {
    const result = createAddonUpdateState();
    if (!isRecord(value) || value.version !== ADDON_UPDATE_STATE_VERSION) return result;

    result.addons = normalizeRecords(value.addons, (key) => isAddonStateKey(key) ? key : null, normalizeAddonRecord);
    result.urls = normalizeRecords(
        value.urls,
        (key) => URL_FINGERPRINT_PATTERN.test(key) ? key : null,
        normalizeUrlRecord
    );
    result.origins = normalizeRecords(value.origins, getAddonUpdateOrigin, normalizeOriginRecord);

    const catalogueLastCheckedAt = finiteNonNegative(value.catalogueLastCheckedAt);
    const manualLastCheckedAt = finiteNonNegative(value.manualLastCheckedAt);
    if (catalogueLastCheckedAt !== undefined) result.catalogueLastCheckedAt = catalogueLastCheckedAt;
    if (manualLastCheckedAt !== undefined) result.manualLastCheckedAt = manualLastCheckedAt;
    return result;
}

export function getAddonUpdateKey(type: AddonUpdateType, filename: string): string {
    return `${type}:${filename}`;
}

/** Returns a canonical HTTPS origin, excluding paths, credentials and query strings. */
export function getAddonUpdateOrigin(input: string): string | null {
    try {
        const url = new URL(input);
        if (url.protocol !== "https:" || url.username || url.password) return null;
        return url.origin;
    }
    catch {
        return null;
    }
}

function rotateRight(value: number, count: number): number {
    return (value >>> count) | (value << (32 - count));
}

function sha256Hex(input: string | Uint8Array): string {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const bitLength = bytes.length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    const hash = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false);
        for (let index = 16; index < 64; index++) {
            const previous15 = words[index - 15];
            const previous2 = words[index - 2];
            const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
            const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
            words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index++) {
            const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
            const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * Produces an opaque deterministic cache key. The normalized URL, including
 * any token-bearing query, affects the hash without becoming persisted state.
 */
export function getAddonUpdateUrlFingerprint(normalizedUrl: string): string {
    return `${ADDON_UPDATE_URL_FINGERPRINT_PREFIX}${sha256Hex(normalizedUrl.trim())}`;
}

/** Hashes the exact downloaded bytes rather than a decoded/re-encoded source string. */
export function getAddonUpdateContentHash(content: Uint8Array): string {
    return sha256Hex(content);
}

export function isAddonCheckStale(lastCheckedAt: number | null | undefined, intervalMs: number, now: number): boolean {
    const checkedAt = finiteNonNegative(lastCheckedAt);
    if (checkedAt === undefined) return true;
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || !Number.isFinite(now)) return true;
    return checkedAt + intervalMs <= now;
}

/** Returns the next useful timer instant, or null when no addons are installed. */
export function getEarliestAddonCheckDueAt(
    installedKeys: readonly string[],
    addonStates: Readonly<Record<string, AddonUpdateAddonState>>,
    intervalMs: number,
    now: number
): number | null {
    if (installedKeys.length === 0) return null;
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || !Number.isFinite(now)) return now;

    let earliest = Number.POSITIVE_INFINITY;
    for (const key of installedKeys) {
        const checkedAt = finiteNonNegative(addonStates[key]?.lastCheckedAt);
        if (checkedAt === undefined) return now;
        earliest = Math.min(earliest, checkedAt + intervalMs);
    }
    return Math.max(now, earliest);
}

export function getNegativeLookupUntil(now: number, durationMs: number): number {
    if (!Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs < 0) return now;
    return now + durationMs;
}

export function isNegativeLookupActive(negativeLookupUntil: number | null | undefined, now: number): boolean {
    const until = finiteNonNegative(negativeLookupUntil);
    return until !== undefined && Number.isFinite(now) && until > now;
}

function getHeader(headers: AddonUpdateHeaderSource, name: string): string | null {
    if ("get" in headers && typeof headers.get === "function") {
        const value = headers.get(name);
        return value === null || value === undefined ? null : String(value).trim();
    }

    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== lowerName || value === null || value === undefined) continue;
        return String(value).trim();
    }
    return null;
}

/**
 * A 429 is always a throttle response. A 403 is only treated as a throttle when
 * the provider also supplies rate-limit evidence; ordinary access-denied
 * responses must not pause every request to that origin.
 */
export function isAddonUpdateRateLimitResponse(status: number, headers: AddonUpdateHeaderSource): boolean {
    if (status === 429) return true;
    if (status !== 403) return false;

    const remaining = getHeader(headers, "x-ratelimit-remaining") ?? getHeader(headers, "ratelimit-remaining");
    if (remaining !== null && Number.isFinite(Number(remaining)) && Number(remaining) <= 0) return true;

    return Boolean(
        getHeader(headers, "retry-after")
        || getHeader(headers, "x-ratelimit-reset")
        || getHeader(headers, "ratelimit-reset")
    );
}

function secondsToMilliseconds(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds)) return null;
    return seconds * 1000;
}

function retryAfterDelay(value: string | null, now: number): number | null {
    if (!value) return null;
    const seconds = secondsToMilliseconds(value);
    if (seconds !== null) return seconds;

    const date = Date.parse(value);
    if (!Number.isFinite(date)) return null;
    return Math.max(0, date - now);
}

function epochResetDelay(value: string | null, now: number): number | null {
    if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
    const epochSeconds = Number(value);
    if (!Number.isFinite(epochSeconds)) return null;
    const delay = epochSeconds * 1000 - now;
    return delay >= 0 ? delay : null;
}

function standardResetDelay(value: string | null, now: number): number | null {
    if (!value) return null;
    const numeric = secondsToMilliseconds(value);
    if (numeric !== null) {
        const seconds = Number(value);
        const nowSeconds = now / 1000;
        // Most RateLimit-Reset implementations use delta-seconds; accept epoch-seconds too.
        return seconds > nowSeconds ? Math.max(0, numeric - now) : numeric;
    }

    const date = Date.parse(value);
    if (!Number.isFinite(date)) return null;
    return Math.max(0, date - now);
}

/**
 * Parses provider rate-limit headers in priority order and falls back to
 * 1m, 5m, 15m, then 60m. Callers may inject small jitter for live scheduling.
 */
export function getAddonUpdateRateLimitDelay(
    headers: AddonUpdateHeaderSource,
    options: AddonUpdateRateLimitOptions = {}
): AddonUpdateRateLimitDelay {
    const now = finiteNonNegative(options.now) ?? Date.now();
    const failureCount = nonNegativeInteger(options.failureCount) ?? 0;

    let source: AddonUpdateRateLimitSource = "retry-after";
    let baseDelayMs = retryAfterDelay(getHeader(headers, "Retry-After"), now);
    if (baseDelayMs === null) {
        source = "x-ratelimit-reset";
        baseDelayMs = epochResetDelay(getHeader(headers, "X-RateLimit-Reset"), now);
    }
    if (baseDelayMs === null) {
        source = "ratelimit-reset";
        baseDelayMs = standardResetDelay(getHeader(headers, "RateLimit-Reset"), now);
    }
    if (baseDelayMs === null) {
        source = "fallback";
        baseDelayMs = FALLBACK_RATE_LIMIT_DELAYS[Math.min(failureCount, FALLBACK_RATE_LIMIT_DELAYS.length - 1)];
    }

    const jitter = options.jitter?.(baseDelayMs, source) ?? 0;
    const delayMs = Math.max(0, baseDelayMs + (Number.isFinite(jitter) ? jitter : 0));
    return {
        source,
        baseDelayMs,
        delayMs,
        blockedUntil: now + delayMs,
        nextFailureCount: Math.min(failureCount + 1, FALLBACK_RATE_LIMIT_DELAYS.length - 1)
    };
}
