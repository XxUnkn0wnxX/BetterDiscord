import {describe, expect, test} from "bun:test";

import {
    getAddonRepositoryIdentity,
    isAddonUpdateFilename,
    normalizeAddonUpdateUrl
} from "@utils/addonupdateurl";

function directUrl(input: string): string {
    const result = normalizeAddonUpdateUrl(input);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(`Expected a valid URL, got ${result.reason}`);
    expect(result.resolution).toBe("direct");
    if (!result.fetchUrl) throw new Error("Expected a direct fetch URL");
    return result.fetchUrl;
}

describe("addon update URL normalization", () => {
    describe("security and generic URLs", () => {
        test("requires HTTPS and rejects embedded credentials", () => {
            expect(normalizeAddonUpdateUrl("not a url")).toEqual({valid: false, reason: "invalid-url"});
            expect(normalizeAddonUpdateUrl("http://example.com/Test.plugin.js")).toEqual({
                valid: false,
                reason: "https-required"
            });
            expect(normalizeAddonUpdateUrl("https://user:secret@example.com/Test.plugin.js")).toEqual({
                valid: false,
                reason: "credentials-not-allowed"
            });
        });

        test("passes unknown HTTPS raw candidates through while stripping fragments", () => {
            const result = normalizeAddonUpdateUrl("https://updates.example/addons/Test.plugin.js?v=5#download");
            expect(result).toMatchObject({
                valid: true,
                fetchUrl: "https://updates.example/addons/Test.plugin.js?v=5",
                originalUrl: "https://updates.example/addons/Test.plugin.js?v=5",
                provider: "generic",
                repositoryIdentity: null,
                identityConfidence: "none",
                resolution: "direct"
            });
        });
    });

    describe("GitHub and GitLab", () => {
        test("converts GitHub blob pages without guessing slash-containing refs", () => {
            const result = normalizeAddonUpdateUrl(
                "https://github.com/Owner/Repo/blob/feature/test/addons/Test.plugin.js?raw=1#L20"
            );

            expect(result).toMatchObject({
                valid: true,
                fetchUrl: "https://github.com/Owner/Repo/raw/feature/test/addons/Test.plugin.js?raw=1",
                provider: "github",
                repositoryIdentity: "github.com/owner/repo",
                identityConfidence: "high"
            });

            expect(directUrl("https://github.com/blob/Repo/blob/main/Test.plugin.js")).toBe(
                "https://github.com/blob/Repo/raw/main/Test.plugin.js"
            );
        });

        test("keeps GitHub raw/CDN URLs and derives their repository", () => {
            expect(normalizeAddonUpdateUrl("https://raw.githubusercontent.com/Owner/Repo/main/Test.plugin.js")).toMatchObject({
                valid: true,
                fetchUrl: "https://raw.githubusercontent.com/Owner/Repo/main/Test.plugin.js",
                repositoryIdentity: "github.com/owner/repo"
            });
            expect(normalizeAddonUpdateUrl("https://cdn.jsdelivr.net/gh/Owner/Repo@main/Test.plugin.js")).toMatchObject({
                valid: true,
                repositoryIdentity: "github.com/owner/repo"
            });
        });

        test("rejects obvious GitHub repository and tree pages", () => {
            expect(normalizeAddonUpdateUrl("https://github.com/Owner/Repo")).toEqual({
                valid: false,
                reason: "unsupported-page"
            });
            expect(normalizeAddonUpdateUrl("https://github.com/Owner/Repo/tree/main/addons")).toEqual({
                valid: false,
                reason: "unsupported-page"
            });
        });

        test("supports configured GitHub Enterprise hosts", () => {
            const result = normalizeAddonUpdateUrl(
                "https://git.corp.example/prefix/Owner/Repo/blob/main/Test.plugin.js?token=abc",
                {githubHosts: ["git.corp.example"]}
            );
            expect(result).toMatchObject({
                valid: true,
                fetchUrl: "https://git.corp.example/prefix/Owner/Repo/raw/main/Test.plugin.js?token=abc",
                repositoryIdentity: "git.corp.example/prefix/owner/repo"
            });

            expect(getAddonRepositoryIdentity("https://git.corp.example/prefix/Owner/Repo", {
                githubHosts: ["git.corp.example"]
            })?.repositoryIdentity).toBe("git.corp.example/prefix/owner/repo");
        });

        test("converts modern GitLab URLs while preserving nested namespaces and queries", () => {
            const result = normalizeAddonUpdateUrl(
                "https://gitlab.example/prefix/group/sub/repo/-/blob/main/Test.theme.css?inline=false#preview"
            );
            expect(result).toMatchObject({
                valid: true,
                fetchUrl: "https://gitlab.example/prefix/group/sub/repo/-/raw/main/Test.theme.css?inline=false",
                provider: "gitlab",
                repositoryIdentity: "gitlab.example/prefix/group/sub/repo"
            });
        });

        test("supports the older GitLab grammar only on known hosts", () => {
            expect(normalizeAddonUpdateUrl("https://gitlab.com/group/repo/blob/main/Test.plugin.js")).toMatchObject({
                valid: true,
                fetchUrl: "https://gitlab.com/group/repo/raw/main/Test.plugin.js",
                repositoryIdentity: "gitlab.com/group/repo"
            });
            expect(directUrl("https://unknown.example/group/repo/blob/main/Test.plugin.js")).toBe(
                "https://unknown.example/group/repo/blob/main/Test.plugin.js"
            );
        });
    });

    describe("other Git forges", () => {
        test("normalizes Gitea/Forgejo file URLs and preserves existing raw URLs", () => {
            expect(normalizeAddonUpdateUrl(
                "https://codeberg.org/Owner/Repo/src/branch/main/addons/Test.plugin.js?download=1"
            )).toMatchObject({
                valid: true,
                fetchUrl: "https://codeberg.org/Owner/Repo/raw/branch/main/addons/Test.plugin.js?download=1",
                provider: "gitea-forgejo",
                repositoryIdentity: "codeberg.org/owner/repo"
            });

            const slowbro = "https://git.slowb.ro/XxUnkn0wnxX/MessageLoggerV2-Remake/raw/branch/main/MessageLoggerV2.plugin.js";
            expect(directUrl(slowbro)).toBe(slowbro);
        });

        test("converts Bitbucket Cloud file pages to the documented content API", () => {
            const result = normalizeAddonUpdateUrl(
                "https://bitbucket.org/Workspace/Repo/src/main/addons/Test.theme.css?at=main#source"
            );
            expect(result).toMatchObject({
                valid: true,
                fetchUrl: "https://api.bitbucket.org/2.0/repositories/Workspace/Repo/src/main/addons/Test.theme.css?at=main",
                provider: "bitbucket-cloud",
                repositoryIdentity: "bitbucket.org/workspace/repo"
            });

            const apiFile = "https://api.bitbucket.org/2.0/repositories/Workspace/Repo/src/deadbeef/Test.theme.css";
            expect(directUrl(apiFile)).toBe(apiFile);
        });

        test("converts exact Bitbucket Server project and personal repository file pages", () => {
            const project = normalizeAddonUpdateUrl(
                "https://stash.example/projects/PROJ/repos/Repo/browse/addons/Test.plugin.js?at=refs%2Fheads%2Fmain&token=abc#source"
            );
            expect(project).toMatchObject({
                valid: true,
                fetchUrl: "https://stash.example/projects/PROJ/repos/Repo/raw/addons/Test.plugin.js?at=refs%2Fheads%2Fmain&token=abc",
                provider: "bitbucket-server",
                repositoryIdentity: "stash.example/projects/proj/repos/repo",
                identityConfidence: "high"
            });

            const personal = "https://stash.example/users/Owner/repos/Repo/raw/Test.theme.css?at=deadbeef";
            expect(normalizeAddonUpdateUrl(personal)).toMatchObject({
                valid: true,
                fetchUrl: personal,
                provider: "bitbucket-server",
                repositoryIdentity: "stash.example/users/owner/repos/repo"
            });
        });

        test("does not guess non-exact Bitbucket Server pages", () => {
            expect(normalizeAddonUpdateUrl("https://stash.example/projects/PROJ/repos/Repo/browse")).toEqual({
                valid: false,
                reason: "unsupported-page"
            });
            expect(normalizeAddonUpdateUrl(
                "https://stash.example/context/projects/PROJ/repos/Repo/browse/Test.plugin.js"
            )).toMatchObject({valid: true, provider: "generic"});
        });

        test("converts safely described Azure DevOps web file URLs to the Items API", () => {
            const result = normalizeAddonUpdateUrl(
                "https://dev.azure.com/Org/Project/_git/Repo?path=%2Faddons%2FTest.plugin.js&version=GBfeature%2Fnext&_a=contents&token=abc&cache=1#L20"
            );
            expect(result).toMatchObject({
                valid: true,
                provider: "azure-devops",
                repositoryIdentity: "dev.azure.com/org/project/repo",
                identityConfidence: "high"
            });
            if (!result.valid || !result.fetchUrl) throw new Error("Expected a direct Azure Items API URL");

            const fetchUrl = new URL(result.fetchUrl);
            expect(fetchUrl.pathname).toBe("/Org/Project/_apis/git/repositories/Repo/items");
            expect(fetchUrl.searchParams.get("path")).toBe("/addons/Test.plugin.js");
            expect(fetchUrl.searchParams.get("versionDescriptor.version")).toBe("feature/next");
            expect(fetchUrl.searchParams.get("versionDescriptor.versionType")).toBe("branch");
            expect(fetchUrl.searchParams.get("download")).toBe("true");
            expect(fetchUrl.searchParams.get("includeContent")).toBe("true");
            expect(fetchUrl.searchParams.get("api-version")).toBe("7.1");
            expect(fetchUrl.searchParams.get("token")).toBe("abc");
            expect(fetchUrl.searchParams.get("cache")).toBe("1");
            expect(fetchUrl.searchParams.has("_a")).toBe(false);
            expect(fetchUrl.searchParams.has("version")).toBe(false);
        });

        test("supports Azure tag/commit versions and visualstudio.com URLs", () => {
            const tag = normalizeAddonUpdateUrl(
                "https://Org.visualstudio.com/Project/_git/Repo?path=%2FTest.theme.css&version=GTv2.0&sig=keep"
            );
            expect(tag).toMatchObject({
                valid: true,
                provider: "azure-devops",
                repositoryIdentity: "org.visualstudio.com/project/repo"
            });
            if (!tag.valid || !tag.fetchUrl) throw new Error("Expected a direct Azure tag URL");
            expect(new URL(tag.fetchUrl).searchParams.get("versionDescriptor.versionType")).toBe("tag");
            expect(new URL(tag.fetchUrl).searchParams.get("sig")).toBe("keep");

            const commit = normalizeAddonUpdateUrl(
                "https://Org.visualstudio.com/DefaultCollection/Project/_git/Repo?path=%2FTest.plugin.js&version=GC0123456789abcdef0123456789abcdef01234567"
            );
            expect(commit).toMatchObject({valid: true, provider: "azure-devops"});
            if (!commit.valid || !commit.fetchUrl) throw new Error("Expected a direct Azure commit URL");
            const commitUrl = new URL(commit.fetchUrl);
            expect(commitUrl.pathname).toBe("/DefaultCollection/Project/_apis/git/repositories/Repo/items");
            expect(commitUrl.searchParams.get("versionDescriptor.versionType")).toBe("commit");
        });

        test("accepts exact Azure Items API URLs and rejects ambiguous web pages", () => {
            const direct = "https://dev.azure.com/Org/Project/_apis/git/repositories/Repo/items?path=%2FTest.plugin.js&download=true&api-version=7.1";
            expect(normalizeAddonUpdateUrl(direct)).toMatchObject({
                valid: true,
                fetchUrl: direct,
                provider: "azure-devops",
                repositoryIdentity: "dev.azure.com/org/project/repo"
            });

            const unsupported = [
                "https://dev.azure.com/Org/Project/_git/Repo",
                "https://dev.azure.com/Org/Project/_git/Repo?path=%2FTest.plugin.js",
                "https://dev.azure.com/Org/Project/_git/Repo?path=%2FTest.plugin.js&version=XXmain",
                "https://dev.azure.com/Org/Project/_git/Repo?path=%2FTest.plugin.js&version=GCnot-a-commit",
                "https://dev.azure.com/Org/Project/_git/Repo/commit/deadbeef"
            ];
            for (const url of unsupported) {
                expect(normalizeAddonUpdateUrl(url)).toEqual({valid: false, reason: "unsupported-page"});
            }
        });

        test("converts SourceHut tree item URLs and accepts blob URLs", () => {
            expect(normalizeAddonUpdateUrl(
                "https://git.sr.ht/~User/Repo/tree/main/item/addons/Test.plugin.js?download=1"
            )).toMatchObject({
                valid: true,
                fetchUrl: "https://git.sr.ht/~User/Repo/blob/main/addons/Test.plugin.js?download=1",
                provider: "sourcehut",
                repositoryIdentity: "git.sr.ht/~user/repo"
            });
            expect(directUrl("https://git.sr.ht/~User/Repo/blob/main/Test.plugin.js")).toBe(
                "https://git.sr.ht/~User/Repo/blob/main/Test.plugin.js"
            );
        });
    });

    describe("gists and snippets", () => {
        test("classifies GitHub gist pages for exact-file API resolution", () => {
            const result = normalizeAddonUpdateUrl("https://gist.github.com/Owner/abcdef123456#file-wrong-plugin-js", {
                expectedFilename: "Expected.plugin.js"
            });

            expect(result).toMatchObject({
                valid: true,
                fetchUrl: null,
                provider: "github-gist",
                resolution: "descriptor",
                descriptor: {
                    kind: "github-gist",
                    apiUrl: "https://api.github.com/gists/abcdef123456",
                    expectedFilename: "Expected.plugin.js",
                    selection: "exact-filename-or-single-addon"
                }
            });
        });

        test("accepts exact raw gist URLs without API resolution", () => {
            const raw = "https://gist.githubusercontent.com/Owner/abcdef123456/raw/revision/Test.plugin.js";
            expect(directUrl(raw)).toBe(raw);
        });

        test("classifies global and project GitLab snippets without selecting a file", () => {
            expect(normalizeAddonUpdateUrl("https://gitlab.com/-/snippets/123?private_token=token", {
                expectedFilename: "Test.plugin.js"
            })).toMatchObject({
                valid: true,
                fetchUrl: null,
                provider: "gitlab-snippet",
                descriptor: {
                    apiUrl: "https://gitlab.com/api/v4/snippets/123?private_token=token",
                    expectedFilename: "Test.plugin.js",
                    metadataFallback: {
                        filenameField: "file_name",
                        rawUrlField: "raw_url"
                    }
                }
            });

            expect(normalizeAddonUpdateUrl("https://gitlab.com/group/sub/repo/-/snippets/456", {
                expectedFilename: "Test.theme.css"
            })).toMatchObject({
                valid: true,
                fetchUrl: null,
                descriptor: {
                    apiUrl: "https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo/snippets/456",
                    expectedFilename: "Test.theme.css"
                }
            });

            expect(directUrl("https://gitlab.com/group/repo/-/snippets/456/raw/main/Test.plugin.js")).toBe(
                "https://gitlab.com/group/repo/-/snippets/456/raw/main/Test.plugin.js"
            );

            expect(normalizeAddonUpdateUrl("https://gitlab.internal/group/repo/-/snippets/456", {
                expectedFilename: "Test.plugin.js",
                gitlabHosts: ["gitlab.internal"]
            })).toMatchObject({
                valid: true,
                provider: "gitlab-snippet",
                resolution: "descriptor"
            });

            const unrelated = normalizeAddonUpdateUrl("https://github.com/group/repo/-/snippets/456");
            expect(unrelated).toMatchObject({valid: true, provider: "github", resolution: "direct"});

            expect(normalizeAddonUpdateUrl("https://forge.example/group/repo/-/snippets/456")).toMatchObject({
                valid: true,
                provider: "generic",
                resolution: "direct"
            });
            expect(normalizeAddonUpdateUrl("https://gitlab.com/group/repo/-/snippets/not-an-id")).toEqual({
                valid: false,
                reason: "unsupported-page"
            });
            expect(normalizeAddonUpdateUrl("https://gitlab.com/group/repo/-/snippets/456/edit")).toEqual({
                valid: false,
                reason: "unsupported-page"
            });
        });

        test("classifies Bitbucket snippet pages and accepts exact API file URLs", () => {
            expect(normalizeAddonUpdateUrl("https://bitbucket.org/snippets/Workspace/abc123", {
                expectedFilename: "Test.plugin.js"
            })).toMatchObject({
                valid: true,
                fetchUrl: null,
                provider: "bitbucket-snippet",
                descriptor: {
                    apiUrl: "https://api.bitbucket.org/2.0/snippets/Workspace/abc123",
                    expectedFilename: "Test.plugin.js"
                }
            });

            const exact = "https://api.bitbucket.org/2.0/snippets/Workspace/abc123/files/Test.plugin.js";
            expect(directUrl(exact)).toBe(exact);

            const revision = "https://api.bitbucket.org/2.0/snippets/Workspace/abc123/deadbeef/files/Test.plugin.js";
            expect(directUrl(revision)).toBe(revision);

            expect(normalizeAddonUpdateUrl(
                "https://api.bitbucket.org/2.0/snippets/Workspace/abc123/comments"
            )).toEqual({valid: false, reason: "unsupported-page"});

            expect(normalizeAddonUpdateUrl(
                "https://api.bitbucket.org/2.0/repositories/Workspace/Repo/commits/main"
            )).toEqual({valid: false, reason: "unsupported-page"});
        });
    });

    describe("paste providers", () => {
        test("normalizes Pastebin, dpaste and Pastes.io pages", () => {
            expect(directUrl("https://pastebin.com/AbC_123?download=1#preview")).toBe(
                "https://pastebin.com/raw/AbC_123?download=1"
            );
            expect(directUrl("https://dpaste.com/ABCDE?x=1")).toBe("https://dpaste.com/ABCDE.txt?x=1");
            expect(directUrl("https://pastes.io/abc-def")).toBe("https://pastes.io/raw/abc-def");
        });

        test("normalizes only known or explicitly configured Hastebin hosts", () => {
            expect(directUrl("https://hastebin.com/share/abc123?token=1")).toBe(
                "https://hastebin.com/raw/abc123?token=1"
            );

            expect(directUrl("https://unknown-haste.example/abc123")).toBe(
                "https://unknown-haste.example/abc123"
            );

            const configured = normalizeAddonUpdateUrl("https://maintained-haste.example/abc123", {
                hastebinHosts: ["maintained-haste.example"]
            });
            expect(configured).toMatchObject({
                valid: true,
                fetchUrl: "https://maintained-haste.example/raw/abc123",
                provider: "hastebin"
            });
        });

        test("rejects PrivateBin/ZeroBin encrypted pages instead of discarding their key", () => {
            expect(normalizeAddonUpdateUrl("https://privatebin.net/?abcdef#decryption-key")).toEqual({
                valid: false,
                reason: "encrypted-paste-unsupported"
            });
            expect(normalizeAddonUpdateUrl("https://paste.example/tools/zerobin/?abcdef#key")).toEqual({
                valid: false,
                reason: "encrypted-paste-unsupported"
            });
            expect(normalizeAddonUpdateUrl("https://encrypted.example/?abcdef#key", {
                encryptedPasteHosts: ["encrypted.example"]
            })).toEqual({valid: false, reason: "encrypted-paste-unsupported"});
        });
    });

    describe("repository identity helpers", () => {
        test("matches source repository roots to raw update URLs", () => {
            // Keep expected identities explicit for TypeScript 5.7's strict Bun matcher types.
            const source = getAddonRepositoryIdentity("https://github.com/Owner/Repo.git");
            const update = getAddonRepositoryIdentity("https://raw.githubusercontent.com/Owner/Repo/main/Test.plugin.js");
            expect(source?.repositoryIdentity).toBe("github.com/owner/repo");
            expect(update?.repositoryIdentity).toBe("github.com/owner/repo");

            const forgeSource = getAddonRepositoryIdentity("https://git.slowb.ro/Owner/Repo");
            const forgeUpdate = getAddonRepositoryIdentity(
                "https://git.slowb.ro/Owner/Repo/raw/branch/main/Test.plugin.js"
            );
            expect(forgeSource?.repositoryIdentity).toBe("git.slowb.ro/owner/repo");
            expect(forgeUpdate?.repositoryIdentity).toBe("git.slowb.ro/owner/repo");
            expect(getAddonRepositoryIdentity(
                "https://git.slowb.ro/Owner/Repo/src/branch/main"
            )?.repositoryIdentity).toBe("git.slowb.ro/owner/repo");

            const gitlabSource = getAddonRepositoryIdentity("https://gitlab.com/Group/Repo/-/tree/main");
            const gitlabUpdate = getAddonRepositoryIdentity(
                "https://gitlab.com/Group/Repo/-/raw/main/Test.plugin.js"
            );
            expect(gitlabSource?.repositoryIdentity).toBe("gitlab.com/group/repo");
            expect(gitlabUpdate?.repositoryIdentity).toBe("gitlab.com/group/repo");

            expect(getAddonRepositoryIdentity("https://bitbucket.org/Owner/Repo")?.repositoryIdentity).toBe(
                "bitbucket.org/owner/repo"
            );
            expect(getAddonRepositoryIdentity("https://git.sr.ht/~Owner/Repo")?.repositoryIdentity).toBe(
                "git.sr.ht/~owner/repo"
            );
            expect(getAddonRepositoryIdentity(
                "https://stash.example/projects/PROJ/repos/Repo"
            )?.repositoryIdentity).toBe("stash.example/projects/proj/repos/repo");
            expect(getAddonRepositoryIdentity(
                "https://dev.azure.com/Org/Project/_git/Repo"
            )?.repositoryIdentity).toBe("dev.azure.com/org/project/repo");
        });

        test("recognizes only BetterDiscord plugin/theme filenames", () => {
            expect(isAddonUpdateFilename("Example.plugin.js")).toBe(true);
            expect(isAddonUpdateFilename("Example.theme.css")).toBe(true);
            expect(isAddonUpdateFilename("Example.js")).toBe(false);
            expect(isAddonUpdateFilename("Example.plugin.js.html")).toBe(false);
        });
    });
});
