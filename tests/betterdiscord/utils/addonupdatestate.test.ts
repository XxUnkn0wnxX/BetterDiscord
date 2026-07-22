import {describe, expect, test} from "bun:test";

import {
    ADDON_UPDATE_STATE_VERSION,
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
    normalizeAddonUpdateState
} from "@utils/addonupdatestate";

const URL_FINGERPRINT = `url-sha256:${"a".repeat(64)}`;
const CONTENT_HASH = "B".repeat(64);

describe("addon updater persisted state", () => {
    test("creates an empty versioned state and rejects unknown versions", () => {
        expect(createAddonUpdateState()).toEqual({
            version: ADDON_UPDATE_STATE_VERSION,
            addons: {},
            urls: {},
            origins: {}
        });
        expect(normalizeAddonUpdateState({version: 2, addons: {bad: {lastCheckedAt: 1}}})).toEqual(
            createAddonUpdateState()
        );
        expect(normalizeAddonUpdateState(null)).toEqual(createAddonUpdateState());
    });

    test("keeps valid per-addon, URL, origin and global state", () => {
        const normalized = normalizeAddonUpdateState({
            version: 1,
            addons: {
                "plugin:Example.plugin.js": {
                    lastCheckedAt: 100,
                    urlFingerprint: URL_FINGERPRINT,
                    resolvedUrlFingerprint: URL_FINGERPRINT,
                    negativeLookupUntil: 200
                }
            },
            urls: {
                [URL_FINGERPRINT]: {
                    lastCheckedAt: 110,
                    negativeLookupUntil: 210,
                    etag: "W/\"etag\"",
                    lastModified: "Wed, 22 Jul 2026 01:00:00 GMT",
                    contentHash: CONTENT_HASH,
                    metadata: {
                        type: "plugin",
                        filename: "Example.plugin.js",
                        name: "Example",
                        version: "2.0.0",
                        author: "Example Author",
                        authorId: "123456789012345678",
                        repositoryIdentity: "github.com/example/repo"
                    }
                }
            },
            origins: {
                "https://api.github.com/": {blockedUntil: 300, failureCount: 2}
            },
            catalogueLastCheckedAt: 120,
            manualLastCheckedAt: 130
        });

        expect(normalized).toEqual({
            version: 1,
            addons: {
                "plugin:Example.plugin.js": {
                    lastCheckedAt: 100,
                    urlFingerprint: URL_FINGERPRINT,
                    resolvedUrlFingerprint: URL_FINGERPRINT,
                    negativeLookupUntil: 200
                }
            },
            urls: {
                [URL_FINGERPRINT]: {
                    lastCheckedAt: 110,
                    negativeLookupUntil: 210,
                    etag: "W/\"etag\"",
                    lastModified: "Wed, 22 Jul 2026 01:00:00 GMT",
                    contentHash: CONTENT_HASH.toLowerCase(),
                    metadata: {
                        type: "plugin",
                        filename: "Example.plugin.js",
                        name: "Example",
                        version: "2.0.0",
                        author: "Example Author",
                        authorId: "123456789012345678",
                        repositoryIdentity: "github.com/example/repo"
                    }
                }
            },
            origins: {
                "https://api.github.com": {blockedUntil: 300, failureCount: 2}
            },
            catalogueLastCheckedAt: 120,
            manualLastCheckedAt: 130
        });
    });

    test("drops malformed keys and fields without discarding valid siblings", () => {
        const normalized = normalizeAddonUpdateState({
            version: 1,
            addons: {
                "plugin:Wrong.theme.css": {lastCheckedAt: 1},
                "theme:Valid.theme.css": {
                    lastCheckedAt: 5,
                    urlFingerprint: "https://secret.invalid/?token=do-not-store",
                    resolvedUrlFingerprint: "https://secret.invalid/raw?token=do-not-store"
                },
                "theme:Empty.theme.css": {lastCheckedAt: -1}
            },
            urls: {
                "https://secret.invalid/?token=do-not-store": {etag: "leak"},
                [URL_FINGERPRINT]: {
                    etag: "valid-etag",
                    contentHash: "not-sha256",
                    metadata: {type: "theme", filename: "Wrong.plugin.js", name: "Wrong", version: "1.0.0"}
                }
            },
            origins: {
                "http://insecure.invalid": {blockedUntil: 10},
                "https://safe.invalid/path?token=hidden": {blockedUntil: 20, failureCount: -1}
            },
            catalogueLastCheckedAt: "yesterday",
            manualLastCheckedAt: Number.NaN
        });

        expect(normalized).toEqual({
            version: 1,
            addons: {"theme:Valid.theme.css": {lastCheckedAt: 5}},
            urls: {[URL_FINGERPRINT]: {etag: "valid-etag"}},
            origins: {"https://safe.invalid": {blockedUntil: 20}}
        });
        expect(JSON.stringify(normalized)).not.toContain("token");
    });
});

describe("addon updater keys and freshness", () => {
    test("builds type-qualified keys and canonical query-free origins", () => {
        expect(getAddonUpdateKey("plugin", "Example.plugin.js")).toBe("plugin:Example.plugin.js");
        expect(getAddonUpdateKey("theme", "Example.theme.css")).toBe("theme:Example.theme.css");
        expect(getAddonUpdateOrigin("https://api.example.com/path?token=hidden#fragment")).toBe("https://api.example.com");
        expect(getAddonUpdateOrigin("https://user:secret@example.com/file")).toBeNull();
        expect(getAddonUpdateOrigin("http://example.com/file")).toBeNull();
    });

    test("uses an opaque deterministic SHA-256 URL fingerprint", () => {
        expect(getAddonUpdateUrlFingerprint("abc")).toBe(
            "url-sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        const first = getAddonUpdateUrlFingerprint("https://example.com/A.plugin.js?token=one");
        const second = getAddonUpdateUrlFingerprint("https://example.com/A.plugin.js?token=two");
        expect(first).not.toBe(second);
        expect(first).not.toContain("example.com");
        expect(first).not.toContain("token");
        expect(first).not.toContain("one");
    });

    test("hashes the exact downloaded byte sequence", () => {
        expect(getAddonUpdateContentHash(new TextEncoder().encode("abc"))).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        expect(getAddonUpdateContentHash(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61]))).not.toBe(
            getAddonUpdateContentHash(new Uint8Array([0x61]))
        );
    });

    test("checks per-addon staleness at the exact interval boundary", () => {
        expect(isAddonCheckStale(undefined, 500, 1_499)).toBe(true);
        expect(isAddonCheckStale(1_000, 500, 1_499)).toBe(false);
        expect(isAddonCheckStale(1_000, 500, 1_500)).toBe(true);
        expect(isAddonCheckStale(1_000, -1, 1_500)).toBe(true);
    });

    test("calculates the earliest useful one-shot timer", () => {
        const states = {
            "plugin:A.plugin.js": {lastCheckedAt: 1_000},
            "theme:B.theme.css": {lastCheckedAt: 2_000}
        };

        expect(getEarliestAddonCheckDueAt([], states, 1_000, 2_100)).toBeNull();
        expect(getEarliestAddonCheckDueAt(["plugin:A.plugin.js"], states, 2_000, 2_100)).toBe(3_000);
        expect(getEarliestAddonCheckDueAt(["plugin:A.plugin.js", "theme:B.theme.css"], states, 500, 2_100)).toBe(2_100);
        expect(getEarliestAddonCheckDueAt(["plugin:Missing.plugin.js"], states, 500, 2_100)).toBe(2_100);
    });

    test("supports temporary negative lookup windows", () => {
        expect(getNegativeLookupUntil(1_000, 60_000)).toBe(61_000);
        expect(isNegativeLookupActive(61_000, 60_999)).toBe(true);
        expect(isNegativeLookupActive(61_000, 61_000)).toBe(false);
        expect(isNegativeLookupActive(undefined, 1_000)).toBe(false);
    });
});

describe("addon updater rate-limit delays", () => {
    const NOW = 1_800_000_000_000;

    test("distinguishes real throttles from ordinary 403 access failures", () => {
        expect(isAddonUpdateRateLimitResponse(429, {})).toBe(true);
        expect(isAddonUpdateRateLimitResponse(403, {"X-RateLimit-Remaining": "0"})).toBe(true);
        expect(isAddonUpdateRateLimitResponse(403, {"Retry-After": "60"})).toBe(true);
        expect(isAddonUpdateRateLimitResponse(403, {})).toBe(false);
        expect(isAddonUpdateRateLimitResponse(500, {"Retry-After": "60"})).toBe(false);
    });

    test("prefers Retry-After seconds and supports an HTTP date", () => {
        expect(getAddonUpdateRateLimitDelay({
            "Retry-After": "120",
            "X-RateLimit-Reset": String(NOW / 1000 + 600),
            "RateLimit-Reset": "900"
        }, {now: NOW})).toMatchObject({source: "retry-after", baseDelayMs: 120_000, blockedUntil: NOW + 120_000});

        const date = new Date(NOW + 30_000).toUTCString();
        expect(getAddonUpdateRateLimitDelay({get: (name) => name.toLowerCase() === "retry-after" ? date : null}, {now: NOW}))
            .toMatchObject({source: "retry-after", baseDelayMs: 30_000});
    });

    test("falls through to X-RateLimit-Reset then RateLimit-Reset", () => {
        expect(getAddonUpdateRateLimitDelay({
            "Retry-After": "invalid",
            "X-RateLimit-Reset": String(NOW / 1000 + 45),
            "RateLimit-Reset": "90"
        }, {now: NOW})).toMatchObject({source: "x-ratelimit-reset", baseDelayMs: 45_000});

        expect(getAddonUpdateRateLimitDelay({"RateLimit-Reset": "90"}, {now: NOW})).toMatchObject({
            source: "ratelimit-reset",
            baseDelayMs: 90_000
        });
        expect(getAddonUpdateRateLimitDelay({"RateLimit-Reset": String(NOW / 1000 + 30)}, {now: NOW})).toMatchObject({
            source: "ratelimit-reset",
            baseDelayMs: 30_000
        });
    });

    test("uses capped exponential fallback delays", () => {
        expect(getAddonUpdateRateLimitDelay({}, {now: NOW, failureCount: 0})).toMatchObject({
            source: "fallback", baseDelayMs: 60_000, nextFailureCount: 1
        });
        expect(getAddonUpdateRateLimitDelay({}, {now: NOW, failureCount: 1})).toMatchObject({
            source: "fallback", baseDelayMs: 300_000, nextFailureCount: 2
        });
        expect(getAddonUpdateRateLimitDelay({}, {now: NOW, failureCount: 2})).toMatchObject({
            source: "fallback", baseDelayMs: 900_000, nextFailureCount: 3
        });
        expect(getAddonUpdateRateLimitDelay({}, {now: NOW, failureCount: 99})).toMatchObject({
            source: "fallback", baseDelayMs: 3_600_000, nextFailureCount: 3
        });
    });

    test("adds injectable jitter without making the parser nondeterministic", () => {
        const result = getAddonUpdateRateLimitDelay({}, {
            now: NOW,
            jitter: (baseDelayMs, source) => {
                expect(baseDelayMs).toBe(60_000);
                expect(source).toBe("fallback");
                return 250;
            }
        });

        expect(result).toEqual({
            source: "fallback",
            baseDelayMs: 60_000,
            delayMs: 60_250,
            blockedUntil: NOW + 60_250,
            nextFailureCount: 1
        });
    });
});
