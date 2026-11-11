import { ApplicationRoleConnectionMetadataType, DiscordAPIError, Routes } from "discord.js";
import client, { streaksGuildId } from "./client.ts";
import { dataContent, mainBotId, mainRest } from "./dataMsg.ts";
import { createStatsClient } from "./statsClient.ts";

const fetchStats = createStatsClient(process.env.MAIKAKY_STATS_URL ?? "", process.env.STATS_API_TOKEN ?? "");

const getLinkedRolesSchema = (roleName: string | undefined) => [
    {
        type: ApplicationRoleConnectionMetadataType.BooleanEqual,
        key: "has_required_role",
        name: "Common Role",
        description: roleName === undefined ? "No Common Role configured." : `Has the role ${roleName}`,
    },
    {
        type: ApplicationRoleConnectionMetadataType.IntegerGreaterThanOrEqual,
        key: "current_streak",
        name: "Current message streak",
        description: "Required current message streak",
    },
    {
        type: ApplicationRoleConnectionMetadataType.IntegerGreaterThanOrEqual,
        key: "longest_streak",
        name: "Longest message streak",
        description: "Required longest message streak",
    },
    {
        type: ApplicationRoleConnectionMetadataType.IntegerGreaterThanOrEqual,
        key: "level",
        name: "Lurkr level",
        description: "Required Lurkr level",
    },
];

export const registerLinkedRolesSchema = async () => {
    const roleId = dataContent.linkedRoles?.requiredRoleId;
    const guild = await client.guilds.fetch(streaksGuildId);
    const role = roleId ? await guild.roles.fetch(roleId) : null;
    await mainRest.put(Routes.applicationRoleConnectionMetadata(mainBotId), {
        body: getLinkedRolesSchema(role?.name),
    });
};

export const getLinkedRolesMetadata = async (userId: string) => {
    const guild = await client.guilds.fetch(streaksGuildId);
    const member = await guild.members.fetch({ user: userId, force: true }).catch(error => {
        if (error instanceof DiscordAPIError && error.code === 10007) return null;
        throw error;
    });
    const stats = member ? await fetchStats(userId) : { currentStreak: 0, longestStreak: 0, level: 0 };

    const requiredRoleId = dataContent.linkedRoles?.requiredRoleId;
    return {
        platform_name: guild.name.slice(0, 50),
        platform_username: member?.user.username ?? userId,
        metadata: {
            has_required_role: requiredRoleId && member?.roles.cache.has(requiredRoleId) ? "1" : "0",
            current_streak: String(stats.currentStreak),
            longest_streak: String(stats.longestStreak),
            level: String(stats.level),
        },
    };
};
