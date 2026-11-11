import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { test, spyOn } from "bun:test";
import { Collection, DiscordAPIError, Events, GuildMember, PermissionFlagsBits, PermissionsBitField, REST } from "discord.js";
import type { Client, TextChannel } from "discord.js";
import type { Express, Request, Response as ExpressResponse } from "express";
import { createStatsClient } from "./statsClient.ts";
import { startLinkedRolesApplication } from "./linkedRolesApplication.ts";
import { getAltLinkedRolesMetadata, getPermissionMetadata, watchAltPermissionChanges } from "./linkedRolesPermissions.ts";
import {
    decryptLinkedRolesData,
    encryptLinkedRolesData,
    loadLinkedRolesTokens,
    saveLinkedRolesTokens,
    type LinkedRolesTokens,
} from "./linkedRolesStorage.ts";

const makeResponse = () => {
    const result = {
        statusCode: 200,
        body: "",
        redirectUrl: "",
        cookies: new Map<string, string>(),
        set: () => result,
        cookie: (name: string, value: string) => { result.cookies.set(name, value); return result; },
        clearCookie: (name: string) => { result.cookies.delete(name); return result; },
        status: (status: number) => { result.statusCode = status; return result; },
        send: (body: string) => { result.body = body; return result; },
        redirect: (url: string) => { result.redirectUrl = url; return result; },
    };
    return result;
};

test("applications isolate OAuth state, credentials, token stores, and concurrent metadata updates", async () => {
    const routes = new Map<string, (req: Request, res: ExpressResponse) => Promise<void> | void>();
    const app = { get: (path: string, handler: (req: Request, res: ExpressResponse) => Promise<void> | void) => routes.set(path, handler) } as unknown as Express;
    const apiCalls: { url: string; auth: string; body: unknown }[] = [];
    const exchanges: URLSearchParams[] = [];
    const originalFetch = globalThis.fetch;
    const api = spyOn(REST.prototype, "queueRequest").mockImplementation(async function(this: REST, request) {
        const { url, fetchOptions } = await this["resolveRequest"](request);
        const auth = new Headers(fetchOptions.headers as Record<string, string>).get("Authorization")!;
        apiCalls.push({ url, auth, body: request.body });
        return Response.json(request.method === "GET" ? { id: "member" } : {});
    });
    let statsFailure: "timeout" | "invalid" | undefined;
    const fetchStats = createStatsClient("https://stats.example.test", "test-token");
    globalThis.fetch = (async (url, init) => {
        if (String(url) === "https://stats.example.test/internal/stats/member") {
            assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
            assert.ok(init?.signal instanceof AbortSignal);
            if (statsFailure === "timeout") throw new DOMException("Timed out", "TimeoutError");
            return Response.json({ currentStreak: 2, longestStreak: 4, level: statsFailure === "invalid" ? -1 : 24 });
        }
        const form = new URLSearchParams(init?.body as URLSearchParams);
        exchanges.push(form);
        return Response.json({
            access_token: `${form.get("client_id")}-access`, refresh_token: `${form.get("client_id")}-refresh`,
            expires_in: 3600, scope: "identify role_connections.write",
        });
    }) as typeof fetch;
    try {
        const stores = { main: {} as Record<string, LinkedRolesTokens>, alt: {} as Record<string, LinkedRolesTokens> };
        const saves: string[] = [];
        const applications = new Map<string, ReturnType<typeof startLinkedRolesApplication>>();
        const sessions = new Map<string, ReturnType<typeof makeResponse>>();
        for (const name of ["main", "alt"] as const) {
            const prefix = name === "main" ? "" : "/alt";
            applications.set(name, startLinkedRolesApplication(app, {
                name, clientId: name, clientSecret: `${name}-secret`,
                redirectUri: `https://example.test${prefix}/oauth/discord/callback`,
                verificationPath: `${prefix}/linked-roles`, callbackPath: `${prefix}/oauth/discord/callback`,
                cookieName: `${name}_state`, tokens: stores[name],
                saveTokens: async tokens => { assert.equal(tokens, stores[name]); saves.push(name); },
                getMetadata: async userId => {
                    if (name === "main") await fetchStats(userId);
                    return { platform_name: name, platform_username: "member", metadata: { permission: name } };
                },
            }));
            const response = makeResponse();
            await routes.get(`${prefix}/linked-roles`)!({} as Request, response as unknown as ExpressResponse);
            const query = new URL(response.redirectUrl).searchParams;
            assert.equal(query.get("client_id"), name);
            assert.equal(query.get("redirect_uri"), `https://example.test${prefix}/oauth/discord/callback`);
            sessions.set(name, response);
        }
        const main = sessions.get("main")!;
        const alt = sessions.get("alt")!;
        const mainState = new URL(main.redirectUrl).searchParams.get("state")!;
        const altState = new URL(alt.redirectUrl).searchParams.get("state")!;
        assert.notEqual(mainState, altState);
        const rejected = makeResponse();
        await routes.get("/alt/oauth/discord/callback")!({
            query: { state: mainState, code: "wrong-app" }, headers: { cookie: `__Host-main_state=${mainState}` },
        } as unknown as Request, rejected as unknown as ExpressResponse);
        assert.equal(rejected.statusCode, 400);
        assert.equal(exchanges.length, 0);
        const connect = async (name: "main" | "alt", state: string) => {
            const prefix = name === "main" ? "" : "/alt";
            const response = makeResponse();
            await routes.get(`${prefix}/oauth/discord/callback`)!({
                query: { state, code: `${name}-code` }, headers: { cookie: `__Host-${name}_state=${state}` },
            } as unknown as Request, response as unknown as ExpressResponse);
            assert.equal(response.statusCode, 200);
            assert.match(response.body, /window.close\(\)/);
        };
        await Promise.all([connect("main", mainState), connect("alt", altState)]);
        assert.equal(stores.main.member!.accessToken, "main-access");
        assert.equal(stores.alt.member!.accessToken, "alt-access");
        assert.deepEqual(exchanges.map(form => [form.get("client_id"), form.get("client_secret")]).sort(), [
            ["alt", "alt-secret"], ["main", "main-secret"],
        ]);
        await Promise.all([...applications.values()].map(application => application.syncUser("member")));
        for (const call of apiCalls.filter(call => call.url.endsWith("/role-connection"))) {
            const name = call.url.includes("/applications/alt/") ? "alt" : "main";
            assert.equal(call.auth, `Bearer ${name}-access`);
            assert.equal((call.body as { metadata: { permission: string } }).metadata.permission, name);
        }
        const connections = () => apiCalls.filter(call => call.url.endsWith("/role-connection")).length;
        const connectionsBeforeFailure = connections();
        const storedCredentials = { ...stores.main.member! };
        for (const failure of ["timeout", "invalid"] as const) {
            statsFailure = failure;
            await applications.get("main")!.syncUser("member");
            assert.equal(connections(), connectionsBeforeFailure);
            assert.deepEqual(stores.main.member, storedCredentials);
        }
        assert.deepEqual(saves.sort(), ["alt", "main"]);
        const replay = makeResponse();
        await routes.get("/oauth/discord/callback")!({
            query: { state: mainState, code: "replay" }, headers: { cookie: `__Host-main_state=${mainState}` },
        } as unknown as Request, replay as unknown as ExpressResponse);
        assert.equal(replay.statusCode, 400);
    } finally {
        api.mockRestore();
        globalThis.fetch = originalFetch;
    }
});

test("permission metadata includes effective permissions, owners, departures, and preserves upstream errors", async () => {
    for (const [bits, timeout, manage] of [
        [0n, "0", "0"], [PermissionFlagsBits.ModerateMembers, "1", "0"],
        [PermissionFlagsBits.ManageRoles, "0", "1"],
        [PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageRoles, "1", "1"],
        [PermissionFlagsBits.Administrator, "1", "1"],
    ] as const) {
        assert.deepEqual(getPermissionMetadata({ permissions: new PermissionsBitField(bits) }), {
            has_timeout_members_permission: timeout, has_manage_roles_permission: manage,
        });
    }
    const ownerPermissions = Object.getOwnPropertyDescriptor(GuildMember.prototype, "permissions")!.get!.call({ user: { id: "owner" }, guild: { ownerId: "owner" } });
    assert.deepEqual(getPermissionMetadata({ permissions: ownerPermissions }), {
        has_timeout_members_permission: "1", has_manage_roles_permission: "1",
    });
    const missing = new DiscordAPIError({ message: "Unknown Member", code: 10007 }, 10007, 404, "GET", "/member", {});
    const guild = { name: "Test server", members: { fetch: async () => { throw missing; } } };
    const client = { guilds: { fetch: async () => guild } } as unknown as Client;
    assert.deepEqual((await getAltLinkedRolesMetadata(client, "guild", "departed", {})).metadata, {
        has_timeout_members_permission: "0", has_manage_roles_permission: "0",
        stats_role_slot_id: "0",
    });
    const failure = new Error("Discord unavailable");
    guild.members.fetch = async () => { throw failure; };
    await assert.rejects(getAltLinkedRolesMetadata(client, "guild", "member", {}), failure);
});

test("permission events sync only relevant members and server changes", async () => {
    const events = new EventEmitter();
    const members: string[] = [];
    let refreshes = 0;
    watchAltPermissionChanges(events as unknown as Client, "guild", async id => { members.push(id); }, async () => { refreshes++; });
    const member = (id: string, guildId: string, roleIds: string[]) => ({ id, guild: { id: guildId }, roles: { cache: new Collection(roleIds.map(roleId => [roleId, { id: roleId }])) } });
    events.emit(Events.GuildMemberUpdate, member("user", "guild", ["old"]), member("user", "guild", ["new"]));
    events.emit(Events.GuildMemberUpdate, member("user", "guild", ["new"]), member("user", "guild", ["new"]));
    events.emit(Events.GuildMemberUpdate, member("other", "other", []), member("other", "other", ["new"]));
    events.emit(Events.GuildMemberAdd, member("joined", "guild", []));
    events.emit(Events.GuildMemberRemove, member("left", "guild", []));
    events.emit(Events.GuildRoleUpdate, { permissions: { bitfield: 0n } }, { guild: { id: "guild" }, permissions: { bitfield: 1n } });
    events.emit(Events.GuildRoleUpdate, { permissions: { bitfield: 1n } }, { guild: { id: "guild" }, permissions: { bitfield: 1n } });
    events.emit(Events.GuildRoleDelete, { guild: { id: "guild" } });
    events.emit(Events.GuildRoleDelete, { guild: { id: "other" } });
    events.emit(Events.GuildUpdate, { ownerId: "old" }, { id: "guild", ownerId: "new" });
    events.emit(Events.GuildUpdate, { ownerId: "same" }, { id: "guild", ownerId: "same" });
    assert.deepEqual(members, ["user", "joined", "left"]);
    assert.equal(refreshes, 3);
});

test("token encryption round-trips, uses fresh nonces, and rejects tampering and incorrect keys", () => {
    const previousKey = process.env.LINKED_ROLES_ENCRYPTION_KEY;
    process.env.LINKED_ROLES_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    try {
        const plaintext = JSON.stringify({ user: { accessToken: "private-token" } });
        const encrypted = encryptLinkedRolesData(plaintext);
        assert.equal(decryptLinkedRolesData(encrypted), plaintext);
        assert.notDeepEqual(encrypted, encryptLinkedRolesData(plaintext));
        assert.equal(encrypted.includes(Buffer.from("private-token")), false);
        const tampered = Buffer.from(encrypted);
        tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
        assert.throws(() => decryptLinkedRolesData(tampered));
        process.env.LINKED_ROLES_ENCRYPTION_KEY = randomBytes(32).toString("base64");
        assert.throws(() => decryptLinkedRolesData(encrypted));
    } finally {
        if (previousKey === undefined) delete process.env.LINKED_ROLES_ENCRYPTION_KEY;
        else process.env.LINKED_ROLES_ENCRYPTION_KEY = previousKey;
    }
});

test("encrypted messages store each application's tokens independently", async () => {
    const previousKey = process.env.LINKED_ROLES_ENCRYPTION_KEY;
    const originalFetch = globalThis.fetch;
    process.env.LINKED_ROLES_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const buffers = new Map<string, Buffer>([["1", encryptLinkedRolesData("{}")], ["2", encryptLinkedRolesData("{}")]]);
    const channel = {
        client: { user: { id: "main-bot" } },
        messages: { fetch: async ({ message: id }: { message: string }) => ({
            author: { id: "main-bot" },
            attachments: new Collection([[id, { name: "linked-roles-tokens.enc", url: id }]]),
            edit: async (payload: { files: { attachment: Buffer }[]; attachments: unknown[] }) => {
                assert.deepEqual(payload.attachments, []);
                buffers.set(id, payload.files[0]!.attachment);
            },
        }) },
    } as unknown as TextChannel;
    globalThis.fetch = (async url => new Response(buffers.get(String(url)))) as typeof fetch;
    try {
        const main = { mainUser: { accessToken: "main", refreshToken: "main-refresh", expiresAt: 1 } };
        const alt = { altUser: { accessToken: "alt", refreshToken: "alt-refresh", expiresAt: 2 } };
        await Promise.all([saveLinkedRolesTokens(channel, "1", main), saveLinkedRolesTokens(channel, "2", alt)]);
        assert.deepEqual(await loadLinkedRolesTokens(channel, "1"), main);
        assert.deepEqual(await loadLinkedRolesTokens(channel, "2"), alt);
        assert.notEqual(buffers.get("1")!.toString(), JSON.stringify(main));
        assert.equal(JSON.parse(decryptLinkedRolesData(buffers.get("2")!)).mainUser, undefined);
    } finally {
        if (previousKey === undefined) delete process.env.LINKED_ROLES_ENCRYPTION_KEY;
        else process.env.LINKED_ROLES_ENCRYPTION_KEY = previousKey;
        globalThis.fetch = originalFetch;
    }
});
