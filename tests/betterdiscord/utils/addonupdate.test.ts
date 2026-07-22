import {describe, expect, test} from "bun:test";

import {
    type AddonContentRejectionCode,
    type AddonIdentityResult,
    type AddonUpdateCandidate,
    chooseAddonUpdateCandidate,
    compareAddonIdentity,
    compareAddonVersions,
    getAddonTypeFromFilename,
    normalizeAuthorTokens,
    normalizeRepositoryIdentity,
    validateAddonContent
} from "@utils/addonupdate";


const eligibleIdentity: AddonIdentityResult = {
    status: "eligible",
    matchedBy: ["repository"],
    repository: "match",
    authorId: "unknown",
    author: "unknown",
    installedRepositories: ["github.com/example/addon"],
    candidateRepositories: ["github.com/example/addon"]
};

const unknownIdentity: AddonIdentityResult = {
    status: "unknown",
    matchedBy: [],
    repository: "unknown",
    authorId: "unknown",
    author: "unknown",
    installedRepositories: [],
    candidateRepositories: []
};

function candidate(source: "update-url" | "store", version: string, identity = eligibleIdentity): AddonUpdateCandidate<string> {
    return {source, version, identity, data: `${source}-${version}`};
}

describe("addon update utilities", () => {
    describe("version comparison", () => {
        test("uses strict SemVer precedence", () => {
            expect(compareAddonVersions("1.0.0-alpha", "1.0.0")).toBe("newer");
            expect(compareAddonVersions("2.0.0", "1.9.9")).toBe("older");
            expect(compareAddonVersions("1.0.0+one", "1.0.0+two")).toBe("equal");
        });

        test("supports loose dotted numeric versions", () => {
            expect(compareAddonVersions("6.9", "6.10")).toBe("newer");
            expect(compareAddonVersions("2.8.2.6", "2.8.2.7")).toBe("newer");
            expect(compareAddonVersions("1", "1.0.0")).toBe("equal");
            expect(compareAddonVersions("99999999999999999999", "100000000000000000000")).toBe("newer");
        });

        test("never lexically orders opaque versions", () => {
            expect(compareAddonVersions("release-a", "release-b")).toBe("uncomparable");
            expect(compareAddonVersions("1.0", "next")).toBe("uncomparable");
        });
    });

    describe("content validation", () => {
        test("derives addon type from the filename", () => {
            expect(getAddonTypeFromFilename("Example.plugin.js")).toBe("plugin");
            expect(getAddonTypeFromFilename("Example.theme.css")).toBe("theme");
            expect(getAddonTypeFromFilename("Example.js")).toBeNull();
        });

        test("parses the first JSDoc block and exposes only safe metadata", () => {
            const source = `/**
 * @name Example
 * @version 2.8.2.7
 * @author Example Dev
 * @authorId 123456789012345678
 * @updateURL https://raw.githubusercontent.com/example/addon/main/Example.plugin.js
 * @source https://github.com/example/addon
 * @website javascript:alert(1)
 */
module.exports = class Example {};
/** @name Forged @version 99.0.0 */`;

            const result = validateAddonContent("Example.plugin.js", source, "plugin");
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.metadata).toEqual({
                type: "plugin",
                name: "Example",
                version: "2.8.2.7",
                author: "Example Dev",
                authorId: "123456789012345678",
                updateUrl: "https://raw.githubusercontent.com/example/addon/main/Example.plugin.js",
                source: "https://github.com/example/addon"
            });
        });

        test("rejects unsupported or conflicting addon types", () => {
            const source = "/**\n * @name Example\n * @version 1.0.0\n */";
            expect(validateAddonContent("Example.txt", source).ok).toBe(false);
            expect(validateAddonContent("Example.plugin.js", source, "theme")).toEqual({
                ok: false,
                code: "wrong-addon-type",
                reason: "Expected a theme, but the filename identifies a plugin."
            });

            const declaredTheme = "/**\n * @name Example\n * @version 1.0.0\n * @type theme\n */";
            const result = validateAddonContent("Example.plugin.js", declaredTheme);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.code).toBe("wrong-addon-type");
        });

        test("rejects response bodies that are not real addon source", () => {
            const bodies = [
                "<!doctype html><html><title>Sign in</title></html>",
                "binary\u0000payload",
                "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123",
                "module.exports = {};",
                "// preamble\n/**\n * @name Example\n * @version 1.0.0\n */",
                "module.exports = {}; /**\n * @name Example\n * @version 1.0.0\n */"
            ];

            const expectedCodes: AddonContentRejectionCode[] = ["html-response", "binary-response", "git-lfs-pointer", "missing-jsdoc", "misplaced-jsdoc", "misplaced-jsdoc"];
            for (let index = 0; index < bodies.length; index++) {
                const result = validateAddonContent("Example.plugin.js", bodies[index]);
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.code).toBe(expectedCodes[index]);
            }
        });

        test("rejects repeated or opaque required metadata", () => {
            const repeatedName = "/**\n * @name First\n * @name Second\n * @version 1.0.0\n */";
            const opaqueVersion = "/**\n * @name Example\n * @version Unknown\n */";

            const repeatedResult = validateAddonContent("Example.plugin.js", repeatedName);
            expect(repeatedResult.ok).toBe(false);
            if (!repeatedResult.ok) expect(repeatedResult.code).toBe("invalid-name");

            const versionResult = validateAddonContent("Example.plugin.js", opaqueVersion);
            expect(versionResult.ok).toBe(false);
            if (!versionResult.ok) expect(versionResult.code).toBe("invalid-version");
        });
    });

    describe("identity matching", () => {
        test("rejects the JumpToTop Store collision", () => {
            const result = compareAddonIdentity(
                {
                    author: "openAI",
                    source: "https://github.com/XxUnkn0wnxX/BDPlugins/tree/main",
                    updateUrl: "https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/JumpToTop.plugin.js"
                },
                {
                    githubName: "snappycreeper",
                    displayName: "SnappyC",
                    discordSnowflake: "1031925360239058974",
                    latestSourceUrl: "https://raw.githubusercontent.com/snappycreeper/BetterDiscordPlugins/commit/JumpToTop/JumpToTop.plugin.js"
                }
            );

            expect(result.status).toBe("rejected");
            expect(result.repository).toBe("mismatch");
            expect(result.author).toBe("mismatch");
            expect(result.matchedBy).toEqual([]);
        });

        test("accepts ClearVision through repository identity despite presentation differences", () => {
            const result = compareAddonIdentity(
                {author: "ClearVision Team", source: "https://github.com/ClearVision/ClearVision-v7"},
                {
                    githubName: "NyxIsBad",
                    displayName: "NyxIsBad",
                    latestSourceUrl: "https://raw.githubusercontent.com/ClearVision/ClearVision-v7/commit/ClearVision-v7-BetterDiscord.theme.css"
                }
            );

            expect(result.status).toBe("eligible");
            expect(result.repository).toBe("match");
            expect(result.matchedBy).toContain("repository");
        });

        test("accepts CallTimeCounter through a normalized author token", () => {
            const result = compareAddonIdentity(
                {author: "QWERT, KingGamingYT"},
                {githubName: "KingGamingYT", displayName: "feldking"}
            );

            expect(result.status).toBe("eligible");
            expect(result.author).toBe("match");
            expect(result.matchedBy).toContain("author");
            expect(normalizeAuthorTokens("QWERT, KingGamingYT")).toEqual(["kinggamingyt", "qwert"]);
        });

        test("accepts an exact Discord author ID even when repositories differ", () => {
            const result = compareAddonIdentity(
                {
                    authorId: "278543574059057154",
                    source: "https://github.com/example/original-addon"
                },
                {
                    discordSnowflake: "278543574059057154",
                    latestSourceUrl: "https://github.com/example/moved-addon"
                }
            );

            expect(result.status).toBe("eligible");
            expect(result.repository).toBe("mismatch");
            expect(result.authorId).toBe("match");
            expect(result.matchedBy).toContain("author-id");
        });

        test("treats absent identity evidence as unknown, not a mismatch", () => {
            const result = compareAddonIdentity({author: "Example"}, {});
            expect(result.status).toBe("unknown");
            expect(result.repository).toBe("unknown");
            expect(result.author).toBe("unknown");
        });

        test("normalizes repository URLs across forge raw and browser forms", () => {
            expect(normalizeRepositoryIdentity("https://github.com/Owner/Repo/tree/main/path")).toBe("github.com/owner/repo");
            expect(normalizeRepositoryIdentity("https://raw.githubusercontent.com/Owner/Repo/main/file.plugin.js")).toBe("github.com/owner/repo");
            expect(normalizeRepositoryIdentity("https://git.slowb.ro/Owner/Repo/raw/branch/main/file.plugin.js")).toBe("git.slowb.ro/owner/repo");
            expect(normalizeRepositoryIdentity("https://example.com/downloads/file.plugin.js")).toBeNull();
        });

        test("uses the URL normalizer's canonical identity for alternate forges", () => {
            const pairs = [
                [
                    "https://stash.example/projects/PROJ/repos/Repo/browse",
                    "https://stash.example/projects/PROJ/repos/Repo/raw/folder/Test.plugin.js?at=refs%2Fheads%2Fmain"
                ],
                [
                    "https://stash.example/users/Alice/repos/Repo/browse",
                    "https://stash.example/users/Alice/repos/Repo/raw/Test.plugin.js?at=main"
                ],
                [
                    "https://bitbucket.org/Workspace/Repo",
                    "https://api.bitbucket.org/2.0/repositories/Workspace/Repo/src/main/Test.plugin.js"
                ],
                [
                    "https://dev.azure.com/Org/Project/_git/Repo",
                    "https://dev.azure.com/Org/Project/_apis/git/repositories/Repo/items?path=%2FTest.plugin.js&versionDescriptor.version=main&versionDescriptor.versionType=branch"
                ],
                [
                    "https://gitlab.com/group/subgroup/repo",
                    "https://gitlab.com/group/subgroup/repo/-/raw/main/Test.plugin.js"
                ]
            ];

            for (const [source, raw] of pairs) {
                const sourceIdentity = normalizeRepositoryIdentity(source);
                expect(sourceIdentity).not.toBeNull();
                expect(normalizeRepositoryIdentity(raw)).toBe(sourceIdentity);
                expect(compareAddonIdentity({source}, {updateUrl: raw}).status).toBe("eligible");
            }
        });

        test("accepts a previously normalized repository identity from cache", () => {
            const result = compareAddonIdentity(
                {source: "https://github.com/Owner/Repo"},
                {repositoryIdentity: "github.com/owner/repo"}
            );
            expect(result.status).toBe("eligible");
            expect(result.repository).toBe("match");
        });
    });

    describe("candidate choice", () => {
        test("favors the update URL when both sources offer the same newer version", () => {
            const selected = chooseAddonUpdateCandidate("1.0.0", [
                candidate("store", "2.0.0"),
                candidate("update-url", "2.0.0")
            ]);
            expect(selected?.source).toBe("update-url");
        });

        test("supports URL-only and Store-only upgrades", () => {
            expect(chooseAddonUpdateCandidate("1.0.0", [candidate("update-url", "1.1.0")])?.source).toBe("update-url");
            expect(chooseAddonUpdateCandidate("1.0.0", [candidate("store", "1.1.0")])?.source).toBe("store");
        });

        test("chooses the highest eligible newer version", () => {
            const selected = chooseAddonUpdateCandidate("1.0.0", [
                candidate("update-url", "2.0.0"),
                candidate("store", "3.0.0")
            ]);
            expect(selected?.data).toBe("store-3.0.0");
        });

        test("excludes non-upgrades, opaque versions, and unknown identities", () => {
            expect(chooseAddonUpdateCandidate("2.0.0", [candidate("store", "1.0.0")])).toBeNull();
            expect(chooseAddonUpdateCandidate("1.0.0", [candidate("store", "next")])).toBeNull();
            expect(chooseAddonUpdateCandidate("1.0.0", [candidate("store", "2.0.0", unknownIdentity)])).toBeNull();
        });
    });
});
