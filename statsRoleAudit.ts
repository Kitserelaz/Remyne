import { OverwriteType, Routes } from "discord.js";
import type { Guild, GuildChannel, REST } from "discord.js";
import { toAPIOverwrite } from "./statsRoleSetup.ts";

export const auditStatsRoleOverwrites = async (guild: Guild, roleIds: string[]) => {
    const channels = await guild.channels.fetch();
    const statsRoleIds = new Set(roleIds);
    const matches: GuildChannel[] = [];
    for (const channel of channels.values()) {
        if (!channel || !("permissionsLocked" in channel) || channel.permissionsLocked !== false) continue;
        const parent = channel.parent;
        if (!parent) continue;
        const channelOverwrites = channel.permissionOverwrites.cache.filter(overwrite =>
            overwrite.type !== OverwriteType.Role || !statsRoleIds.has(overwrite.id));
        const parentOverwrites = parent.permissionOverwrites.cache.filter(overwrite =>
            overwrite.type !== OverwriteType.Role || !statsRoleIds.has(overwrite.id));
        if (channelOverwrites.size !== parentOverwrites.size) continue;
        const matching = channelOverwrites.every(overwrite => {
            const parentOverwrite = parentOverwrites.get(overwrite.id);
            return parentOverwrite?.type === overwrite.type &&
                parentOverwrite.allow.bitfield === overwrite.allow.bitfield &&
                parentOverwrite.deny.bitfield === overwrite.deny.bitfield;
        });
        if (matching) matches.push(channel);
    }
    return matches;
};

export const reconcileStatsRoleOverwrites = async (
    guild: Guild,
    roleIds: string[],
    targets: { id: string; parentId: string | null }[],
    unmyneRest: Pick<REST, "patch">,
) => {
    const auditedParents = new Map(targets.map(channel => [channel.id, channel.parentId]));
    const channels = await auditStatsRoleOverwrites(guild, roleIds);
    let synced = 0;
    let failed = 0;
    for (const channel of channels) {
        if (auditedParents.get(channel.id) !== channel.parentId) continue;
        try {
            const parent = channel.parent;
            if (!parent) throw new Error("Channel no longer has a category.");
            await unmyneRest.patch(Routes.channel(channel.id), {
                body: { permission_overwrites: parent.permissionOverwrites.cache.map(toAPIOverwrite) },
            });
            synced++;
        } catch (error) {
            failed++;
            const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
            console.error(`[Stats Roles] Could not sync channel ${channel.id} to its category (code=${code}).`);
        }
    }
    return { synced, skipped: auditedParents.size - synced - failed, failed };
};
