import { beforeEach, describe, expect, it, vi } from "vitest"

const mockDb = {
    additionalParams: [] as [string, string][],
    customModels: [] as { id: string, params: string }[],
}

vi.mock("src/ts/storage/database.svelte", () => ({
    getDatabase: () => mockDb
}))

import { applyAdditionalRequestParams, getAdditionalRequestParams } from "./shared"

describe("getAdditionalRequestParams", () => {
    beforeEach(() => {
        mockDb.additionalParams = []
        mockDb.customModels = []
    })

    it("returns reverse proxy additional params from the database", () => {
        mockDb.additionalParams = [
            ["temperature", "0.7"],
            ["header::x-test", "proxy"]
        ]

        expect(getAdditionalRequestParams("reverse_proxy")).toEqual([
            ["temperature", "0.7"],
            ["header::x-test", "proxy"]
        ])
    })

    it("parses custom model params for xcustom models", () => {
        mockDb.customModels = [{
            id: "xcustom:::anthropic",
            params: "temperature=0.7\nheader::anthropic-beta=tools-2025-04-11\nmetadata=json::{\"source\":\"custom\"}\nstop=value=with=equals"
        }]

        expect(getAdditionalRequestParams("xcustom:::anthropic")).toEqual([
            ["temperature", "0.7"],
            ["header::anthropic-beta", "tools-2025-04-11"],
            ["metadata", "json::{\"source\":\"custom\"}"],
            ["stop", "value=with=equals"]
        ])
    })
})

describe("applyAdditionalRequestParams", () => {
    it("applies headers and body overrides using the shared additional param syntax", () => {
        const headers: Record<string, string> = {
            accept: "application/json"
        }

        const body = {
            temperature: 1,
            deleteMe: "remove",
            keepMe: "ok"
        }

        const updatedBody = applyAdditionalRequestParams(body, headers, [
            ["header::anthropic-beta", "tools-2025-04-11"],
            ["temperature", "0.7"],
            ["metadata", "json::{\"source\":\"custom\"}"],
            ["message", "\"hello\""],
            ["nested.flag", "true"],
            ["deleteMe", "{{none}}"]
        ])

        expect(headers).toEqual({
            accept: "application/json",
            "anthropic-beta": "tools-2025-04-11"
        })

        expect(updatedBody).toEqual({
            temperature: 0.7,
            keepMe: "ok",
            metadata: {
                source: "custom"
            },
            message: "hello",
            nested: {
                flag: true
            }
        })
    })
})
