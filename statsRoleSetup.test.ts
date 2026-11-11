import assert from "node:assert/strict";
import { test } from "bun:test";
import { ChannelType, Collection, OverwriteType, Routes } from "discord.js";
import type { APIOverwrite, Guild, REST } from "discord.js";
import { setupStatsRoleOverwrites } from "./statsRoleSetup.ts";

const cachedOverwrite = (overwrite: APIOverwrite) => ({
    id: overwrite.id, type: overwrite.type,
    allow: { bitfield: BigInt(overwrite.allow) }, deny: { bitfield: BigInt(overwrite.deny) },
});

test("setup batches all stats roles per snapshotted channel and continues after a channel failure", async () => {
    const calls: string[] = [];
    const makeChannel = (id: string, type: ChannelType, permissionsLocked: boolean | null) => ({
        id, name: id, type, permissionsLocked,
        permissionOverwrites: { cache: new Collection() },
    });
    const category = makeChannel("category", ChannelType.GuildCategory, null);
    const synced = makeChannel("synced", ChannelType.GuildText, true);
    const unsynced = makeChannel("unsynced", ChannelType.GuildText, false);
    const guild = {
        channels: { fetch: async () => new Collection([
            ["category", category], ["synced", synced], ["unsynced", unsynced], ["missing", null],
        ]) },
    } as unknown as Guild;
    const result = await setupStatsRoleOverwrites(guild, ["role1", "role2"], {
        patch: async (route, { body } = {}) => {
            calls.push(route);
            assert.deepEqual(body, { permission_overwrites: [
                { id: "role1", type: OverwriteType.Role, allow: "0", deny: "0" },
                { id: "role2", type: OverwriteType.Role, allow: "0", deny: "0" },
            ] });
            if (route === Routes.channel(category.id)) synced.permissionsLocked = false;
            if (route === Routes.channel(unsynced.id)) throw new Error("Missing permissions");
        },
    });
    assert.deepEqual(calls, [Routes.channel(category.id), Routes.channel(unsynced.id)]);
    assert.deepEqual(result, { cleared: 2, skipped: 0, failed: 2 });
});

test("setup preserves other overwrites, batches needed changes, and skips fully configured channels", async () => {
    const calls: APIOverwrite[][] = [];
    const existing: APIOverwrite[] = [
        { id: "empty", type: OverwriteType.Role, allow: "0", deny: "0" },
        { id: "allowed", type: OverwriteType.Role, allow: "1", deny: "0" },
        { id: "denied", type: OverwriteType.Role, allow: "0", deny: "1" },
        { id: "other-role", type: OverwriteType.Role, allow: "2", deny: "4" },
        { id: "member", type: OverwriteType.Member, allow: "8", deny: "16" },
    ];
    const cache = new Collection(existing.map(overwrite => [overwrite.id, cachedOverwrite(overwrite)]));
    const channel = {
        id: "channel", name: "channel", type: ChannelType.GuildText, permissionsLocked: false,
        permissionOverwrites: { cache },
    };
    const guild = { channels: { fetch: async () => new Collection([[channel.id, channel]]) } } as unknown as Guild;
    const roles = ["empty", "allowed", "denied", "missing"];
    const unmyneRest: Pick<REST, "patch"> = {
        patch: async (route, { body } = {}) => {
            assert.equal(route, Routes.channel(channel.id));
            const { permission_overwrites } = body as { permission_overwrites: APIOverwrite[] };
            calls.push(permission_overwrites);
            cache.clear();
            for (const overwrite of permission_overwrites) cache.set(overwrite.id, cachedOverwrite(overwrite));
        },
    };
    assert.deepEqual(await setupStatsRoleOverwrites(guild, roles, unmyneRest), { cleared: 3, skipped: 1, failed: 0 });
    assert.equal(calls.length, 1);
    const sent = new Map(calls[0]!.map(overwrite => [overwrite.id, overwrite]));
    assert.equal(sent.size, 6);
    for (const id of roles) assert.deepEqual(sent.get(id), { id, type: OverwriteType.Role, allow: "0", deny: "0" });
    assert.deepEqual(sent.get("other-role"), existing[3]);
    assert.deepEqual(sent.get("member"), existing[4]);
    calls.length = 0;
    assert.deepEqual(await setupStatsRoleOverwrites(guild, roles, unmyneRest), { cleared: 0, skipped: 4, failed: 0 });
    assert.deepEqual(calls, []);
});
