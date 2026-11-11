import { ApplicationRoleConnectionMetadataType, DiscordAPIError, Events, PermissionFlagsBits } from "discord.js";
import type { Client, GuildMember } from "discord.js";
import { getStatsRoleSlot } from "./statsRoleSlotData.ts";
import type { StatsRoleSlots } from "./statsRoleSlotData.ts";

export const altLinkedRolesSchema = [
    {
        type: ApplicationRoleConnectionMetadataType.IntegerEqual,
        key: "stats_role_slot_id",
        name: "Stats role slot ID",
        description: "Stats-based role assignment",
    },
    {
        type: ApplicationRoleConnectionMetadataType.BooleanEqual,
        key: "has_timeout_members_permission",
        name: "Has Timeout Members permission",
        description: "Can timeout members",
    },
    {
        type: ApplicationRoleConnectionMetadataType.BooleanEqual,
        key: "has_manage_roles_permission",
        name: "Has Manage Roles permission",
        description: "Can manage roles",
    },
];

export const getPermissionMetadata = (member: Pick<GuildMember, "permissions"> | null) => ({
    has_timeout_members_permission: member?.permissions.has(PermissionFlagsBits.ModerateMembers) ? "1" : "0",
    has_manage_roles_permission: member?.permissions.has(PermissionFlagsBits.ManageRoles) ? "1" : "0",
});

export const getAltLinkedRolesMetadata = async (client: Client, guildId: string, userId: string, slots: StatsRoleSlots) => {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch({ user: userId, force: true }).catch(error => {
        if (error instanceof DiscordAPIError && error.code === 10007) return null;
        throw error;
    });
    return {
        platform_name: guild.name.slice(0, 50),
        platform_username: member?.user.username ?? userId,
        metadata: {
            ...getPermissionMetadata(member),
            stats_role_slot_id: member ? String(getStatsRoleSlot(slots, userId)) : "0",
        },
    };
};

export const watchAltPermissionChanges = (
    client: Client,
    guildId: string,
    syncUser: (userId: string) => Promise<void>,
    syncUsers: () => Promise<void>,
) => {
    const refreshMember = (member: { id: string; guild: { id: string } }) => {
        if (member.guild.id === guildId) {
            void syncUser(member.id).catch(() => console.error("[Linked Roles: Alt] Could not persist member permission updates."));
        }
    };
    const refreshAll = () => {
        void syncUsers().catch(() => console.error("[Linked Roles: Alt] Could not persist permission updates."));
    };
    client.on(Events.GuildMemberUpdate, (previous, member) => {
        if (previous.roles.cache.size !== member.roles.cache.size || previous.roles.cache.some(role => !member.roles.cache.has(role.id))) {
            refreshMember(member);
        }
    });
    client.on(Events.GuildMemberAdd, refreshMember);
    client.on(Events.GuildMemberRemove, refreshMember);
    client.on(Events.GuildRoleUpdate, (previous, role) => {
        if (role.guild.id === guildId && previous.permissions.bitfield !== role.permissions.bitfield) refreshAll();
    });
    client.on(Events.GuildRoleDelete, role => {
        if (role.guild.id === guildId) refreshAll();
    });
    client.on(Events.GuildUpdate, (previous, guild) => {
        if (guild.id === guildId && previous.ownerId !== guild.ownerId) refreshAll();
    });
};
