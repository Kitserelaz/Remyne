import assert from "node:assert/strict";
import { test } from "bun:test";
import { ChannelType, Collection, OverwriteType, Routes } from "discord.js";
import type { Guild } from "discord.js";
import { auditStatsRoleOverwrites, reconcileStatsRoleOverwrites } from "./statsRoleAudit.ts";

test("audit finds only unsynced channels with differences confined to configured stats roles", async () => {
    const overwrite = (id: string, allow = 0n, deny = 0n, type = OverwriteType.Role) => ({
        id, type, allow: { bitfield: allow }, deny: { bitfield: deny },
    });
    const other = overwrite("other", 1n, 2n);
    const member = overwrite("member", 4n, 8n, OverwriteType.Member);
    const stats = overwrite("stats", 16n);
    const parent = {
        id: "category", type: ChannelType.GuildCategory, permissionsLocked: null,
        permissionOverwrites: { cache: new Collection([other, member, stats].map(item => [item.id, item])) },
    };
    const channel = (id: string, overwrites: ReturnType<typeof overwrite>[], permissionsLocked: boolean | null = false) => ({
        id, type: ChannelType.GuildText, permissionsLocked, parent,
        permissionOverwrites: { cache: new Collection(overwrites.map(item => [item.id, item])) },
    });
    const channels = [
        parent,
        channel("missing-stats", [other, member]),
        channel("empty-stats", [other, member, overwrite("stats")]),
        channel("changed-stats", [other, member, overwrite("stats", 0n, 32n)]),
        channel("extra-stats", [other, member, stats, overwrite("stats2")]),
        channel("changed-role", [overwrite("other", 2n, 1n), member]),
        channel("changed-member", [other, overwrite("member", 0n, 8n, OverwriteType.Member)]),
        channel("missing-role", [member]),
        channel("missing-member", [other]),
        channel("extra-role", [other, member, overwrite("extra")]),
        channel("extra-member", [other, member, overwrite("extra", 0n, 0n, OverwriteType.Member)]),
        channel("different-ids", [overwrite("replacement", 1n, 2n), member]),
        channel("member-with-stats-id", [other, member, overwrite("stats", 0n, 0n, OverwriteType.Member)]),
        channel("synced", [other, member, stats], true),
        { ...channel("no-category", [other, member], null), parent: null },
    ];
    const guild = { channels: { fetch: async () => new Collection([
        ...channels.map(item => [item.id, item] as const), ["missing", null],
    ]) } } as unknown as Guild;
    const matches = await auditStatsRoleOverwrites(guild, ["stats", "stats2"]);
    assert.deepEqual(matches.map(item => item.id), ["missing-stats", "empty-stats", "changed-stats", "extra-stats"]);
    assert.deepEqual(await auditStatsRoleOverwrites(guild, []), []);
});

test("reconcile rechecks audit targets, syncs category overwrites, and continues after failures", async () => {
    const overwrite = (id: string, allow: bigint) => ({
        id, type: OverwriteType.Role, allow: { bitfield: allow }, deny: { bitfield: 0n },
    });
    const parent = {
        id: "category",
        permissionOverwrites: { cache: new Collection([overwrite("other", 1n), overwrite("stats", 2n)].map(item => [item.id, item])) },
    };
    const calls: string[] = [];
    const makeChannel = (id: string) => ({
        id, type: ChannelType.GuildText, parentId: parent.id, parent, permissionsLocked: false,
        permissionOverwrites: { cache: new Collection([["other", overwrite("other", 1n)]]) },
    });
    const failed = makeChannel("failed");
    const matching = makeChannel("matching");
    const changed = makeChannel("changed");
    const moved = makeChannel("moved");
    const synced = makeChannel("synced");
    const deleted = makeChannel("deleted");
    const targets = [failed, matching, changed, moved, synced, deleted].map(channel => ({ id: channel.id, parentId: channel.parentId }));
    changed.permissionOverwrites.cache.set("other", overwrite("other", 8n));
    moved.parent = { ...parent, id: "new-category" };
    moved.parentId = moved.parent.id;
    synced.permissionsLocked = true;
    const channels = [failed, matching, changed, moved, synced, makeChannel("not-in-audit")];
    const guild = { channels: { fetch: async () => new Collection(channels.map(channel => [channel.id, channel])) } } as unknown as Guild;
    const result = await reconcileStatsRoleOverwrites(guild, ["stats"], targets, {
        patch: async (route, { body } = {}) => {
            calls.push(route);
            if (route === Routes.channel(failed.id)) throw new Error("Missing permissions");
            assert.deepEqual(body, { permission_overwrites: [
                { id: "other", type: OverwriteType.Role, allow: "1", deny: "0" },
                { id: "stats", type: OverwriteType.Role, allow: "2", deny: "0" },
            ] });
        },
    });
    assert.deepEqual(result, { synced: 1, skipped: 4, failed: 1 });
    assert.deepEqual(calls, [Routes.channel(failed.id), Routes.channel(matching.id)]);
});
