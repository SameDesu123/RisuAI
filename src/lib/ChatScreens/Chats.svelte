<script lang="ts">
    import type { character, groupChat, Message } from 'src/ts/storage/database.svelte';
    import { mount, onDestroy, unmount } from 'svelte';
    import Chat from './Chat.svelte';
    import { getCharImage } from 'src/ts/characters';
    import { createSimpleCharacter, DBState, selectedCharID, ReloadChatPointer } from 'src/ts/stores.svelte';
    import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte';
    import { get } from 'svelte/store';

    const getCurrentChatRoomId = () => {
        const charId = get(selectedCharID);
        if (charId < 0) return null;
        const char = DBState.db.characters[charId];
        if (!char) return null;
        return char.chats?.[char.chatPage]?.id ?? null;
    };

    let {
        messages,
        currentCharacter,
        onReroll,
        unReroll,
        currentUsername,
        userIcon,
        loadPages,
        userIconPortrait,
        hasNewUnreadMessage = $bindable(false)
    }:{
        messages: Message[]
        currentCharacter: character|groupChat
        onReroll: () => void
        unReroll: () => void
        currentUsername: string
        userIcon: string
        loadPages: number
        userIconPortrait?: boolean
        hasNewUnreadMessage?: boolean
    } = $props();

    let chatBody: HTMLDivElement;
    let hashes: Set<number> = new Set();
    let mountInstances: Map<number, {}> = new Map();

    // ─── Virtual scrolling state ───
    let measuredHeights: Map<number, number> = new Map();
    let virtualizedHashes: Set<number> = new Set();
    let hashToMessageProps: Map<number, { props: Record<string, any> }> = new Map();
    let observer: IntersectionObserver | null = null;
    let virtualScrollEnabled = true;

    //Non-cryptographic hash function to generate a unique hash for each message
    function hashCode(str:string):number {
        let hash = 0;
        for (let i = 0, len = str.length; i < len; i++) {
            let chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0; // Convert to 32bit integer
        }
        if(hash == 0){
            hash = 1; // Ensure hash is not zero
        }
        return hash;
    }

    // ─── Virtual scrolling functions ───

    function initObserver() {
        if (observer) return;
        const scrollRoot = chatBody?.parentElement;
        if (!scrollRoot) return;

        observer = new IntersectionObserver(handleVisibilityChange, {
            root: scrollRoot,
            rootMargin: '200% 0px 200% 0px',
            threshold: 0,
        });

        // Observe all existing containers
        chatBody.querySelectorAll('.chat-message-container').forEach((el) => {
            observer.observe(el);
        });
    }

    function handleVisibilityChange(entries: IntersectionObserverEntry[]) {
        if (!virtualScrollEnabled) return;

        for (const entry of entries) {
            const container = entry.target as HTMLElement;
            const hash = parseInt(container.getAttribute('x-hashed') || '0');
            if (!hash) continue;

            if (entry.isIntersecting) {
                // Near viewport → remount if virtualized
                if (virtualizedHashes.has(hash)) {
                    remountMessage(hash, container);
                }
            } else {
                // Far from viewport → virtualize if mounted
                if (!virtualizedHashes.has(hash) && mountInstances.has(hash)) {
                    // Never virtualize the newest message (first child in flex-col-reverse)
                    if (container === chatBody.firstElementChild) continue;
                    virtualizeMessage(hash, container);
                }
            }
        }
    }

    function virtualizeMessage(hash: number, container: HTMLElement) {
        const currentHeight = container.getBoundingClientRect().height;
        measuredHeights.set(hash, currentHeight);

        const inst = mountInstances.get(hash);
        if (inst) {
            unmount(inst);
            mountInstances.delete(hash);
        }

        container.innerHTML = '';
        container.style.height = `${currentHeight}px`;
        container.style.minHeight = `${currentHeight}px`;
        container.classList.add('virtualized-placeholder');

        virtualizedHashes.add(hash);
    }

    function remountMessage(hash: number, container: HTMLElement) {
        const msgInfo = hashToMessageProps.get(hash);
        if (!msgInfo) return;

        // Clear placeholder styles
        container.style.height = '';
        container.style.minHeight = '';
        container.classList.remove('virtualized-placeholder');
        container.innerHTML = '';

        const inst = mount(Chat, {
            target: container,
            props: msgInfo.props,
        });
        mountInstances.set(hash, inst);
        virtualizedHashes.delete(hash);
    }

    function disableVirtualization() {
        // Remount all virtualized messages
        for (const hash of [...virtualizedHashes]) {
            const container = chatBody?.querySelector(`[x-hashed="${hash}"]`) as HTMLElement;
            if (container) {
                remountMessage(hash, container);
            }
        }
    }

    const updateChatBody = () => {
        let nextHash = 0;
        let currentHashes: Set<number> = new Set();
        const charImage = getCharImage(currentCharacter.image, 'css')
        const userImage = getCharImage(userIcon, 'css')
        const simpleChar = createSimpleCharacter(currentCharacter);
        let loadStart = messages.length - 1
        let loadEnd = messages.length - loadPages

        if(chatFoldedStateMessageIndex.index !== -1){
            loadStart = chatFoldedStateMessageIndex.index
            loadEnd = Math.max(0, chatFoldedStateMessageIndex.index - loadPages)
        }

        // Disable virtualization in screenshot mode (loadPages === Infinity)
        const shouldVirtualize = loadPages !== Infinity;
        if (virtualScrollEnabled !== shouldVirtualize) {
            virtualScrollEnabled = shouldVirtualize;
            if (!shouldVirtualize) {
                disableVirtualization();
            }
        }

        const reloadPointerMap = get(ReloadChatPointer);

        for(let i=loadStart ; i >= loadEnd; i--){
            if(i < 0) break; // Prevent out of bounds
            const message = messages[i];
            const messageLargePortrait = message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false);
            const reloadPointer = reloadPointerMap[i] ?? 0;
            let hashd = message.data + (message.chatId ?? '') + i.toString() + messageLargePortrait.toString() + message.disabled?.toString() + reloadPointer.toString();
            const currentHash = hashCode(hashd);
            currentHashes.add(currentHash);

            const props = {
                message: message.data,
                isLastMemory: false,
                idx: i,
                totalLength: messages.length,
                img: message.role === 'user' ? userImage : charImage,
                onReroll: onReroll,
                unReroll: unReroll,
                rerollIcon: 'dynamic' as const,
                character: simpleChar,
                largePortrait: message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false),
                messageGenerationInfo: message.generationInfo,
                role: message.role,
                name: message.role === 'user' ? currentUsername : currentCharacter.name,
                isComment: message.isComment ?? false,
                disabled: message.disabled ?? false,
            };

            // Always store props for potential remounting
            hashToMessageProps.set(currentHash, { props });

            if(!hashes.has(currentHash)){
                const b = document.createElement('div');
                b.setAttribute('x-hashed', currentHash.toString());
                b.setAttribute('data-chat-index-container', i.toString());
                b.classList.add('chat-message-container');
                const inst = mount(Chat, {
                    target: b,
                    props,
                })
                mountInstances.set(currentHash, inst);
                const nextElement = document.querySelector(`[x-hashed="${nextHash}"]`);
                if(nextElement){
                    chatBody.insertBefore(b, nextElement?.nextSibling);
                }
                else{
                    chatBody.prepend(b);
                }

                // Observe for virtual scrolling
                observer?.observe(b);
            }
            nextHash = currentHash;

        }

        //@ts-expect-error Set<T> requires type arg, and Set.difference needs 'esnext' lib (polyfilled by Core-js)
        const toRemove:Set = hashes.difference(currentHashes);
        toRemove.forEach((hash) => {
            // Unobserve before removing
            const element = chatBody.querySelector(`[x-hashed="${hash}"]`);
            if (element) {
                observer?.unobserve(element);
            }

            // Clean up if mounted (not virtualized)
            const inst = mountInstances.get(hash);
            if(inst){
                unmount(inst);
                mountInstances.delete(hash);
            }
            if(element){
                chatBody.removeChild(element);
            }

            // Clean up virtual scrolling maps
            virtualizedHashes.delete(hash);
            measuredHeights.delete(hash);
            hashToMessageProps.delete(hash);
        });

        hashes = currentHashes;

    };

    onDestroy(() => {
        console.log('Unmounting Chats');
        observer?.disconnect();
        observer = null;
        hashes.clear();
        mountInstances.forEach((inst) => {
            unmount(inst);
        });
        mountInstances.clear();
        virtualizedHashes.clear();
        measuredHeights.clear();
        hashToMessageProps.clear();
    })

    function checkIfAtBottom() {
        if (!chatBody || !chatBody.parentElement) return true;
        const sc = chatBody.parentElement;
        const lastEl = chatBody.firstElementChild;
        if (!lastEl) return true;
        const rect = lastEl.getBoundingClientRect();
        const scRect = sc.getBoundingClientRect();
        return rect.top <= scRect.bottom + 100;
    }

    export const scrollToLatestMessage = () => {
        if(!chatBody) return;
        hasNewUnreadMessage = false;
        const element = chatBody.firstElementChild;
        if(element){
             element.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
    }

    let previousLength = 0;
    let previousChatRoomId: string | null = null;

    $effect(() => {
        console.log('Updating Chats');
        void $ReloadChatPointer; // Make $effect track ReloadChatPointer changes
        const wasAtBottom = checkIfAtBottom();
        updateChatBody()

        // Initialize IntersectionObserver after first render
        if (!observer && chatBody) {
            initObserver();
        }

        const currentChatRoomId = getCurrentChatRoomId();
        const isSameChat = currentChatRoomId === previousChatRoomId;

        // Only auto-scroll if it's the same chat and new messages were added
        if(isSameChat && messages.length > previousLength){
            const lastMsg = messages[messages.length - 1];
            if(lastMsg && lastMsg.role === 'char' && DBState.db.autoScrollToNewMessage){
                if(wasAtBottom || DBState.db.alwaysScrollToNewMessage){
                    const element = chatBody.firstElementChild;
                    if(element){
                        setTimeout(() => {
                            element.scrollIntoView({ behavior: 'instant', block: 'start' });
                        }, 700);
                    }
                } else {
                    hasNewUnreadMessage = true;
                }
            }
        }
        previousLength = messages.length;
        previousChatRoomId = currentChatRoomId;
    })

</script>

<div class="flex flex-col-reverse" bind:this={chatBody}></div>
