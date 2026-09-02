import path from "path";

import Logger from "@common/logger";
import {t} from "@common/i18n";

import SettingsStore from "@stores/settings";
import JsonStore from "@stores/json";
import Toasts from "@stores/toasts";

import Notifications from "@stores/notifications";
import Modals from "@ui/modals";
import Settings from "@ui/settings";
import {Logo} from "@ui/logo";

import Remote from "@polyfill/remote";

import React from "./react";
import Events from "./emitter";
import PluginManager from "./pluginmanager";
import ThemeManager from "./thememanager";
import AddonStore, {type Addon as StoreAddon} from "./addonstore";
import {fetch} from "./net";

import type AddonManager from "./addonmanager";
import type {Addon, AddonType} from "@typed/addon";

import {
    chooseAddonUpdateCandidate,
    compareAddonIdentity,
    validateAddonContent,
    type AddonIdentityResult,
    type AddonUpdateCandidate,
    type AddonUpdateSource,
    type ValidatedAddonMetadata
} from "@utils/addonupdate";
import {
    createAddonUpdateState,
    getAddonUpdateContentHash,
    getAddonUpdateKey,
    getAddonUpdateOrigin,
    getAddonUpdateRateLimitDelay,
    getAddonUpdateUrlFingerprint,
    getEarliestAddonCheckDueAt,
    getNegativeLookupUntil,
    isAddonUpdateRateLimitResponse,
    isAddonCheckStale,
    isNegativeLookupActive,
    normalizeAddonUpdateState,
    type AddonUpdateState,
    type CachedAddonUpdateMetadata
} from "@utils/addonupdatestate";
import {
    isAddonUpdateFilename,
    normalizeAddonUpdateUrl,
    type AddonUpdateDescriptor,
    type AddonUpdateProvider,
    type NormalizedAddonUpdateUrl
} from "@utils/addonupdateurl";


const ADDON_DOWNLOAD_TIMEOUT_MS = 15_000;
const ADDON_DOWNLOAD_LIMIT_BYTES = 16 * 1024 * 1024;
const CACHED_ADDON_BODY_BUDGET_BYTES = 128 * 1024 * 1024;
const DESCRIPTOR_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_ADDON_REDIRECTS = 5;
const MAX_DESCRIPTOR_PAGES = 5;
const MANUAL_CHECK_COOLDOWN_MS = 60_000;
const MISSING_SOURCE_COOLDOWN_MS = 30 * 60 * 1000;
const TRANSIENT_RETRY_MS = 5 * 60 * 1000;
const EVENT_CHECK_DEBOUNCE_MS = 750;
const MINIMUM_SCHEDULE_DELAY_MS = 1_000;

type CheckReason = "startup" | "scheduled" | "manual" | "event";
type UpdateFailureCode = "not-found" | "rate-limit" | "http" | "timeout" | "invalid" | "unsafe" | "write" | "unknown";

interface UpdateSourceDetails {
    filename: string;
    name: string;
    fetchUrl: string;
    provider: AddonUpdateProvider;
    repositoryIdentity: string | null;
    metadata?: ValidatedAddonMetadata;
    /** A restart-restored descriptor must be resolved again before its body can be fetched. */
    resolveDeclared?: boolean;
}

type Candidate = AddonUpdateCandidate<UpdateSourceDetails>;

interface RawBodyResult {
    kind: "body";
    fingerprint: string;
    bytes: Uint8Array;
    text: string;
    hash: string;
}

interface RawNotModifiedResult {
    kind: "not-modified";
    fingerprint: string;
}

interface RawNotFoundResult {
    kind: "not-found";
    fingerprint: string;
}

type RawFetchResult = RawBodyResult | RawNotModifiedResult | RawNotFoundResult;

interface CachedBody {
    bytes: Uint8Array;
    text: string;
    hash: string;
}

export interface AddonUpdateFailure {
    filename: string;
    name: string;
    reason: string;
    /** Rate-limit-only failures stay console-only and must not create a card. */
    notify?: boolean;
}

interface AddonUpdateResult {
    success: boolean;
    failure?: AddonUpdateFailure;
}

interface UpdateAttempt {
    promise: Promise<AddonUpdateResult>;
}

interface DescriptorFile {
    filename: string;
    rawUrl: string;
}

class AddonUpdateError extends Error {
    code: UpdateFailureCode;
    silent: boolean;
    retryable: boolean;
    retryAt?: number;

    constructor(code: UpdateFailureCode, message: string, options: {silent?: boolean; retryable?: boolean; retryAt?: number; cause?: unknown;} = {}) {
        super(message, options.cause === undefined ? undefined : {cause: options.cause});
        this.name = "AddonUpdateError";
        this.code = code;
        this.silent = options.silent ?? false;
        this.retryable = options.retryable ?? (code === "rate-limit" || code === "timeout" || code === "unknown");
        if (Number.isFinite(options.retryAt)) this.retryAt = options.retryAt;
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function safeFailureReason(error: unknown): string {
    const message = asError(error).message
        .replace(/https:\/\/[^\s)]+/gi, "the update source")
        .replace(/[\r\n\t]+/g, " ")
        .trim();
    return (message || "The update could not be completed.").slice(0, 220);
}

function safeErrorForLog(error: unknown): Error {
    const failure = asError(error);
    const safe = new Error(safeFailureReason(failure));
    safe.name = failure.name;
    if (failure.stack) {
        safe.stack = failure.stack
            .replace(/https:\/\/[^\s)]+/gi, "the update source")
            .replace(/[\r\n\t]+/g, "\n");
    }
    return safe;
}

function sameAddonName(left: string, right: string): boolean {
    const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
    return Boolean(normalize(left)) && normalize(left) === normalize(right);
}

function approvedDeclaredUrlIdentity(identity: AddonIdentityResult, installedName: string, remoteName: string): AddonIdentityResult {
    if (identity.status !== "unknown" || !sameAddonName(installedName, remoteName)) return identity;

    // Fork review: a URL declared by the installed addon may use a generic raw/paste host with no
    // repository metadata. A matching validated addon name is the narrow fallback; Store rows do
    // not receive this promotion because a shared filename is not proof of identity.
    return {...identity, status: "eligible"};
}

function getCaseInsensitiveString(value: object, field: string): string | undefined {
    const record = value as Record<string, unknown>;
    const key = Object.keys(record).find(candidate => candidate.toLowerCase() === field.toLowerCase());
    return key && typeof record[key] === "string" ? record[key].trim() || undefined : undefined;
}

function getInstalledUpdateUrl(addon: Addon): string | undefined {
    const fileContent = typeof addon.fileContent === "string" ? addon.fileContent : "";
    const parsed = validateAddonContent(addon.filename, fileContent);
    if (parsed.ok && parsed.metadata.updateUrl) return parsed.metadata.updateUrl;
    return getCaseInsensitiveString(addon, "updateUrl");
}

function getInstalledIdentity(addon: Addon, updateUrl?: string) {
    return {
        author: addon.author,
        authorId: addon.authorId,
        source: addon.source,
        website: addon.website,
        updateUrl
    };
}

function getStoreIdentity(addon: StoreAddon) {
    return {
        latestSourceUrl: addon.latestSourceUrl,
        discordSnowflake: addon._addon.author.discord_snowflake,
        githubName: addon._addon.author.github_name,
        displayName: addon._addon.author.display_name,
        discordName: addon._addon.author.discord_name
    };
}

function getMetadataIdentity(metadata: ValidatedAddonMetadata, repositoryIdentity: string | null) {
    return {
        author: metadata.author,
        authorId: metadata.authorId,
        source: metadata.source,
        website: metadata.website,
        updateUrl: metadata.updateUrl,
        repositoryIdentity: repositoryIdentity ?? undefined
    };
}

function toCachedMetadata(filename: string, metadata: ValidatedAddonMetadata, repositoryIdentity: string | null): CachedAddonUpdateMetadata {
    const cached: CachedAddonUpdateMetadata = {
        type: metadata.type,
        filename,
        name: metadata.name,
        version: metadata.version
    };
    if (metadata.author) cached.author = metadata.author;
    if (metadata.authorId) cached.authorId = metadata.authorId;
    if (repositoryIdentity) cached.repositoryIdentity = repositoryIdentity;
    return cached;
}

function fromCachedMetadata(metadata: CachedAddonUpdateMetadata): ValidatedAddonMetadata {
    const restored: ValidatedAddonMetadata = {
        type: metadata.type,
        name: metadata.name,
        version: metadata.version
    };
    if (metadata.author) restored.author = metadata.author;
    if (metadata.authorId) restored.authorId = metadata.authorId;
    return restored;
}

class RequestLimiter {
    #active = 0;
    #activeByOrigin = new Map<string, number>();
    #queue: Array<{
        origin: string;
        run: () => Promise<unknown>;
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
    }> = [];

    run<T>(url: string, task: () => Promise<T>): Promise<T> {
        const origin = getAddonUpdateOrigin(url);
        if (!origin) return Promise.reject(new AddonUpdateError("unsafe", "The update source is not a safe HTTPS URL."));

        return new Promise<T>((resolve, reject) => {
            this.#queue.push({
                origin,
                run: task,
                resolve: resolve as (value: unknown) => void,
                reject
            });
            this.#drain();
        });
    }

    #drain() {
        while (this.#active < 3) {
            const index = this.#queue.findIndex(item => (this.#activeByOrigin.get(item.origin) ?? 0) < 2);
            if (index < 0) return;

            const [item] = this.#queue.splice(index, 1);
            this.#active++;
            this.#activeByOrigin.set(item.origin, (this.#activeByOrigin.get(item.origin) ?? 0) + 1);

            void item.run().then(item.resolve, item.reject).finally(() => {
                this.#active--;
                const activeForOrigin = (this.#activeByOrigin.get(item.origin) ?? 1) - 1;
                if (activeForOrigin <= 0) this.#activeByOrigin.delete(item.origin);
                else this.#activeByOrigin.set(item.origin, activeForOrigin);
                this.#drain();
            });
        }
    }
}

const requestLimiter = new RequestLimiter();
const activeRawRequests = new Map<string, Promise<RawFetchResult>>();
const memoryBodies = new Map<string, CachedBody>();
let memoryBodyBytes = 0;
const resolvedUpdateUrls = new Map<string, NormalizedAddonUpdateUrl>();
const collisionWarnings = new Set<string>();
const rateLimitWarnings = new Set<string>();
let descriptorQueue: Promise<void> = Promise.resolve();
let failureNotificationSequence = 0;

function deleteMemoryBody(fingerprint: string) {
    const cached = memoryBodies.get(fingerprint);
    if (!cached) return;
    memoryBodies.delete(fingerprint);
    memoryBodyBytes = Math.max(0, memoryBodyBytes - cached.bytes.byteLength);
}

function storeMemoryBody(fingerprint: string, cached: CachedBody) {
    deleteMemoryBody(fingerprint);
    memoryBodies.set(fingerprint, cached);
    memoryBodyBytes += cached.bytes.byteLength;

    // Exact checked bytes are an optimization, not authority. Bound aggregate memory and let an
    // evicted candidate be fetched and validated again if the user later installs it.
    while (memoryBodyBytes > CACHED_ADDON_BODY_BUDGET_BYTES && memoryBodies.size) {
        const oldest = memoryBodies.keys().next().value as string | undefined;
        if (!oldest) break;
        deleteMemoryBody(oldest);
    }
}

function forgetCandidateBodies(candidates: readonly Candidate[]) {
    for (const candidate of candidates) {
        const fetchUrl = candidate.data?.fetchUrl;
        if (fetchUrl) deleteMemoryBody(getAddonUpdateUrlFingerprint(fetchUrl));
    }
}

function queueDescriptorRequest<T>(task: () => Promise<T>): Promise<T> {
    const result = descriptorQueue.then(task, task);
    descriptorQueue = result.then(() => undefined, () => undefined);
    return result;
}

let state: AddonUpdateState = createAddonUpdateState();
let stateDirty = false;

function saveState() {
    stateDirty = true;
}

function flushState() {
    if (!stateDirty) return;
    JsonStore.set("addon-updater", state as unknown as Record<string, unknown>);
    stateDirty = false;
}

function saveStateImmediately() {
    saveState();
    flushState();
}

function isNavigatorOffline() {
    return window.navigator?.onLine === false;
}

function assertProviderOriginAvailable(origin: string) {
    const now = Date.now();
    const originState = state.origins[origin];
    if (originState?.blockedUntil && originState.blockedUntil > now) {
        const warningKey = `${origin}:${originState.blockedUntil}`;
        if (!rateLimitWarnings.has(warningKey)) {
            rateLimitWarnings.add(warningKey);
            Logger.warn("AddonUpdater", `Update checks for ${origin} are paused until the provider's rate limit resets.`);
        }
        throw new AddonUpdateError("rate-limit", "The update provider is temporarily rate limited.", {
            silent: true,
            retryAt: originState.blockedUntil
        });
    }

    if (originState?.blockedUntil) {
        Logger.info("AddonUpdater", `Rate-limit pause ended for ${origin}; update checks are resuming.`);
        delete originState.blockedUntil;
        saveState();
    }
}

async function recordProviderRateLimit(response: Response, initialOrigin: string): Promise<never> {
    const responseOrigin = getAddonUpdateOrigin(response.url) ?? initialOrigin;
    const origins = [...new Set([initialOrigin, responseOrigin])];
    const now = Date.now();
    const inheritedBlockedUntil = Math.max(...origins.map(origin => state.origins[origin]?.blockedUntil ?? 0));
    if (inheritedBlockedUntil > now) {
        const inheritedFailureCount = Math.max(...origins.map(origin => state.origins[origin]?.failureCount ?? 0));
        let changed = false;
        for (const origin of origins) {
            if ((state.origins[origin]?.blockedUntil ?? 0) >= inheritedBlockedUntil
                && (state.origins[origin]?.failureCount ?? 0) >= inheritedFailureCount) continue;
            state.origins[origin] = {
                blockedUntil: inheritedBlockedUntil,
                failureCount: inheritedFailureCount
            };
            changed = true;
        }
        if (changed) saveStateImmediately();
        await response.body?.cancel().catch(() => {});
        throw new AddonUpdateError("rate-limit", "The update provider is temporarily rate limited.", {
            silent: true,
            retryAt: inheritedBlockedUntil
        });
    }
    const failureCount = Math.max(...origins.map(origin => state.origins[origin]?.failureCount ?? 0));
    const rateLimit = getAddonUpdateRateLimitDelay(response.headers, {
        now,
        failureCount,
        jitter: base => Math.min(5_000, Math.max(250, Math.round(base * 0.02 * Math.random())))
    });

    for (const origin of origins) {
        state.origins[origin] = {
            blockedUntil: rateLimit.blockedUntil,
            failureCount: rateLimit.nextFailureCount
        };
    }
    saveStateImmediately();
    await response.body?.cancel().catch(() => {});

    const warningKey = `${responseOrigin}:${rateLimit.blockedUntil}`;
    if (!rateLimitWarnings.has(warningKey)) {
        rateLimitWarnings.add(warningKey);
        Logger.warn("AddonUpdater", `Update checks for ${responseOrigin} were rate limited; retrying after the provider's reset window.`);
    }
    throw new AddonUpdateError("rate-limit", "The update provider is temporarily rate limited.", {
        silent: true,
        retryAt: rateLimit.blockedUntil
    });
}

async function providerFetch(url: string, init: Parameters<typeof fetch>[1] = {}): Promise<Response> {
    const initialOrigin = getAddonUpdateOrigin(url);
    if (!initialOrigin) throw new AddonUpdateError("unsafe", "The update source is not a safe HTTPS URL.");

    assertProviderOriginAvailable(initialOrigin);

    let response: Response;
    try {
        response = await requestLimiter.run(url, async () => {
            // Recheck after waiting in the queue so a 429 from an earlier request cancels the
            // remaining burst before another network slot is released.
            assertProviderOriginAvailable(initialOrigin);
            const result = await fetch(url, {
                ...init,
                headers: init.headers,
                timeout: init.timeout ?? ADDON_DOWNLOAD_TIMEOUT_MS,
                maxRedirects: init.maxRedirects ?? MAX_ADDON_REDIRECTS,
                httpsOnly: true
            });
            if (isAddonUpdateRateLimitResponse(result.status, result.headers)) return recordProviderRateLimit(result, initialOrigin);
            return result;
        });
    }
    catch (error) {
        const failure = asError(error);
        if (failure.name === "UnsafeRedirectError") throw new AddonUpdateError("unsafe", "The update source redirected to an unsafe URL.", {cause: failure});
        if (failure.name === "ResponseSizeError") throw new AddonUpdateError("invalid", `The addon exceeded the ${ADDON_DOWNLOAD_LIMIT_BYTES / 1024 / 1024} MiB safety limit.`, {cause: failure});
        if (/timed out/i.test(failure.message)) throw new AddonUpdateError("timeout", "The update source timed out.", {cause: failure});
        throw failure;
    }

    const responseOrigin = getAddonUpdateOrigin(response.url) ?? initialOrigin;
    let clearedRateLimit = false;
    for (const origin of new Set([initialOrigin, responseOrigin])) {
        if (!state.origins[origin]?.failureCount) continue;
        Logger.info("AddonUpdater", `Update requests to ${origin} are succeeding again.`);
        delete state.origins[origin];
        clearedRateLimit = true;
    }
    if (clearedRateLimit) saveState();

    return response;
}

function appendApiPath(input: string, suffix: string): string {
    const url = new URL(input);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
    return url.toString();
}

function getNestedString(value: unknown, ...keys: string[]): string | null {
    let current = value;
    for (const key of keys) {
        if (!current || typeof current !== "object" || !(key in current)) return null;
        current = (current as Record<string, unknown>)[key];
    }
    return typeof current === "string" ? current : null;
}

function collectDescriptorFiles(value: unknown, descriptor: AddonUpdateDescriptor): DescriptorFile[] {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const files: DescriptorFile[] = [];

    if (descriptor.kind === "github-gist" && record.files && typeof record.files === "object") {
        for (const [fallbackName, entry] of Object.entries(record.files as Record<string, unknown>)) {
            if (!entry || typeof entry !== "object") continue;
            const item = entry as Record<string, unknown>;
            const filename = typeof item.filename === "string" ? item.filename : fallbackName;
            const rawUrl = typeof item.raw_url === "string" ? item.raw_url : null;
            if (rawUrl) files.push({filename, rawUrl});
        }
    }

    if (descriptor.kind === "gitlab-snippet" && Array.isArray(record.files)) {
        for (const entry of record.files) {
            if (!entry || typeof entry !== "object") continue;
            const item = entry as Record<string, unknown>;
            const filename = typeof item.path === "string" ? item.path : typeof item.name === "string" ? item.name : null;
            const rawUrl = typeof item.raw_url === "string" ? item.raw_url : typeof item.rawUrl === "string" ? item.rawUrl : null;
            if (filename && rawUrl) files.push({filename, rawUrl});
        }
    }

    if (descriptor.kind === "gitlab-snippet" && files.length === 0 && descriptor.metadataFallback) {
        const filename = record[descriptor.metadataFallback.filenameField];
        const rawUrl = record[descriptor.metadataFallback.rawUrlField];
        if (typeof filename === "string" && typeof rawUrl === "string") files.push({filename, rawUrl});
    }

    if (descriptor.kind === "bitbucket-snippet") {
        const source = record.files && typeof record.files === "object" ? record.files as Record<string, unknown> : record;
        const entries = Array.isArray(record.values)
            ? record.values.map((entry, index) => [String(index), entry] as const)
            : Object.entries(source);
        for (const [fallbackName, entry] of entries) {
            if (!entry || typeof entry !== "object") continue;
            const item = entry as Record<string, unknown>;
            const filename = typeof item.path === "string" ? item.path : typeof item.name === "string" ? item.name : fallbackName;
            const rawUrl = getNestedString(item, "links", "self", "href") ?? getNestedString(item, "links", "raw", "href");
            if (rawUrl) files.push({filename, rawUrl});
        }
    }

    return files;
}

function getDescriptorNextPage(value: unknown, currentUrl: string): string | null {
    if (!value || typeof value !== "object") return null;
    const next = (value as Record<string, unknown>).next;
    if (typeof next !== "string") return null;

    try {
        const current = new URL(currentUrl);
        const candidate = new URL(next, current);
        if (candidate.protocol !== "https:" || candidate.username || candidate.password || candidate.origin !== current.origin) {
            throw new AddonUpdateError("unsafe", "The snippet API returned an unsafe pagination URL.");
        }
        return candidate.toString();
    }
    catch (error) {
        if (error instanceof AddonUpdateError) throw error;
        throw new AddonUpdateError("unsafe", "The snippet API returned an invalid pagination URL.", {cause: error});
    }
}

async function fetchDescriptorJson(url: string): Promise<unknown> {
    const response = await providerFetch(url, {
        headers: {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": "BetterDiscord Addon Updater"
        },
        maxResponseBytes: DESCRIPTOR_LIMIT_BYTES
    });
    if (response.status === 404 || response.status === 410) throw new AddonUpdateError("not-found", "The declared update source does not exist.", {silent: true});
    if (!response.ok) {
        throw new AddonUpdateError("http", `The provider API returned HTTP ${response.status}.`, {
            retryable: response.status === 408 || response.status === 425 || response.status >= 500
        });
    }
    try {
        return await response.json();
    }
    catch (error) {
        throw new AddonUpdateError("invalid", "The provider API returned invalid metadata.", {cause: error});
    }
}

async function resolveDescriptor(descriptor: AddonUpdateDescriptor): Promise<NormalizedAddonUpdateUrl> {
    return queueDescriptorRequest(async () => {
        let json = await fetchDescriptorJson(descriptor.apiUrl);
        const files = collectDescriptorFiles(json, descriptor);

        if (descriptor.kind === "bitbucket-snippet" && files.length === 0) {
            let pageUrl: string | null = getNestedString(json, "links", "files", "href") ?? appendApiPath(descriptor.apiUrl, "files");
            let pageCount = 0;
            while (pageUrl && pageCount < MAX_DESCRIPTOR_PAGES) {
                json = await fetchDescriptorJson(pageUrl);
                files.push(...collectDescriptorFiles(json, descriptor));
                pageCount++;
                pageUrl = getDescriptorNextPage(json, pageUrl);
            }
            if (pageUrl) throw new AddonUpdateError("invalid", "The snippet file list exceeded the safe pagination limit.");
        }

        const addonFiles = files.filter(file => isAddonUpdateFilename(file.filename));
        const expected = descriptor.expectedFilename?.toLowerCase();
        const exact = expected
            ? addonFiles.filter(file => path.basename(file.filename).toLowerCase() === expected)
            : [];
        const selected = exact.length === 1 ? exact[0] : !exact.length && addonFiles.length === 1 ? addonFiles[0] : null;
        if (!selected) throw new AddonUpdateError("invalid", "The gist or snippet did not identify one unambiguous addon file.");

        const normalized = normalizeAddonUpdateUrl(selected.rawUrl, {expectedFilename: descriptor.expectedFilename ?? undefined});
        if (!normalized.valid || normalized.resolution !== "direct" || !normalized.fetchUrl) {
            throw new AddonUpdateError("unsafe", "The gist or snippet returned an unsafe addon URL.");
        }
        return normalized;
    });
}

async function resolveUpdateUrl(input: string, filename: string): Promise<NormalizedAddonUpdateUrl> {
    const normalized = normalizeAddonUpdateUrl(input, {expectedFilename: filename});
    if (!normalized.valid) throw new AddonUpdateError("unsafe", `The declared update URL was rejected (${normalized.reason}).`);
    if (normalized.resolution === "descriptor") return resolveDescriptor(normalized.descriptor!);
    if (!normalized.fetchUrl) throw new AddonUpdateError("invalid", "The update source did not resolve to an addon file.");
    return normalized;
}

async function fetchRawBody(fetchUrl: string, options: {useMemory: boolean; useValidators: boolean;}): Promise<RawFetchResult> {
    const fingerprint = getAddonUpdateUrlFingerprint(fetchUrl);
    if (options.useMemory) {
        const cached = memoryBodies.get(fingerprint);
        if (cached) {
            // Promote on use so the budget behaves as a small LRU rather than FIFO.
            memoryBodies.delete(fingerprint);
            memoryBodies.set(fingerprint, cached);
            return {kind: "body", fingerprint, ...cached};
        }
    }

    const active = activeRawRequests.get(fingerprint);
    if (active) return active;

    const request = (async (): Promise<RawFetchResult> => {
        const urlState = state.urls[fingerprint] ??= {};
        const now = Date.now();
        if (isNegativeLookupActive(urlState.negativeLookupUntil, now)) return {kind: "not-found", fingerprint};

        const headers: Record<string, string> = {
            "Accept": "text/plain, application/javascript, text/css;q=0.9, */*;q=0.1",
            "Accept-Encoding": "identity",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "BetterDiscord Addon Updater"
        };
        if (options.useValidators && urlState.etag) headers["If-None-Match"] = urlState.etag;
        if (options.useValidators && urlState.lastModified) headers["If-Modified-Since"] = urlState.lastModified;

        const response = await providerFetch(fetchUrl, {
            headers,
            maxResponseBytes: ADDON_DOWNLOAD_LIMIT_BYTES
        });

        if (response.status === 404 || response.status === 410) {
            urlState.lastCheckedAt = now;
            urlState.negativeLookupUntil = getNegativeLookupUntil(now, MISSING_SOURCE_COOLDOWN_MS);
            saveState();
            return {kind: "not-found", fingerprint};
        }
        if (response.status === 304) {
            urlState.lastCheckedAt = now;
            saveState();
            return {kind: "not-modified", fingerprint};
        }
        if (!response.ok) {
            throw new AddonUpdateError("http", `The update source returned HTTP ${response.status}.`, {
                retryable: response.status === 408 || response.status === 425 || response.status >= 500
            });
        }

        const encoding = response.headers.get("content-encoding");
        if (encoding && encoding.toLowerCase() !== "identity") {
            throw new AddonUpdateError("invalid", "The update source ignored the safe identity-encoding request.");
        }

        let bytes: Uint8Array;
        try {
            bytes = new Uint8Array(await response.arrayBuffer());
        }
        catch (error) {
            const failure = asError(error);
            if (failure.name === "ResponseSizeError" || /byte limit/i.test(failure.message)) {
                throw new AddonUpdateError("invalid", `The addon exceeded the ${ADDON_DOWNLOAD_LIMIT_BYTES / 1024 / 1024} MiB safety limit.`, {cause: failure});
            }
            throw failure;
        }

        let text: string;
        try {
            text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
        }
        catch (error) {
            throw new AddonUpdateError("invalid", "The update source was not valid UTF-8 addon text.", {cause: error});
        }

        const hash = getAddonUpdateContentHash(bytes);
        urlState.lastCheckedAt = now;
        delete urlState.negativeLookupUntil;
        const etag = response.headers.get("etag");
        const lastModified = response.headers.get("last-modified");
        if (etag) urlState.etag = etag;
        else delete urlState.etag;
        if (lastModified) urlState.lastModified = lastModified;
        else delete urlState.lastModified;
        urlState.contentHash = hash;
        storeMemoryBody(fingerprint, {bytes, text, hash});
        saveState();
        return {kind: "body", fingerprint, bytes, text, hash};
    })();

    activeRawRequests.set(fingerprint, request);
    void request.finally(() => activeRawRequests.delete(fingerprint)).catch(() => {});
    return request;
}

function logCheckFailure(filename: string, error: unknown) {
    const failure = asError(error);
    if (failure instanceof AddonUpdateError && failure.silent) return;

    if (failure instanceof AddonUpdateError && ["http", "timeout", "invalid", "unsafe"].includes(failure.code)) {
        Logger.warn("AddonUpdater", `Could not check the declared update source for '${filename}': ${safeFailureReason(failure)}`, safeErrorForLog(failure));
        return;
    }
    Logger.stacktrace("AddonUpdater", `Unexpected failure while checking '${filename}'`, safeErrorForLog(failure));
}

function rejectCachedBody(fingerprint: string) {
    deleteMemoryBody(fingerprint);

    // The response validators are allowed to remain so a later 304 can be followed by one
    // unconditional refetch, but metadata from the previously valid body must never be paired
    // with the newly rejected ETag/hash.
    const urlState = state.urls[fingerprint];
    if (!urlState?.metadata) return;
    delete urlState.metadata;
    saveState();
}

function validateBodyForCandidate(
    addon: Addon,
    normalized: NormalizedAddonUpdateUrl,
    raw: RawBodyResult,
    source: AddonUpdateSource,
    fallbackIdentity?: AddonIdentityResult
): Candidate {
    const validation = validateAddonContent(addon.filename, raw.text, source === "store" ? addon.filename.endsWith(".plugin.js") ? "plugin" : "theme" : undefined);
    if (!validation.ok) {
        rejectCachedBody(raw.fingerprint);
        throw new AddonUpdateError("invalid", validation.reason);
    }
    if (!sameAddonName(addon.name, validation.metadata.name)) {
        rejectCachedBody(raw.fingerprint);
        throw new AddonUpdateError("invalid", "The downloaded addon's metadata name does not match the installed addon.");
    }

    const installedUpdateUrl = getInstalledUpdateUrl(addon);
    let identity = compareAddonIdentity(
        getInstalledIdentity(addon, installedUpdateUrl),
        getMetadataIdentity(validation.metadata, normalized.repositoryIdentity)
    );
    if (source === "update-url") identity = approvedDeclaredUrlIdentity(identity, addon.name, validation.metadata.name);
    else if (fallbackIdentity?.status === "eligible" && identity.status === "unknown") identity = fallbackIdentity;
    if (identity.status !== "eligible") {
        rejectCachedBody(raw.fingerprint);
        throw new AddonUpdateError("invalid", "The downloaded addon's repository and author identity do not match the installed addon.");
    }

    const urlState = state.urls[raw.fingerprint] ??= {};
    urlState.metadata = toCachedMetadata(addon.filename, validation.metadata, normalized.repositoryIdentity);
    urlState.contentHash = raw.hash;
    saveState();

    return {
        source,
        version: validation.metadata.version,
        identity,
        data: {
            filename: addon.filename,
            name: validation.metadata.name,
            fetchUrl: normalized.fetchUrl!,
            provider: normalized.provider,
            repositoryIdentity: normalized.repositoryIdentity,
            metadata: validation.metadata
        }
    };
}

function candidateFromCached(
    addon: Addon,
    normalized: NormalizedAddonUpdateUrl,
    fingerprint: string,
    source: AddonUpdateSource,
    fallbackIdentity?: AddonIdentityResult
): Candidate | null {
    const cached = state.urls[fingerprint]?.metadata;
    if (!cached || cached.filename.toLowerCase() !== addon.filename.toLowerCase() || cached.type !== (addon.filename.endsWith(".plugin.js") ? "plugin" : "theme")) return null;

    const metadata = fromCachedMetadata(cached);
    if (!sameAddonName(addon.name, metadata.name)) return null;
    let identity = compareAddonIdentity(
        getInstalledIdentity(addon, getInstalledUpdateUrl(addon)),
        getMetadataIdentity(metadata, cached.repositoryIdentity ?? normalized.repositoryIdentity)
    );
    if (source === "update-url") identity = approvedDeclaredUrlIdentity(identity, addon.name, metadata.name);
    else if (fallbackIdentity?.status === "eligible" && identity.status === "unknown") identity = fallbackIdentity;

    return {
        source,
        version: metadata.version,
        identity,
        data: {
            filename: addon.filename,
            name: metadata.name,
            fetchUrl: normalized.fetchUrl!,
            provider: normalized.provider,
            repositoryIdentity: cached.repositoryIdentity ?? normalized.repositoryIdentity,
            metadata
        }
    };
}

function restoreDeclaredCandidate(addon: Addon, type: AddonType): Candidate | null {
    const updateUrl = getInstalledUpdateUrl(addon);
    if (!updateUrl) return null;

    const addonState = state.addons[getAddonUpdateKey(type, addon.filename)];
    const declaredFingerprint = getAddonUpdateUrlFingerprint(updateUrl.trim());
    const resolvedFingerprint = addonState?.resolvedUrlFingerprint;
    if (addonState?.urlFingerprint !== declaredFingerprint || !resolvedFingerprint) return null;

    const cached = state.urls[resolvedFingerprint]?.metadata;
    if (!cached) return null;

    const input = normalizeAddonUpdateUrl(updateUrl, {expectedFilename: addon.filename});
    if (!input.valid) return null;

    let fetchUrl: string;
    let resolveDeclared = false;
    if (input.resolution === "direct" && input.fetchUrl) {
        if (getAddonUpdateUrlFingerprint(input.fetchUrl) !== resolvedFingerprint) return null;
        fetchUrl = input.fetchUrl;
    }
    else {
        // The raw descriptor result is intentionally not persisted. Keep the installed declaration
        // only in memory and resolve it again if the user installs this restored pending update.
        fetchUrl = updateUrl;
        resolveDeclared = true;
    }

    const normalized: NormalizedAddonUpdateUrl = {
        ...input,
        fetchUrl,
        repositoryIdentity: cached.repositoryIdentity ?? input.repositoryIdentity,
        resolution: "direct",
        descriptor: null
    };
    const candidate = candidateFromCached(addon, normalized, resolvedFingerprint, "update-url");
    if (candidate?.data) candidate.data.resolveDeclared = resolveDeclared;
    return candidate;
}

async function inspectDeclaredUrl(
    addon: Addon,
    updateUrl: string,
    options: {forceNetwork: boolean; intervalMs: number;}
): Promise<{candidate: Candidate | null; settled: boolean; retryAt?: number;}> {
    const addonKey = getAddonUpdateKey(addon.filename.endsWith(".plugin.js") ? "plugin" : "theme", addon.filename);
    const addonState = state.addons[addonKey] ??= {};
    const declaredFingerprint = getAddonUpdateUrlFingerprint(updateUrl.trim());
    const resolutionCacheKey = `${addonKey}:${declaredFingerprint}`;
    const rememberResolved = (fingerprint: string) => {
        if (addonState.resolvedUrlFingerprint === fingerprint) return;
        addonState.resolvedUrlFingerprint = fingerprint;
        saveState();
    };
    const forgetResolved = () => {
        if (!addonState.resolvedUrlFingerprint) return;
        delete addonState.resolvedUrlFingerprint;
        saveState();
    };
    if (addonState.urlFingerprint !== declaredFingerprint) {
        // A changed metadata URL must not inherit freshness or validators from the old target.
        if (addonState.urlFingerprint) resolvedUpdateUrls.delete(`${addonKey}:${addonState.urlFingerprint}`);
        addonState.urlFingerprint = declaredFingerprint;
        delete addonState.lastCheckedAt;
        delete addonState.negativeLookupUntil;
        delete addonState.resolvedUrlFingerprint;
        saveState();
    }

    if (isNegativeLookupActive(addonState.negativeLookupUntil, Date.now())) return {candidate: null, settled: true};

    try {
        const cachedResolution = resolvedUpdateUrls.get(resolutionCacheKey);
        if (!options.forceNetwork && cachedResolution?.fetchUrl) {
            const cachedFingerprint = getAddonUpdateUrlFingerprint(cachedResolution.fetchUrl);
            if (!isAddonCheckStale(state.urls[cachedFingerprint]?.lastCheckedAt, options.intervalMs, Date.now())) {
                rememberResolved(cachedFingerprint);
                return {
                    candidate: candidateFromCached(addon, cachedResolution, cachedFingerprint, "update-url"),
                    settled: true
                };
            }
        }

        const normalized = await resolveUpdateUrl(updateUrl, addon.filename);
        resolvedUpdateUrls.set(resolutionCacheKey, normalized);
        const normalizedFingerprint = getAddonUpdateUrlFingerprint(normalized.fetchUrl!);
        if (!options.forceNetwork && !isAddonCheckStale(state.urls[normalizedFingerprint]?.lastCheckedAt, options.intervalMs, Date.now())) {
            rememberResolved(normalizedFingerprint);
            return {
                candidate: candidateFromCached(addon, normalized, normalizedFingerprint, "update-url"),
                settled: true
            };
        }

        const raw = await fetchRawBody(normalized.fetchUrl!, {useMemory: false, useValidators: true});
        if (raw.kind === "not-found") {
            addonState.negativeLookupUntil = getNegativeLookupUntil(Date.now(), MISSING_SOURCE_COOLDOWN_MS);
            rejectCachedBody(raw.fingerprint);
            forgetResolved();
            saveState();
            return {candidate: null, settled: true};
        }
        if (raw.kind === "not-modified") {
            const cached = candidateFromCached(addon, normalized, raw.fingerprint, "update-url");
            if (cached) {
                delete addonState.negativeLookupUntil;
                rememberResolved(raw.fingerprint);
                return {candidate: cached, settled: true};
            }

            const refreshed = await fetchRawBody(normalized.fetchUrl!, {useMemory: false, useValidators: false});
            if (refreshed.kind !== "body") return {candidate: null, settled: refreshed.kind === "not-found"};
            delete addonState.negativeLookupUntil;
            const candidate = validateBodyForCandidate(addon, normalized, refreshed, "update-url");
            rememberResolved(refreshed.fingerprint);
            return {candidate, settled: true};
        }
        delete addonState.negativeLookupUntil;
        const candidate = validateBodyForCandidate(addon, normalized, raw, "update-url");
        rememberResolved(raw.fingerprint);
        return {candidate, settled: true};
    }
    catch (error) {
        const failure = asError(error);
        if (failure instanceof AddonUpdateError && failure.code === "not-found") {
            addonState.negativeLookupUntil = getNegativeLookupUntil(Date.now(), MISSING_SOURCE_COOLDOWN_MS);
            forgetResolved();
            saveState();
            return {candidate: null, settled: true};
        }

        logCheckFailure(addon.filename, failure);
        if (failure instanceof AddonUpdateError && !failure.retryable) {
            forgetResolved();
            return {candidate: null, settled: true};
        }
        const retryAt = failure instanceof AddonUpdateError && failure.code === "rate-limit" && failure.retryAt !== undefined
            ? Math.max(Date.now() + MINIMUM_SCHEDULE_DELAY_MS, failure.retryAt)
            : Date.now() + TRANSIENT_RETRY_MS;
        return {candidate: null, settled: false, retryAt};
    }
}

function inspectStore(addon: Addon, info: StoreAddon | undefined): Candidate | null {
    if (!info || info.version === "Unknown") return null;

    const identity = compareAddonIdentity(
        getInstalledIdentity(addon, getInstalledUpdateUrl(addon)),
        getStoreIdentity(info)
    );
    if (identity.status !== "eligible") {
        if (identity.status === "rejected") {
            const warningKey = `${addon.filename.toLowerCase()}:${identity.candidateRepositories.join(",")}`;
            if (!collisionWarnings.has(warningKey)) {
                collisionWarnings.add(warningKey);
                Logger.warn("AddonUpdater", `Ignored the Addon Store row for '${addon.filename}' because its repository and author identity do not match the installed addon.`);
            }
        }
        return null;
    }

    const normalized = normalizeAddonUpdateUrl(info.latestSourceUrl, {expectedFilename: addon.filename});
    if (!normalized.valid || normalized.resolution !== "direct" || !normalized.fetchUrl) {
        Logger.warn("AddonUpdater", `Ignored the Addon Store row for '${addon.filename}' because its source URL was not a safe direct addon file.`);
        return null;
    }

    return {
        source: "store",
        version: info.version,
        identity,
        data: {
            filename: addon.filename,
            name: info.name,
            fetchUrl: normalized.fetchUrl,
            provider: normalized.provider,
            repositoryIdentity: normalized.repositoryIdentity
        }
    };
}

function orderCandidates(installedVersion: string, candidates: Candidate[]): Candidate[] {
    const remaining = candidates.slice();
    const ordered: Candidate[] = [];
    while (remaining.length) {
        const selected = chooseAddonUpdateCandidate(installedVersion, remaining);
        if (!selected) break;
        ordered.push(selected);
        remaining.splice(remaining.indexOf(selected), 1);
    }
    return ordered;
}

function sameCandidate(left: Candidate, right: Candidate): boolean {
    return left.source === right.source
        && left.version === right.version
        && left.identity.status === right.identity.status
        && left.identity.repository === right.identity.repository
        && left.identity.authorId === right.identity.authorId
        && left.identity.author === right.identity.author
        && left.data?.fetchUrl === right.data?.fetchUrl
        && left.data?.name === right.data?.name;
}

function sameCandidates(left: readonly Candidate[] | undefined, right: readonly Candidate[]) {
    return Boolean(left)
        && left!.length === right.length
        && left!.every((candidate, index) => sameCandidate(candidate, right[index]));
}

async function materializeCandidate(addon: Addon, candidate: Candidate): Promise<Candidate & {data: UpdateSourceDetails & {bytes: Uint8Array;};}> {
    const normalized = candidate.source === "update-url" && candidate.data?.resolveDeclared
        ? await resolveUpdateUrl(getInstalledUpdateUrl(addon) ?? "", addon.filename)
        : normalizeAddonUpdateUrl(candidate.data!.fetchUrl, {expectedFilename: addon.filename});
    if (!normalized.valid || normalized.resolution !== "direct" || !normalized.fetchUrl) {
        throw new AddonUpdateError("unsafe", "The selected update source is no longer a safe direct URL.");
    }

    let raw = await fetchRawBody(normalized.fetchUrl, {useMemory: true, useValidators: true});
    if (raw.kind === "not-modified") raw = await fetchRawBody(normalized.fetchUrl, {useMemory: false, useValidators: false});
    if (raw.kind === "not-found") throw new AddonUpdateError("not-found", "The selected update source no longer exists.", {silent: true});
    if (raw.kind !== "body") throw new AddonUpdateError("invalid", "The selected update source returned no addon body.");

    try {
        const materialized = validateBodyForCandidate(addon, normalized, raw, candidate.source, candidate.identity);
        return {
            ...materialized,
            data: {...materialized.data!, bytes: raw.bytes}
        };
    }
    finally {
        // The attempt retains its exact checked bytes above. The shared cache is only needed until
        // materialization and must not retain descriptor-resolved raw URLs after the row settles.
        deleteMemoryBody(raw.fingerprint);
    }
}

function showFailureNotification(failures: AddonUpdateFailure[], forceBatch = false) {
    if (!failures.length || !SettingsStore.get("addons", "addonUpdateNotifications")) return;

    const id = `addon-update-failure-${Date.now()}-${++failureNotificationSequence}`;
    const isBatch = forceBatch || failures.length > 1;
    Notifications.show({
        id,
        title: isBatch ? t("Updater.addonUpdateBatchFailedTitle") : t("Updater.addonUpdateFailedTitle"),
        content: isBatch
            ? t("Updater.addonUpdateBatchFailed", {count: failures.length})
            : t("Updater.addonUpdateFailedPersistent", {name: failures[0].name}),
        type: "error",
        duration: Infinity,
        actions: isBatch ? [{
            label: t("Updater.viewFailures"),
            onClick: () => {
                Modals.showConfirmationModal(
                    t("Updater.addonUpdateBatchFailedTitle"),
                    React.createElement("ul", {className: "bd-notification-updates-list"}, failures.map(failure =>
                        React.createElement("li", {key: failure.filename}, [
                            React.createElement("strong", {key: "name"}, failure.name),
                            ` — ${failure.reason}`
                        ])
                    )),
                    {cancelText: null}
                );
            }
        }] : undefined
    });
}

export class AddonUpdater {
    manager: AddonManager;
    type: AddonType;
    pending: string[] = [];
    #candidates = new Map<string, Candidate[]>();
    #attempts = new Map<string, UpdateAttempt>();
    #batchUpdate: Promise<void> | null = null;
    #noticeVisible = false;

    constructor(type: AddonType) {
        this.manager = type === "plugin" ? PluginManager : ThemeManager;
        this.type = type;
    }

    initialize() {
        Events.on(`${this.type}-read`, (addon: Addon) => AddonUpdateCoordinator.queueEventCheck(this, addon));
        Events.on(`${this.type}-unloaded`, (addon: Addon) => {
            this.removePending(addon.filename);
            AddonUpdateCoordinator.cancelEventCheck(this.type, addon.filename);
            // reloadAddon emits `unloaded` between its synchronous remove/re-read steps. Defer the
            // inventory decision so ordinary edits/replacements keep freshness, while a genuinely
            // deleted file remains absent and is pruned at the end of the turn.
            queueMicrotask(() => {
                AddonUpdateCoordinator.pruneMissingAddons();
                AddonUpdateCoordinator.scheduleNextCheck();
            });
        });
    }

    async checkAll(showNotice = true) {
        await AddonUpdateCoordinator.checkUpdaters([this], {reason: "manual", force: true, showNotice});
    }

    getStoreAddon(filename: string) {
        const basename = path.basename(filename).toLowerCase();
        return AddonStore.getAddons().find(addon => addon.type === this.type && addon.filename.toLowerCase() === basename);
    }

    getUpdateCandidate(filename: string): Candidate | null {
        return chooseAddonUpdateCandidate(
            this.manager.addonList.find(addon => addon.filename === filename)?.version ?? "",
            this.#candidates.get(filename) ?? []
        );
    }

    reconcilePending(filename: string) {
        if (this.pending.includes(filename) && !this.getUpdateCandidate(filename)) this.removePending(filename);
    }

    setCandidates(filename: string, installedVersion: string, candidates: Candidate[]) {
        const ordered = orderCandidates(installedVersion, candidates);
        if (!ordered.length) {
            this.removePending(filename);
            return;
        }

        const previous = this.#candidates.get(filename);
        if (previous) {
            const retainedUrls = new Set(ordered.map(candidate => candidate.data?.fetchUrl).filter(Boolean));
            forgetCandidateBodies(previous.filter(candidate => !retainedUrls.has(candidate.data?.fetchUrl)));
        }
        const retainedUrls = new Set(ordered.map(candidate => candidate.data?.fetchUrl).filter(Boolean));
        forgetCandidateBodies(candidates.filter(candidate => !retainedUrls.has(candidate.data?.fetchUrl)));
        const changed = !sameCandidates(previous, ordered) || !this.pending.includes(filename);
        this.#candidates.set(filename, ordered);
        if (!this.pending.includes(filename)) this.pending.push(filename);
        if (changed) {
            Events.emit("addon-updates-changed");
            if (this.#noticeVisible) this.showUpdateNotice();
        }
    }

    removePending(filename: string) {
        const candidates = this.#candidates.get(filename);
        if (candidates) forgetCandidateBodies(candidates);
        this.#candidates.delete(filename);
        const index = this.pending.indexOf(filename);
        if (index >= 0) this.pending.splice(index, 1);
        if (candidates || index >= 0) {
            Events.emit("addon-updates-changed");
            if (this.#noticeVisible) this.showUpdateNotice();
        }
    }

    async updateAddon(filename: string, options: {suppressFailureCard?: boolean;} = {}): Promise<boolean> {
        const existing = this.#attempts.get(filename);
        if (existing) return (await existing.promise).success;

        const promise = this.#performUpdate(filename);
        this.#attempts.set(filename, {promise});
        try {
            const result = await promise;
            if (!result.success && result.failure?.notify !== false && result.failure && !options.suppressFailureCard) {
                showFailureNotification([result.failure]);
            }
            return result.success;
        }
        finally {
            this.#attempts.delete(filename);
            flushState();
        }
    }

    async updateAll(filenames = this.pending.slice()): Promise<void> {
        if (this.#batchUpdate) return this.#batchUpdate;

        const batch = this.#performUpdateAll(filenames);
        this.#batchUpdate = batch;
        try {await batch;}
        finally {
            if (this.#batchUpdate === batch) this.#batchUpdate = null;
        }
    }

    async #performUpdateAll(filenames: string[]): Promise<void> {
        const failures: AddonUpdateFailure[] = [];
        try {
            for (const filename of filenames) {
                // Another single/batch action may have installed this row while this sequential
                // batch was waiting. A no-longer-pending filename is already settled.
                if (!this.pending.includes(filename)) continue;
                const existing = this.#attempts.get(filename);
                let result: AddonUpdateResult;
                if (existing) {
                    // The action that created the shared attempt owns its success/failure UI.
                    // Joining here must not duplicate a single card inside a batch summary.
                    await existing.promise;
                    continue;
                }
                else {
                    const promise = this.#performUpdate(filename);
                    this.#attempts.set(filename, {promise});
                    try {result = await promise;}
                    finally {this.#attempts.delete(filename);}
                }
                if (!result.success && result.failure?.notify !== false && result.failure) failures.push(result.failure);
            }
        }
        finally {
            flushState();
        }
        showFailureNotification(failures, true);
    }

    async #performUpdate(filename: string): Promise<AddonUpdateResult> {
        const addon = this.manager.addonList.find(entry => entry.filename === filename);
        const candidates = this.#candidates.get(filename) ?? [];
        if (!addon || !candidates.length) {
            const failure = {filename, name: addon?.name ?? filename, reason: "No validated update candidate is available."};
            Logger.warn("AddonUpdater", `Could not update '${filename}': ${failure.reason}`);
            return {success: false, failure};
        }

        const destination = path.resolve(this.manager.addonFolder, filename);
        if (path.basename(filename) !== filename || path.dirname(destination) !== path.resolve(this.manager.addonFolder)) {
            const reason = "The installed addon filename is not safe to replace.";
            Logger.warn("AddonUpdater", `Could not safely update '${filename}': ${reason}`);
            return {success: false, failure: {filename, name: addon.name, reason}};
        }

        let installedFile: {modified: number; fileContent: string;};
        try {
            installedFile = await Remote.filesystem.readFileSnapshotAsync(destination);
        }
        catch (error) {
            const failure = asError(error);
            const reason = "The installed addon could not be read safely; the update was cancelled.";
            Logger.stacktrace("AddonUpdater", `Could not snapshot '${filename}' before updating it.`, failure);
            return {success: false, failure: {filename, name: addon.name, reason}};
        }

        const installedMetadata = validateAddonContent(filename, installedFile.fileContent);
        if (installedFile.modified !== addon.modified
            || !installedMetadata.ok
            || !sameAddonName(addon.name, installedMetadata.metadata.name)
            || addon.version !== installedMetadata.metadata.version) {
            const reason = "The installed addon changed before its update could start; the update was cancelled.";
            Logger.warn("AddonUpdater", `Cancelled the update for '${filename}' because its on-disk snapshot no longer matches the loaded addon.`);
            AddonUpdateCoordinator.queueEventCheck(this, addon);
            return {success: false, failure: {filename, name: addon.name, reason}};
        }

        const installedSnapshot = {
            version: addon.version,
            updateUrl: getInstalledUpdateUrl(addon),
            modified: installedFile.modified,
            fileContent: installedFile.fileContent
        };

        const materialized: Array<Candidate & {data: UpdateSourceDetails & {bytes: Uint8Array;};}> = [];
        const sourceFailures: Error[] = [];
        for (const candidate of candidates) {
            try {
                materialized.push(await materializeCandidate(addon, candidate));
            }
            catch (error) {
                const failure = asError(error);
                sourceFailures.push(failure);
                if (!(failure instanceof AddonUpdateError && failure.silent)) {
                    Logger.warn("AddonUpdater", `The ${candidate.source} candidate for '${filename}' could not be used: ${safeFailureReason(failure)}`, safeErrorForLog(failure));
                }
            }
        }

        const selected = chooseAddonUpdateCandidate(installedSnapshot.version, materialized);
        if (!selected?.data) {
            const firstFailure = sourceFailures[0];
            const rateLimitedOnly = sourceFailures.length === candidates.length && sourceFailures.every(
                failure => failure instanceof AddonUpdateError && failure.code === "rate-limit"
            );
            const reason = firstFailure instanceof AddonUpdateError && firstFailure.code === "rate-limit"
                ? "The update could not be completed."
                : firstFailure
                    ? safeFailureReason(firstFailure)
                    : "No validated source still offers a newer comparable version.";
            const failure = {filename, name: addon.name, reason, notify: !rateLimitedOnly};
            Logger.warn("AddonUpdater", `Failed to update '${filename}'. The installed copy was left unchanged: ${reason}`);
            return {success: false, failure};
        }

        const currentAddon = this.manager.addonList.find(entry => entry.filename === filename);
        if (!currentAddon
            || currentAddon !== addon
            || currentAddon.version !== installedSnapshot.version
            || currentAddon.modified !== installedSnapshot.modified
            || getInstalledUpdateUrl(currentAddon) !== installedSnapshot.updateUrl) {
            const reason = "The installed addon changed while its update was being prepared; the update was cancelled.";
            Logger.warn("AddonUpdater", `Cancelled the update for '${filename}' because the installed file changed before replacement.`);
            if (currentAddon) AddonUpdateCoordinator.queueEventCheck(this, currentAddon);
            return {success: false, failure: {filename, name: currentAddon?.name ?? addon.name, reason}};
        }

        try {
            // Fork review: only a fully validated, in-memory body is written, and the asynchronous
            // bridge must settle before pending UI state or success notices are changed.
            await Remote.filesystem.writeFileAsync(destination, selected.data.bytes, {
                modified: installedSnapshot.modified,
                fileContent: installedSnapshot.fileContent
            });
            this.removePending(filename);

            if (SettingsStore.get("addons", "addonUpdateNotifications")) {
                Toasts.success(t("Updater.addonUpdated", {name: selected.data.name, version: selected.version}));
            }
            return {success: true};
        }
        catch (error) {
            const failure = asError(error);
            Logger.stacktrace("AddonUpdater", `Failed to write the update for '${filename}'. The installed copy was left unchanged.`, failure);
            return {
                success: false,
                failure: {filename, name: addon.name, reason: safeFailureReason(failure)}
            };
        }
    }

    showUpdateNotice() {
        const id = `addon-updates-${this.type}`;
        if (this.#noticeVisible) Notifications.hide(id);
        if (!this.pending.length) {
            this.#noticeVisible = false;
            return;
        }

        const details = this.pending.map(filename => {
            const candidate = this.getUpdateCandidate(filename);
            return {name: candidate?.data?.name ?? filename, version: candidate?.version ?? ""};
        });

        Notifications.show({
            id,
            title: t("Updater.addonUpdaterNotificationTitle"),
            content: [
                t("Updater.addonUpdatesAvailable", {count: this.pending.length, context: this.type}),
                React.createElement("ul", {className: "bd-notification-updates-list"}, details.map(detail =>
                    React.createElement("li", {key: `${detail.name}:${detail.version}`}, [
                        detail.name, " ", React.createElement("i", {key: "version"}, `(${detail.version})`)
                    ])
                ))
            ],
            type: "info",
            icon: () => React.createElement(Logo, {size: 16, accent: true}),
            duration: Infinity,
            onClose: () => {this.#noticeVisible = false;},
            actions: [
                {label: t("Updater.viewUpdates"), onClick: () => Settings.openSettingsPage("updates")},
                {label: t("Updater.updateAll"), onClick: () => void this.updateAll()}
            ]
        });
        this.#noticeVisible = true;
    }
}

interface CheckOptions {
    reason: CheckReason;
    force: boolean;
    showNotice: boolean;
}

export class AddonUpdateCoordinator {
    static #timer: number | null = null;
    static #manualCheck: Promise<boolean> | null = null;
    static #eventTimers = new Map<string, number>();
    static #targetChecks = new Map<string, Promise<void>>();
    static #retryAt = new Map<string, number>();
    static #offlineDeferrals = new Map<string, number>();
    static #waitingForOnline = false;
    static #initialized = false;

    static #onlineHandler = () => {
        if (!this.#waitingForOnline) return;
        this.#waitingForOnline = false;
        window.removeEventListener("online", this.#onlineHandler);
        this.#clearOfflineDeferrals();
        Logger.info("AddonUpdater", "Connection restored; resuming stale plugin and theme update checks.");
        if (SettingsStore.get("addons", "checkForUpdates")) void this.checkAutomatic("scheduled");
    };

    static #clearOfflineDeferrals() {
        for (const [key, offlineRetryAt] of this.#offlineDeferrals) {
            const currentRetryAt = this.#retryAt.get(key);
            // Reconnect cancels only the short offline delay. A longer provider rate-limit reset
            // remains authoritative and will still be respected by the scheduled/manual paths.
            if (currentRetryAt !== undefined && currentRetryAt <= offlineRetryAt) this.#retryAt.delete(key);
        }
        this.#offlineDeferrals.clear();
    }

    static initialize() {
        if (this.#initialized) return;
        this.#initialized = true;
        state = normalizeAddonUpdateState(JsonStore.get("addon-updater"));
        this.pruneMissingAddons();
        this.#hydrateCachedCandidates();
        if (SettingsStore.get("addons", "checkForUpdates")) {
            PluginUpdater.showUpdateNotice();
            ThemeUpdater.showUpdateNotice();
        }
        saveState();
        flushState();
    }

    static setRetryAt(key: string, retryAt: number) {
        if (!Number.isFinite(retryAt)) return;
        this.#retryAt.set(key, retryAt);
    }

    static cancelEventCheck(type: AddonType, filename: string) {
        const key = getAddonUpdateKey(type, filename);
        const timer = this.#eventTimers.get(key);
        if (timer !== undefined) window.clearTimeout(timer);
        this.#eventTimers.delete(key);
        this.#retryAt.delete(key);
        this.#offlineDeferrals.delete(key);
        if (this.#waitingForOnline && this.#offlineDeferrals.size === 0) {
            this.#waitingForOnline = false;
            window.removeEventListener("online", this.#onlineHandler);
        }
    }

    static pruneMissingAddons() {
        const installedKeys = new Set(this.#installedTargets().map(({updater, addon}) =>
            getAddonUpdateKey(updater.type, addon.filename)
        ));
        const removedKeys = Object.keys(state.addons).filter(key => !installedKeys.has(key));
        let changed = false;

        for (const key of removedKeys) {
            delete state.addons[key];

            const type = key.startsWith("plugin:") ? "plugin" : "theme";
            const filename = key.slice(type.length + 1);
            (type === "plugin" ? PluginUpdater : ThemeUpdater).removePending(filename);
            changed = true;
        }

        // Runtime retry/event ownership may exist before an addon has ever completed a persisted
        // check (for example, a new file removed while its first offline request is deferred).
        for (const key of this.#retryAt.keys()) {
            if (!installedKeys.has(key)) this.#retryAt.delete(key);
        }
        for (const key of this.#offlineDeferrals.keys()) {
            if (!installedKeys.has(key)) this.#offlineDeferrals.delete(key);
        }
        for (const [key, timer] of this.#eventTimers) {
            if (installedKeys.has(key)) continue;
            window.clearTimeout(timer);
            this.#eventTimers.delete(key);
        }

        const referencedFingerprints = new Set<string>();
        for (const addonState of Object.values(state.addons)) {
            if (addonState.urlFingerprint) referencedFingerprints.add(addonState.urlFingerprint);
            if (addonState.resolvedUrlFingerprint) referencedFingerprints.add(addonState.resolvedUrlFingerprint);
        }

        for (const [fingerprint, urlState] of Object.entries(state.urls)) {
            const metadataKey = urlState.metadata
                ? getAddonUpdateKey(urlState.metadata.type, urlState.metadata.filename)
                : null;
            if (referencedFingerprints.has(fingerprint) || (metadataKey && installedKeys.has(metadataKey))) continue;

            delete state.urls[fingerprint];
            deleteMemoryBody(fingerprint);
            changed = true;
        }

        for (const key of resolvedUpdateUrls.keys()) {
            if ([...installedKeys].some(installedKey => key.startsWith(`${installedKey}:`))) continue;
            resolvedUpdateUrls.delete(key);
        }

        if (this.#waitingForOnline && this.#offlineDeferrals.size === 0) {
            this.#waitingForOnline = false;
            window.removeEventListener("online", this.#onlineHandler);
        }

        if (!changed) return;
        Logger.debug("AddonUpdater", `Pruned ${removedKeys.length} removed addon entr${removedKeys.length === 1 ? "y" : "ies"} from persisted updater state.`);
        saveStateImmediately();
    }

    static queueEventCheck(updater: AddonUpdater, addon: Addon) {
        if (!SettingsStore.get("addons", "checkForUpdates")) return;
        updater.reconcilePending(addon.filename);
        const key = getAddonUpdateKey(updater.type, addon.filename);
        const previous = this.#eventTimers.get(key);
        if (previous !== undefined) window.clearTimeout(previous);

        this.#eventTimers.set(key, window.setTimeout(() => {
            this.#eventTimers.delete(key);
            if (!SettingsStore.get("addons", "checkForUpdates")) return;

            // A file read is an actual installed-addon change, not a passive UI event. Recheck it
            // even when its previous URL/timestamp is fresh so local downgrades are noticed.
            void this.#checkTargets([{updater, addon}], {reason: "event", force: true, showNotice: false})
                .finally(() => this.scheduleNextCheck());
        }, EVENT_CHECK_DEBOUNCE_MS));
    }

    static configureSchedule() {
        if (this.#timer !== null) window.clearTimeout(this.#timer);
        this.#timer = null;
        if (!SettingsStore.get("addons", "checkForUpdates")) {
            for (const timer of this.#eventTimers.values()) window.clearTimeout(timer);
            this.#eventTimers.clear();
            if (this.#waitingForOnline) {
                this.#waitingForOnline = false;
                window.removeEventListener("online", this.#onlineHandler);
                this.#clearOfflineDeferrals();
            }
            return;
        }
        this.scheduleNextCheck();
    }

    static scheduleNextCheck() {
        if (this.#timer !== null) window.clearTimeout(this.#timer);
        this.#timer = null;
        if (!SettingsStore.get("addons", "checkForUpdates")) return;

        const now = Date.now();
        const intervalMs = SettingsStore.get<number>("addons", "updateInterval") * 60 * 60 * 1000;
        const installed = this.#installedTargets();
        const keys = installed.map(({updater, addon}) => getAddonUpdateKey(updater.type, addon.filename));
        let dueAt = getEarliestAddonCheckDueAt(keys, state.addons, intervalMs, now);
        if (dueAt === null) return;

        if (this.#retryAt.size) {
            dueAt = Number.POSITIVE_INFINITY;
            for (const key of keys) {
                const checkedAt = state.addons[key]?.lastCheckedAt;
                const normalDue = checkedAt === undefined ? now : checkedAt + intervalMs;
                dueAt = Math.min(dueAt, Math.max(normalDue, this.#retryAt.get(key) ?? 0));
            }
        }

        const delay = Math.max(MINIMUM_SCHEDULE_DELAY_MS, dueAt - now);
        this.#timer = window.setTimeout(() => {
            this.#timer = null;
            void this.checkAutomatic("scheduled");
        }, Math.min(delay, 0x7FFFFFFF));
    }

    static async checkAutomatic(reason: "startup" | "scheduled") {
        if (!SettingsStore.get("addons", "checkForUpdates")) return;
        try {
            await this.checkUpdaters([PluginUpdater, ThemeUpdater], {reason, force: false, showNotice: true});
        }
        finally {
            this.scheduleNextCheck();
        }
    }

    static async checkManually(): Promise<boolean> {
        if (this.#manualCheck) {
            // A concurrent click may join the addon work, but only its initiating caller returns
            // true. The fork's optional core-check call remains commented in the Updates panel.
            await this.#manualCheck;
            return false;
        }

        const now = Date.now();
        if (state.manualLastCheckedAt && now - state.manualLastCheckedAt < MANUAL_CHECK_COOLDOWN_MS) {
            Logger.debug("AddonUpdater", "Ignored a repeated manual update check during the 60-second cooldown.");
            return false;
        }

        this.#manualCheck = (async () => {
            try {
                await this.checkUpdaters([PluginUpdater, ThemeUpdater], {reason: "manual", force: true, showNotice: false});
                return true;
            }
            finally {
                state.manualLastCheckedAt = Date.now();
                saveState();
                flushState();
                this.scheduleNextCheck();
            }
        })();

        try {return await this.#manualCheck;}
        finally {this.#manualCheck = null;}
    }

    static async checkUpdaters(updaters: AddonUpdater[], options: CheckOptions) {
        this.pruneMissingAddons();
        const targets = updaters.flatMap(updater => updater.manager.addonList.map(addon => ({updater, addon})));
        await this.#checkTargets(targets, options);
        if (options.showNotice) for (const updater of updaters) updater.showUpdateNotice();
    }

    static #installedTargets() {
        // Manager addonList is the on-disk inventory and includes enabled and disabled addons.
        // Never filter through manager.state here: disabled plugins/themes still receive updates.
        return [
            ...PluginUpdater.manager.addonList.map(addon => ({updater: PluginUpdater, addon})),
            ...ThemeUpdater.manager.addonList.map(addon => ({updater: ThemeUpdater, addon}))
        ];
    }

    static #hydrateCachedCandidates() {
        for (const {updater, addon} of this.#installedTargets()) {
            const candidates = [
                restoreDeclaredCandidate(addon, updater.type),
                inspectStore(addon, updater.getStoreAddon(addon.filename))
            ].filter((candidate): candidate is Candidate => Boolean(candidate));
            updater.setCandidates(addon.filename, addon.version, candidates);
        }
    }

    static async #refreshCatalogue(force: boolean): Promise<boolean> {
        const now = Date.now();
        const intervalMs = SettingsStore.get<number>("addons", "updateInterval") * 60 * 60 * 1000;
        const latestSuccess = Math.max(state.catalogueLastCheckedAt ?? 0, AddonStore.lastSuccessfulRequestAt);
        if (!force && latestSuccess && latestSuccess + intervalMs > now) return true;

        const loaded = await AddonStore.updaterRequestAddons(force);
        if (!loaded) return false;

        state.catalogueLastCheckedAt = AddonStore.lastSuccessfulRequestAt;
        saveState();
        return true;
    }

    static async #checkTargets(targets: Array<{updater: AddonUpdater; addon: Addon;}>, options: CheckOptions) {
        const now = Date.now();
        const intervalMs = SettingsStore.get<number>("addons", "updateInterval") * 60 * 60 * 1000;
        const dueTargets = options.force ? targets : targets.filter(({updater, addon}) => {
            const key = getAddonUpdateKey(updater.type, addon.filename);
            const retryAt = this.#retryAt.get(key);
            const updateUrl = getInstalledUpdateUrl(addon);
            const metadataUrlChanged = updateUrl
                ? state.addons[key]?.urlFingerprint !== getAddonUpdateUrlFingerprint(updateUrl.trim())
                : Boolean(state.addons[key]?.urlFingerprint);
            return (!retryAt || retryAt <= now) && (metadataUrlChanged || isAddonCheckStale(state.addons[key]?.lastCheckedAt, intervalMs, now));
        });
        if (!dueTargets.length) return;

        if (isNavigatorOffline()) {
            this.#deferUntilOnline(dueTargets);
            return;
        }

        const catalogueFresh = await this.#refreshCatalogue(options.force && options.reason === "manual");
        if (isNavigatorOffline()) {
            this.#deferUntilOnline(dueTargets);
            flushState();
            return;
        }
        await Promise.all(dueTargets.map(({updater, addon}) => {
            const key = getAddonUpdateKey(updater.type, addon.filename);
            const active = this.#targetChecks.get(key);
            if (active) return active;

            const check = this.#checkTarget(updater, addon, catalogueFresh, options, intervalMs).catch((error) => {
                this.#retryAt.set(key, Date.now() + TRANSIENT_RETRY_MS);
                Logger.stacktrace("AddonUpdater", `Unexpected failure while checking '${addon.filename}'`, safeErrorForLog(error));
            });
            this.#targetChecks.set(key, check);
            void check.then(
                () => {if (this.#targetChecks.get(key) === check) this.#targetChecks.delete(key);},
                () => {if (this.#targetChecks.get(key) === check) this.#targetChecks.delete(key);}
            );
            return check;
        }));
        if (isNavigatorOffline()) {
            const unsettledTargets = dueTargets.filter(({updater, addon}) =>
                this.#retryAt.has(getAddonUpdateKey(updater.type, addon.filename))
            );
            if (unsettledTargets.length) this.#deferUntilOnline(unsettledTargets);
        }
        flushState();
    }

    static #deferUntilOnline(targets: Array<{updater: AddonUpdater; addon: Addon;}>) {
        const retryAt = Date.now() + TRANSIENT_RETRY_MS;
        for (const {updater, addon} of targets) {
            const key = getAddonUpdateKey(updater.type, addon.filename);
            this.#offlineDeferrals.set(key, retryAt);
            this.#retryAt.set(key, Math.max(this.#retryAt.get(key) ?? 0, retryAt));
        }
        if (this.#waitingForOnline) return;

        this.#waitingForOnline = true;
        window.addEventListener("online", this.#onlineHandler);
        Logger.info("AddonUpdater", "Connection unavailable; deferring plugin and theme update requests until reconnect.");
    }

    static async #checkTarget(
        updater: AddonUpdater,
        addon: Addon,
        catalogueFresh: boolean,
        options: CheckOptions,
        intervalMs: number
    ) {
        const key = getAddonUpdateKey(updater.type, addon.filename);
        const updateUrl = getInstalledUpdateUrl(addon);
        if (!updateUrl && state.addons[key]?.urlFingerprint) {
            resolvedUpdateUrls.delete(`${key}:${state.addons[key].urlFingerprint}`);
            delete state.addons[key].urlFingerprint;
            delete state.addons[key].resolvedUrlFingerprint;
            delete state.addons[key].negativeLookupUntil;
            saveState();
        }
        const urlResult = updateUrl
            ? await inspectDeclaredUrl(addon, updateUrl, {forceNetwork: options.force, intervalMs})
            : {candidate: null, settled: true};

        // A file watcher may unload, replace, or edit an addon while its request is in flight. Never
        // apply the old object's version/identity result; queue the current object for a forced,
        // debounced recheck instead.
        const currentAddon = updater.manager.addonList.find(entry => entry.filename === addon.filename);
        if (!currentAddon) {
            updater.removePending(addon.filename);
            this.#retryAt.delete(key);
            this.pruneMissingAddons();
            return;
        }
        if (currentAddon !== addon
            || currentAddon.version !== addon.version
            || getInstalledUpdateUrl(currentAddon) !== updateUrl) {
            updater.reconcilePending(currentAddon.filename);
            this.queueEventCheck(updater, currentAddon);
            return;
        }

        const storeCandidate = inspectStore(addon, updater.getStoreAddon(addon.filename));
        const candidates = [urlResult.candidate, storeCandidate].filter((candidate): candidate is Candidate => Boolean(candidate));
        const selected = chooseAddonUpdateCandidate(addon.version, candidates);

        const completed = catalogueFresh && urlResult.settled;
        if (selected || completed) updater.setCandidates(addon.filename, addon.version, candidates);
        if (!selected && urlResult.candidate) forgetCandidateBodies([urlResult.candidate]);

        if (completed) {
            state.addons[key] ??= {};
            state.addons[key].lastCheckedAt = Date.now();
            this.#retryAt.delete(key);
        }
        else {
            this.#retryAt.set(key, urlResult.retryAt ?? Date.now() + TRANSIENT_RETRY_MS);
        }
    }
}

export const PluginUpdater = new AddonUpdater("plugin");
export const ThemeUpdater = new AddonUpdater("theme");
