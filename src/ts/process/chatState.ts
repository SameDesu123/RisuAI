import { writable } from "svelte/store";

export const doingChat = writable(false)
export const chatProcessStage = writable(0)
export const abortChat = writable(false)
