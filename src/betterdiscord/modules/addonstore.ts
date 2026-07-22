import path from "path";
import fs from "fs";

import request from "@polyfill/request";

import Logger from "@common/logger";
import Toasts from "@stores/toasts";
import JsonStore from "@stores/json";
import {t} from "@common/i18n";
import React from "react";
import PluginManager from "@modules/pluginmanager";
import ThemeManager from "@modules/thememanager";
import Modals from "@ui/modals";
import InstallModal from "@ui/modals/installmodal";
import Settings from "@stores/settings";
import Web from "@data/web";
import AddonManager from "./addonmanager";
import type {BdWebGuild, BdWebAddon} from "../types/betterdiscordweb";
import {parseJsDoc} from "@common/utils";
import type {Addon as AddonType} from "@typed/addon";
import Store from "@stores/base";
import {getAddonUpdateRateLimitDelay, isAddonUpdateRateLimitResponse} from "@utils/addonupdatestate";
import {fetch} from "./net";


function showConfirmDelete(addon: AddonType) {
    return new Promise<boolean>(resolve => {
        Modals.showConfirmationModal(t("Modals.confirmAction"), t("Addons.confirmDelete", {name: addon.name}), {
            danger: true,
            confirmText: t("Addons.deleteAddon"),
            onConfirm: () => {resolve(true);},
            onCancel: () => {resolve(false);}
        });
    });
}

export class Guild {
    name: string;
    id: string;
    invite: string;
    hash?: string;

    private static cache: Record<string, Guild> = {};

    public static from(guild: BdWebGuild) {
        if (typeof this.cache[guild.snowflake] === "object") {
            const cached = this.cache[guild.snowflake];

            cached.name = guild.name;
            cached.invite = guild.invite_link;
            cached.hash = guild.avatar_hash;

            return cached;
        }

        return new this(guild);
    }

    private constructor(guild: BdWebGuild) {
        this.name = guild.name;
        this.id = guild.snowflake;

        this.invite = guild.invite_link;

        this.hash = guild.avatar_hash?.trim?.();
    }

    public get url() {
        let filename = `${this.hash}.webp`;
        if (filename.startsWith("a_")) filename = `${this.hash}.gif`;

        return `https://cdn.discordapp.com/icons/${this.id}/${filename}?size=256`;
    }

    public get acronym() {return this.name.replace(/'s /g, " ").replace(/\w+/g, str => str[0]).replace(/\s/g, "");}

    /**
     * Shows the guild join modal (if the addon has a guild)
     */
    public join() {
        Modals.showGuildJoinModal(this.invite);
    }
}

export class Addon {
    id: number;
    name: string;
    avatar: string;
    author: string;
    manager: AddonManager;
    filename: string;
    type: "theme" | "plugin";
    description: string;
    likes: number;
    downloads: number;
    tags: string[];
    thumbnail: string | null;
    releaseDate: Date;
    lastModified: Date;
    guild: Guild | null;
    version: string;
    latestSourceUrl: string;

    // unused but good for debug
    public _addon: BdWebAddon;

    public static cache: Record<string, Addon> = {};

    /**
     * Update pre-existing addon class without create a new one
     */
    public static from(addon: BdWebAddon) {
        // Dont create a new one if addon already exists
        // Just sync data
        if (typeof this.cache[addon.id] === "object") {
            const cached = this.cache[addon.id];

            cached.downloads = Math.max(cached.downloads, addon.downloads);
            cached.likes = Math.max(cached.likes, addon.likes);

            const guild = addon.guild || addon.author.guild;
            cached.guild = guild ? Guild.from(guild) : null;

            cached.latestSourceUrl = addon.latest_source_url;
            cached.version = addon.version;
            cached.description = addon.description;
            cached.tags = addon.tags;
            cached.thumbnail = Web.resources.thumbnail(addon.thumbnail_url);

            cached._addon = addon;

            return cached;
        }

        return new this(addon);
    }

    /**
     * Do not directly call
     */
    private constructor(addon: BdWebAddon) {
        this.id = addon.id;
        this.name = addon.name;

        this.releaseDate = new Date(addon.initial_release_date);
        this.lastModified = new Date(addon.latest_release_date);

        this.type = addon.type;

        this.thumbnail = Web.resources.thumbnail(addon.thumbnail_url);
        this.avatar = `https://avatars.githubusercontent.com/u/${addon.author.github_id}?v=4`;
        this.author = addon.author.display_name;

        const guild = addon.guild || addon.author.guild;
        this.guild = guild ? Guild.from(guild) : null;

        this.manager = addon.type === "plugin" ? PluginManager : ThemeManager;

        this.description = addon.description;

        this.tags = addon.tags;

        this.downloads = addon.downloads;
        this.likes = addon.likes;

        this.version = addon.version;

        this.filename = addon.file_name;

        this.latestSourceUrl = addon.latest_source_url;

        this._addon = addon;

        Addon.cache[addon.id] = this;
    }

    /**
     * To prompt new addons
     */
    public isUnknown() {
        return addonStore.isUnknown(this.filename);
    }

    /**
     * To hide the badge
     */
    public markAsKnown() {
        addonStore.markAsKnown(this.filename);
    }

    /**
     * Opens the Theme preview site
     */
    public openPreview() {
        if (this.type === "plugin") {
            throw new Error("Addon is a plugin!");
        }

        window.open(Web.convertToPreviewURL(this.latestSourceUrl), "_blank", "noopener,noreferrer");
    }

    /**
     * Opens the BD site's page for the addon
     */
    public openAddonPage() {
        window.open(Web.redirects[this.type](this.id.toString()), "_blank", "noopener,noreferrer");
    }

    /**
     * Opens the addons github page
     */
    public openSourceCode() {
        window.open(Web.convertRawToGitHubURL(this.latestSourceUrl), "_blank", "noopener,noreferrer");
    }

    /**
     * Opens the raw code page
     */
    public openAuthorPage() {
        window.open(Web.pages.developer(this.author), "_blank", "noopener,noreferrer");
    }

    /**
     * Attempt to download addon
     * Shows a confirmation modal (unless skipped) and installs the addon
     *
     * If the addon is installed or gets installed (before the modal closes),
     * it will close the modal and resolve
     * @param shouldSkipConfirm Should skip the confirm to delete the addon
     */
    public async download(shouldSkipConfirm = false) {
        if (this.isInstalled()) {
            Toasts.show(t("Addons.alreadyInstalled", {name: this.name}), {
                type: "info"
            });

            return;
        }

        const install = (shouldEnable: boolean) => new Promise<void>((resolve, reject) => {
            request(Web.redirects.github(this.id.toString()), {
                headers: {
                    "X-Store-Download": this.name,
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                }
                // TODO: fix types when translating the request polyfill
            }, (err: Error, req: {aborted: boolean, statusMessage: string;}, text: string) => {
                try {
                    if (err || req.aborted || req.statusMessage !== "OK") {
                        throw err || req;
                    }

                    if (shouldEnable) {
                        // Shouldn't need a try..catch but better safe than sorry
                        try {
                            const meta = parseJsDoc(text);
                            this.manager.state[meta.name as string || this.name] = true;
                        }
                        catch {
                            this.manager.state[this.name] = true;
                        }

                        this.manager.saveState();
                    }

                    fs.writeFileSync(path.join(this.manager.addonFolder, this.filename), text);

                    Toasts.show(t("Addons.successfullyDownload", {name: this.name}), {
                        type: "success"
                    });

                    this.downloads++;
                }
                catch (error) {
                    Logger.stacktrace("AddonStore", `Failed to fetch addon '${this.filename}':`, error as Error);

                    Toasts.show(t("Addons.failedToDownload", {context: this.type, name: this.name}), {
                        type: "error"
                    });

                    reject(error);
                }
                finally {
                    resolve();
                }
            });
        });

        return this._download ??= new Promise((resolve) => {
            const onFinish = () => {
                delete this._download;
                resolve();
            };

            if (shouldSkipConfirm) return install(Settings.get("settings", "store", "alwaysEnable")).finally(() => onFinish());

            let installing = false;

            const key = Modals.ModalActions.openModal((props) => React.createElement(InstallModal, {
                ...props,
                addon: this,
                install: (shouldEnable: boolean) => {
                    installing = true;
                    return install(shouldEnable);
                }
            }), {
                onCloseCallback: onFinish,
                // Override the on close request to make it only close when not installing
                onCloseRequest() {
                    // If installing make it so the modal cannot close until install is finished
                    if (installing) return;
                    Modals.ModalActions.closeModal(key);
                },
                // backdropStyle: "BLUR"
            });
        });
    }

    _download?: Promise<void>;

    /**
     * Attempt to delete the local addon
     * @param shouldSkipConfirm Should skip the confirm to delete the addon
     */
    public async delete(shouldSkipConfirm = false) {
        const foundAddon = this.manager.addonList.find(a => a.filename == this.filename);

        if (!foundAddon) return;

        if (!shouldSkipConfirm) {
            const shouldDelete = await showConfirmDelete(foundAddon);
            if (!shouldDelete) return;
        }

        if (this.manager.deleteAddon) this.manager.deleteAddon(foundAddon);
    }

    public isInstalled() {
        return this.manager.isLoaded(this.filename);
    }

    public recentlyUpdated() {
        const now = new Date();
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);

        return this.lastModified > oneWeekAgo && this.lastModified <= now;
    }
}

const CATALOGUE_TIMEOUT_MS = 30_000;

type CatalogueCancelReason = "disabled" | "offline";

interface CatalogueRequest {
    id: number;
    controller: AbortController;
    cancelReason: CatalogueCancelReason | null;
    offlineListener: () => void;
    staleLogged: boolean;
    promise: Promise<void>;
}

const addonStore = new class AddonStore extends Store {
    public hasDoneFirstRequest = false;
    /** Last successful network catalogue load; updater freshness may reuse Store activity. */
    public lastSuccessfulRequestAt = 0;

    // Fork review: retain the actual transport promise and its identity; upstream's detached
    // resolver lets initiating callers continue early and can be left pending by offline exits.
    #promise: Promise<void> = Promise.resolve();
    #activeRequest: CatalogueRequest | null = null;
    #requestSequence = 0;
    #successfulRequestSequence = 0;
    #waitingForOnline = false;
    #rateLimitBlockedUntil = 0;
    #rateLimitFailureCount = 0;
    #rateLimitSkipWarningUntil = 0;

    public get promise() {
        return this.#promise;
    }

    public initialize() {
        const stored = JsonStore.get("addon-store") as Partial<{addons: Record<string, BdWebAddon>; known: string[]; version: string;}> | undefined;

        // Fork review: old or malformed cache shapes must not turn `known` into a non-array.
        const storedAddons = stored?.addons;
        const storedKnown = stored?.known;
        const addonsAreValid = Boolean(storedAddons) && typeof storedAddons === "object" && !Array.isArray(storedAddons);
        const knownIsValid = Array.isArray(storedKnown);

        if (stored && Object.prototype.hasOwnProperty.call(stored, "addons") && !addonsAreValid) Logger.warn("AddonStore", "Cached addon catalogue was invalid; resetting it.");
        if (stored && Object.prototype.hasOwnProperty.call(stored, "known") && !knownIsValid) Logger.warn("AddonStore", "Cached known-addon list was invalid; resetting it.");

        this._cache = {
            addons: addonsAreValid ? storedAddons as Record<string, BdWebAddon> : {},
            known: knownIsValid ? [...storedKnown] : [],
            version: typeof stored?.version === "string" ? stored.version : ""
        };

        if (this._cache.version !== Web.API_VERSION) {
            Logger.debug("AddonStore", "Resetting the cached catalogue for a new API version.");
            this._cache = {
                known: this._cache.known,
                addons: {},
                version: Web.API_VERSION
            };
        }

        // window.AddonStore = this;

        const isEnabled = () => (
            Settings.get<boolean>("settings", "store", "bdAddonStore")
            || Settings.get<boolean>("settings", "addons", "checkForUpdates")
        );

        let wasEnabled = isEnabled();

        const handle = () => {
            const isNowEnabled = isEnabled();
            if (wasEnabled === isNowEnabled) return;

            wasEnabled = isNowEnabled;

            if (isNowEnabled) {
                Logger.debug("AddonStore", "A catalogue consumer was enabled; loading the addon catalogue.");
                this._useCache();
                void this.requestAddons(!this.hasDoneFirstRequest);
                this.hasDoneFirstRequest = true;
                return;
            }

            this._stopCatalogueActivity();
        };

        Settings.on("settings", "store", "bdAddonStore", handle);
        Settings.on("settings", "addons", "checkForUpdates", handle);

        if (wasEnabled) {
            this._useCache();
            void this.requestAddons(true);
            this.hasDoneFirstRequest = true;
        }
    }

    // Caching stuff
    private _cache: {addons: Record<string, BdWebAddon>; known: string[]; version: string;} = {addons: {}, known: [], version: ""};
    private _useCache() {
        // Fork review: cache fallback replaces the visible catalogue so retries cannot duplicate cards.
        this.addons.length = 0;

        for (const key in this._cache.addons) {
            if (Object.prototype.hasOwnProperty.call(this._cache.addons, key)) {
                this.addons.push(
                    Addon.from(this._cache.addons[key])
                );
            }
        }
    }

    private _writeCache(cache = this._cache) {
        this._cache = cache;

        JsonStore.set("addon-store", this._cache);
    }

    private _singleAddonCache: Record<string, Promise<Addon>> = {};
    /**
     * Request a singular addon at a time
     */
    public requestAddon(idOrName: string) {
        const cache = this.getAddon(idOrName);
        if (typeof cache === "object") return Promise.resolve(cache);

        let res: Response | undefined;

        return this._singleAddonCache[idOrName] ??= (
            fetch(Web.store.addon(idOrName), {
                headers: {
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                },
                // Individual addon requests use the shared transport's finite default timeout.
            })
                .then(x => {
                    res = x;
                    return x.json();
                })
                .then((addon: BdWebAddon) => {
                    if (!res!.ok) throw new Error((addon as unknown as {title: string;}).title);

                    this._singleAddonCache[addon.name] = this._singleAddonCache[idOrName];
                    this._singleAddonCache[addon.id] = this._singleAddonCache[idOrName];

                    return Addon.from(addon);
                })
                .catch((error) => {
                    const failure = error instanceof Error ? error : new Error(`Failed to request addon: Status ${res?.status || "Unknown"}`);
                    if (/timed out/i.test(failure.message)) Logger.warn("AddonStore", `Timed out fetching addon '${idOrName}'.`, failure);
                    else Logger.stacktrace("AddonStore", `Failed to fetch ${idOrName}`, failure);

                    Toasts.show(t("Addons.failedToFetch"), {
                        type: "error"
                    });

                    // To allow future fetches
                    delete this._singleAddonCache[idOrName];

                    throw failure;
                })
        );
    }

    /**
     * Gets a addon via id or name
     */
    public getAddon(id: string) {
        const decoded = decodeURIComponent(id.toString()).toLowerCase();

        for (const key in Addon.cache) {
            if (Object.prototype.hasOwnProperty.call(Addon.cache, key)) {
                const addon = Addon.cache[key];

                if (addon.id.toString() === decoded || addon.name.toLowerCase() === decoded || addon.filename.toLowerCase() === decoded) return addon;
            }
        }
    }

    /**
     * Determines whether an addon is official
     * Disabled currently
     */
    public isOfficial(/* filename */) {
        return false;
        // return filename.toLowerCase() in this._cache.addons;
    }

    public isUnknown(filename: string) {
        return filename.toLowerCase() in this._cache.addons && !this._cache.known.includes(filename);
    }

    public markAsKnown(filename: string) {
        if (this.isUnknown(filename)) {
            this._cache.known.push(filename);

            this._writeCache();
        }
    }

    private readonly addons: Addon[] = [];
    getAddons() {return this.addons.concat();}

    error: Error | null = null;
    loading = false;

    private _isEnabled() {
        return Boolean(
            Settings.get<boolean>("settings", "store", "bdAddonStore")
            || Settings.get<boolean>("settings", "addons", "checkForUpdates")
        );
    }

    private _clearRetry() {
        if (!this._setTimeout) return;
        window.clearTimeout(this._setTimeout);
        this._setTimeout = null;
        Logger.debug("AddonStore", "Cleared the scheduled catalogue refresh.");
    }

    private _removeOnlineListener() {
        window.removeEventListener("online", this._onLineListener);
        this.#waitingForOnline = false;
    }

    private _waitForOnline() {
        if (this.#waitingForOnline) return;
        this.#waitingForOnline = true;
        window.addEventListener("online", this._onLineListener);
    }

    private _onLineListener = () => {
        this._removeOnlineListener();

        if (!this._isEnabled()) {
            Logger.debug("AddonStore", "Ignored reconnect refresh because no catalogue consumer is enabled.");
            return;
        }

        Logger.info("AddonStore", "Connection restored; refreshing the addon catalogue.");
        void this.requestAddons();
    };

    private _stopCatalogueActivity() {
        this._clearRetry();

        if (this.#waitingForOnline) {
            Logger.debug("AddonStore", "Stopped waiting for a reconnect because no catalogue consumer is enabled.");
            this._removeOnlineListener();
        }

        const activeRequest = this.#activeRequest;
        if (activeRequest) {
            // Fork review: abort and detach so a late completion cannot restore loading or timers.
            activeRequest.cancelReason = "disabled";
            window.removeEventListener("offline", activeRequest.offlineListener);
            Logger.warn("AddonStore", `Cancelling catalogue request #${activeRequest.id} because the Addon Store and addon updates are disabled.`);
            activeRequest.controller.abort();
            this.#activeRequest = null;
        }

        if (this.loading || activeRequest) {
            this.loading = false;
            this.emitChange();
        }

        this.#promise = Promise.resolve();
    }

    private _handleOffline(catalogueRequest?: CatalogueRequest, requestFailure?: Error) {
        const firstDisconnectNotice = !this.#waitingForOnline;
        this._clearRetry();

        if (catalogueRequest && this.#activeRequest === catalogueRequest) {
            catalogueRequest.cancelReason = "offline";
            window.removeEventListener("offline", catalogueRequest.offlineListener);
            if (requestFailure) {
                Logger.warn("AddonStore", `Catalogue request #${catalogueRequest.id} failed because the client went offline.`, requestFailure);
            }
            else {
                Logger.warn("AddonStore", `Cancelling catalogue request #${catalogueRequest.id} because the client went offline.`);
                catalogueRequest.controller.abort();
            }
            this.#activeRequest = null;
        }

        this.loading = false;
        this.error = new Error("Failed to request addons: User is offline!");
        this._useCache();
        this._waitForOnline();

        if (firstDisconnectNotice) {
            Logger.info("AddonStore", "Connection lost; using the cached catalogue until the client reconnects.");
            Toasts.show(t("Addons.failedToFetch"), {type: "error"});
        }

        this.emitChange();
    }

    private _isCurrentRequest(catalogueRequest: CatalogueRequest, phase: string) {
        if (this.#activeRequest === catalogueRequest) return true;

        if (!catalogueRequest.staleLogged) {
            const message = `Ignored ${phase} from stale catalogue request #${catalogueRequest.id}.`;
            if (catalogueRequest.cancelReason) Logger.debug("AddonStore", message, `Cancellation reason: ${catalogueRequest.cancelReason}.`);
            else Logger.warn("AddonStore", message);
            catalogueRequest.staleLogged = true;
        }

        return false;
    }

    public requestAddons(firstRun = false, forceUpdaterRequest = false): Promise<void> {
        if (!this._isEnabled() && !forceUpdaterRequest) {
            Logger.debug("AddonStore", "Skipped catalogue request because no catalogue consumer is enabled.");
            this.#promise = Promise.resolve();
            return this.#promise;
        }

        if (this.#activeRequest) {
            // Fork review: Store and updater consumers must wait on the exact same request.
            Logger.debug("AddonStore", `Reusing in-flight catalogue request #${this.#activeRequest.id}.`);
            return this.#activeRequest.promise;
        }

        const now = Date.now();
        if (this.#rateLimitBlockedUntil > now) {
            if (this.#rateLimitSkipWarningUntil !== this.#rateLimitBlockedUntil) {
                this.#rateLimitSkipWarningUntil = this.#rateLimitBlockedUntil;
                Logger.warn("AddonStore", "Skipped a catalogue refresh while its provider rate-limit pause is still active.");
            }
            this._useCache();
            this.#promise = Promise.resolve();
            return this.#promise;
        }
        if (this.#rateLimitBlockedUntil) {
            Logger.info("AddonStore", "Catalogue rate-limit pause ended; refresh requests may resume.");
            this.#rateLimitBlockedUntil = 0;
            this.#rateLimitSkipWarningUntil = 0;
        }

        if (!window.navigator.onLine) {
            if (this.#waitingForOnline) Logger.debug("AddonStore", "Skipped repeated catalogue request while waiting for reconnect.");
            else Logger.warn("AddonStore", "Skipping catalogue request because the client is offline.");
            this._handleOffline();
            this.#promise = Promise.resolve();
            return this.#promise;
        }

        if (this.#waitingForOnline) {
            this._removeOnlineListener();
            Logger.info("AddonStore", "Connection is available again; refreshing the addon catalogue.");
        }

        this._clearRetry();

        const catalogueRequest: CatalogueRequest = {
            id: ++this.#requestSequence,
            controller: new AbortController(),
            cancelReason: null,
            offlineListener: () => {},
            staleLogged: false,
            promise: Promise.resolve()
        };

        catalogueRequest.offlineListener = () => this._handleOffline(catalogueRequest);

        Logger.debug("AddonStore", `Starting catalogue request #${catalogueRequest.id}.`);

        if (!(firstRun && Object.keys(this._cache.addons).length)) {
            this.addons.length = 0;
        }

        this.loading = true;
        this.emitChange();

        window.addEventListener("offline", catalogueRequest.offlineListener);

        let response: Response | undefined;
        const promise = fetch(Web.store.addons, {
            headers: {
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            },
            signal: catalogueRequest.controller.signal,
            // Fork review: upstream's unlimited wait can leave the shared Store promise and UI pending forever.
            timeout: CATALOGUE_TIMEOUT_MS
        })
            .then(async (res) => {
                response = res;
                if (!this._isCurrentRequest(catalogueRequest, "response")) return;

                if (!res.ok) {
                    const error = new Error(`Addon catalogue returned HTTP ${res.status} ${res.statusText}`.trim());
                    error.name = "AddonStoreHTTPError";
                    throw error;
                }

                const json = await res.json() as unknown;
                if (!this._isCurrentRequest(catalogueRequest, "decoded response")) return;

                if (!Array.isArray(json)) {
                    const error = new Error("Addon catalogue response was not an array.");
                    error.name = "AddonStoreDataError";
                    throw error;
                }

                const isFirstRun = this._cache.known.length === 0 && Object.keys(this._cache.addons).length === 0;

                const data: {addons: Record<string, BdWebAddon>, version: string, known: string[];} = {
                    known: [...this._cache.known],
                    addons: {},
                    version: Web.API_VERSION
                };

                this.addons.length = 0;

                for (const addon of json as BdWebAddon[]) {
                    this.addons.push(Addon.from(addon));

                    data.addons[addon.file_name.toLowerCase()] = addon;
                    if (isFirstRun) {
                        data.known.push(addon.file_name);
                    }
                }

                this._writeCache(data);

                this.error = null;
                this.lastSuccessfulRequestAt = Date.now();
                this.#successfulRequestSequence++;
                this.#rateLimitBlockedUntil = 0;
                this.#rateLimitFailureCount = 0;
                this.#rateLimitSkipWarningUntil = 0;
                Logger.debug("AddonStore", `Catalogue request #${catalogueRequest.id} loaded ${json.length} addons.`);
            })
            .catch((error) => {
                if (catalogueRequest.cancelReason) return;

                if (!this._isCurrentRequest(catalogueRequest, "failure")) return;

                const failure = error instanceof Error ? error : new Error(`Failed to request addons: Status ${response?.status || "Unknown"}`);
                const rateLimited = Boolean(response && isAddonUpdateRateLimitResponse(response.status, response.headers));
                void response?.body?.cancel().catch(() => {});

                if (!window.navigator.onLine) {
                    this._handleOffline(catalogueRequest, failure);
                    return;
                }

                if (rateLimited) {
                    const rateLimit = getAddonUpdateRateLimitDelay(response!.headers, {
                        now: Date.now(),
                        failureCount: this.#rateLimitFailureCount,
                        jitter: base => Math.min(5_000, Math.max(250, Math.round(base * 0.02 * Math.random())))
                    });
                    this.#rateLimitBlockedUntil = rateLimit.blockedUntil;
                    this.#rateLimitFailureCount = rateLimit.nextFailureCount;
                    this.#rateLimitSkipWarningUntil = 0;
                    // Fork review: rate limits are scheduling information, not an addon failure.
                    // Keep them in diagnostics and make manual refreshes honor the same reset.
                    Logger.warn("AddonStore", `Catalogue request #${catalogueRequest.id} was rate limited; retrying after the provider reset window.`, failure);
                }
                else if (/timed out/i.test(failure.message)) {
                    Logger.warn("AddonStore", `Catalogue request #${catalogueRequest.id} timed out after ${CATALOGUE_TIMEOUT_MS / 1000} seconds of inactivity.`, failure);
                }
                else if (failure.name === "AddonStoreHTTPError") {
                    Logger.warn("AddonStore", `Catalogue request #${catalogueRequest.id} received an HTTP error.`, failure);
                }
                else if (failure.name === "AbortError") {
                    Logger.warn("AddonStore", `Catalogue request #${catalogueRequest.id} was cancelled unexpectedly.`, failure);
                }
                else {
                    Logger.stacktrace("AddonStore", `Catalogue request #${catalogueRequest.id} failed`, failure);
                }

                if (!rateLimited) {
                    Toasts.show(t("Addons.failedToFetch"), {
                        type: "error"
                    });
                }

                this.error = failure;

                this._useCache();
            })
            .finally(() => {
                window.removeEventListener("offline", catalogueRequest.offlineListener);
                if (!this._isCurrentRequest(catalogueRequest, "completion")) return;

                this.#activeRequest = null;
                this.loading = false;
                this.emitChange();
                this._scheduleNextRequest();
            });

        catalogueRequest.promise = promise;
        this.#activeRequest = catalogueRequest;
        this.#promise = promise;
        return promise;
    }

    public async updaterRequestAddons(force = false): Promise<boolean> {
        // Manual addon checks still work when automatic checks and the Store UI are disabled.
        const previousSuccessSequence = this.#successfulRequestSequence;
        await this.requestAddons(this.hasDoneFirstRequest, force);
        this.hasDoneFirstRequest = true;
        return this.#successfulRequestSequence > previousSuccessSequence;
    }

    private _scheduleNextRequest() {
        if (!Settings.get<boolean>("settings", "store", "bdAddonStore")) {
            Logger.debug("AddonStore", "Skipped the Store refresh timer because only the addon updater needs the catalogue.");
            return;
        }

        if (this.error && !window.navigator.onLine) {
            Logger.info("AddonStore", "Connection unavailable; waiting to refresh the catalogue after reconnect.");
            this._waitForOnline();
            return;
        }

        let delay: number;
        if (this.#rateLimitBlockedUntil > Date.now()) {
            delay = this.#rateLimitBlockedUntil - Date.now();
        }
        else if (this.error) {
            // Fork review: upstream multiplies these failure delays by the hourly interval.
            const code = "code" in this.error ? (this.error as ErrnoException).code : undefined;
            delay = code === "ECONNRESET" ? 30_000 : 5 * 60 * 1000;
        }
        else {
            const hours = Settings.get<number>("addons", "updateInterval");
            delay = hours * 60 * 60 * 1000;
        }

        Logger.debug("AddonStore", `Scheduled the next catalogue request in ${Math.round(delay / 1000)} seconds.`);
        this._setTimeout = window.setTimeout(() => {
            this._setTimeout = null;
            void this.requestAddons();
        }, delay);
    }

    private _setTimeout: number | null = null;

    /**
     * get important data from the store to use in the ui
     */
    public getState() {
        return {
            error: this.error,
            addons: this.getAddons(),
            loading: this.loading
        };
    }
};

export default addonStore;
