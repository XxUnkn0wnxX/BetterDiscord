import Builtin from "@structs/builtin";
import {Filters, getLazy, getLazyBySource, getLazyByStrings, getMangledLazy, Stores} from "@webpack";
import {findInTree} from "@common/utils";
import {createMessageGroupingStore, type MessageGroupingSubscriber} from "@utils/messagegrouping";
import React, {createContext, useContext, useLayoutEffect, useMemo} from "react";

const MessageGroupingEvents = createContext<MessageGroupingSubscriber>(() => () => {});

// These hooks belong to our own fibers. Patch callbacks can be added or removed
// while Discord's calling components stay mounted, so they must remain hook-free.
function MessageGroupingAttributes({targetId, children}: {targetId: unknown; children: React.ReactNode;}) {
    const subscribe = useContext(MessageGroupingEvents);

    // New output can replace a DOM node while keeping the same id.
    useLayoutEffect(() => subscribe(({first, last}) => {
        if (typeof targetId !== "string") return;

        const node = document.getElementById(targetId);
        if (!node) return;

        node.setAttribute("data-message-group-start", first.toString());
        node.setAttribute("data-message-group-end", last.toString());
    }), [subscribe, targetId, children]);

    return children;
}

function MessageGroupingList({items}: {items: React.ReactNode[];}) {
    const grouping = useMemo(() => createMessageGroupingStore(), []);
    const render = grouping.createRender();

    useLayoutEffect(() => {
        grouping.commit(render);
    });
    useLayoutEffect(() => () => grouping.dispose(), [grouping]);

    const markup = items.slice();
    const messages: Array<[number, React.ReactElement<any, any>, string | undefined]> = [];
    for (let index = 0; index < items.length; index++) {
        const element = items[index];

        if (React.isValidElement(element) && typeof (element as React.ReactElement<any, any>).props.groupId === "string") {
            const messageId = (element as React.ReactElement<any, any>).props.message?.id;
            messages.push([index, element, typeof messageId === "string" ? messageId : undefined]);
        }
    }

    for (let i = 0; i < messages.length; i++) {
        const [index, element, messageId] = messages[i];
        const next = messages[i + 1];
        const previous = messages[i - 1];
        const first = !previous || previous[1].props.groupId !== element.props.groupId;
        const last = !next || next[1].props.groupId !== element.props.groupId;

        if (!messageId) continue;

        markup[index] = (
            <MessageGroupingEvents key={element.key ?? index} value={render.createSubscriber(messageId, {last, first})}>
                {element}
            </MessageGroupingEvents>
        );
    }

    return <>{markup}</>;
}

export default new class ThemeAttributes extends Builtin {
    private patchController?: AbortController;

    get name() {return "ThemeAttributes";}
    get category() {return "general";}
    get id() {return "themeAttributes";}

    async patchMessage(signal?: AbortSignal) {
        const MessageComponentModule = await getLazyBySource<any>(["Message must not be a thread starter message"], {
            cacheId: "core-themeattributes-MessageComponent",
            searchDefault: false,
            signal
        });
        if (signal?.aborted) return;
        const MessageComponent = MessageComponentModule?.A ?? MessageComponentModule;

        if (typeof MessageComponent?.type !== "function") return;

        this.after(MessageComponent!, "type", (_, [props], returnValue) => {
            const li = findInTree(returnValue, (node) => node?.className?.includes("messageListItem"), {
                walkable: ["props", "children"]
            });
            if (!li) return;

            const result = <MessageGroupingAttributes targetId={li.id}>{returnValue}</MessageGroupingAttributes>;
            const author = findInTree(props, (arg) => arg?.username, {walkable: ["message", "author"]});
            const authorId = author?.id;
            if (!authorId) return result;

            li["data-author-id"] = authorId;
            li["data-author-username"] = author?.username;
            li["data-is-self"] = author.id === Stores.UserStore?.getCurrentUser?.()?.id;

            // Deleted accounts have the discriminator 0000 but do not have bot
            li["data-is-webhook"] = author.discriminator === "0000" && author.bot;

            li["data-author-is-deleted"] = author.id === "456226577798135808";
            li["data-author-is-bot"] = author.bot && author.discriminator !== "0000";

            li["data-message-is-reply"] = props?.message?.messageReference?.type === 0;
            li["data-message-is-forward"] = props?.message?.messageReference?.type === 1;

            return result;
        });
    }

    async patchMessageHook(signal?: AbortSignal) {
        const messageHook = await getMangledLazy("SUMMARIES_UNREAD_BAR_VIEWED,{num_unread_summaries", {
            key: Filters.byStrings("SUMMARIES_UNREAD_BAR_VIEWED,{num_unread_summaries")
        }, {
            cacheId: "core-themeattributes-messageHook",
            mapDeclarations: true,
            signal
        });

        if (signal?.aborted) return;
        if (typeof messageHook?.key !== "function") return;

        this.after(messageHook!, "key", (_, __, res) => {
            const node = findInTree(res, m => m?.["data-list-id"] === "chat-messages", {
                walkable: ["props", "children"]
            });

            if (!Array.isArray(node?.children)) return;
            const streamIndex = node.children.findIndex(Array.isArray);
            if (streamIndex === -1) return;

            node.children[streamIndex] = <MessageGroupingList items={node.children[streamIndex]} />;
        });
    }

    async patchVoiceUserComponent(signal?: AbortSignal) {
        const VoiceUserComponent = await getLazyByStrings(["userNameClassName:", "avatarContainerClass:"], {
            cacheId: "core-themeattributes-VoiceUserComponent",
            defaultExport: false,
            signal
        });
        if (signal?.aborted) return;

        this.after(VoiceUserComponent!, "Ay", (_, [{speaking}], returnValue) => {
            const VoiceUser = findInTree(returnValue, (node) => node?.attributes, {walkable: ["ref", "current"]});
            if (!VoiceUser) return;
            VoiceUser.dataset.speaking = speaking;
        });
    }

    async patchTabBarComponent(signal?: AbortSignal) {
        const TabBarComponent = await getLazyByStrings<{Item: typeof React.PureComponent;}>(["({getFocusableElements:()=>{let"], {searchExports: true, firstId: 158954, cacheId: "core-themeattributes-TabBar", signal});
        if (signal?.aborted) return;

        this.after(TabBarComponent?.Item?.prototype, "render", (thisObject, _, returnValue) => {
            returnValue.props["data-tab-id"] = (thisObject as any)?.props?.id;
        });
    }

    async patchUserProfileComponent(signal?: AbortSignal) {
        const UserProfileComponent = await getLazy((m) => m.render?.toString?.().includes("pendingThemeColors"), {firstId: 946356, cacheId: "core-themeattributes-UserProfile", signal});
        if (signal?.aborted) return;

        this.after(UserProfileComponent!, "render", (_, [{user}], returnValue) => {
            returnValue.props["data-member-id"] = user.id;
            returnValue.props["data-is-self"] = !!user.email;
        });
    }

    async patchChatAvatar(signal?: AbortSignal) {
        const ChatAvatar = await getLazy(m => String(m.type).includes("showCommunicationDisabledStyles"), {
            cacheId: "core-themeattributes-ChatAvatar",
            signal
        });
        if (signal?.aborted) return;

        this.after(ChatAvatar!, "type", (_, __, res) => {
            if (res.props.avatar) {
                const avatar = findInTree(res.props.avatar, m => typeof m?.props?.children === "function");

                if (!avatar || avatar.props.__bdPatched) return;

                const children = avatar.props.children;

                Object.assign(avatar.props, {
                    children(...args: unknown[]) {
                        const ret = children.apply(this, args);

                        const pfp = findInTree(ret, m => m?.type === "img" && m?.props?.className?.includes("avatar") && m.props.ref, {
                            walkable: ["props", "children"]
                        });

                        if (!pfp?.props?.src || pfp.props.src.startsWith("data:")) return ret;

                        pfp.props.style ??= {};

                        for (const size of [128, 256, 512, 1024, 2048, 4096]) {
                            pfp.props.style[`--avatar-url-${size}`] = `url(${pfp.props.src.replace(/\d+$/, String(size))})`;
                        }

                        return ret;
                    },
                    __bdPatched: true
                });
            }
        });
    }

    async patchAvatars(signal?: AbortSignal) {
        const AvatarImg = await getLazyBySource([".displayName=\"AvatarImg\""], {
            searchDefault: false,
            cacheId: "core-themeattributes-AvatarImg",
            declarationFilter: m => m?.displayName === "AvatarImg",
            signal
        })!;
        if (signal?.aborted) return;

        this.after(AvatarImg!, "render", (_, __, res) => {
            const pfp = findInTree(res, m => m?.type === "img" && m?.props?.className?.includes("avatar"), {
                walkable: ["props", "children"]
            });

            if (!pfp?.props?.src || pfp.props.src.startsWith("data:")) return;

            pfp.props.style ??= {};

            for (const size of [128, 256, 512, 1024, 2048, 4096]) {
                pfp.props.style[`--avatar-url-${size}`] = `url(${pfp.props.src.replace(/\d+$/, String(size))})`;
            }
        });
    }

    async enabled() {
        if (this.patchController && !this.patchController.signal.aborted) return;
        this.patchController = new AbortController();
        const {signal} = this.patchController;

        this.patchMessage(signal);
        this.patchMessageHook(signal);
        this.patchTabBarComponent(signal);
        this.patchUserProfileComponent(signal);
        this.patchVoiceUserComponent(signal);
        this.patchChatAvatar(signal);
        this.patchAvatars(signal);
    }

    async disabled() {
        this.patchController?.abort();
        this.unpatchAll();
    }
};
