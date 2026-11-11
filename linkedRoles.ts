import { Events, REST, Routes } from "discord.js";
import type { APIUser, TextChannel } from "discord.js";
import type { Express } from "express";
import client, { streaksGuildId } from "./client.ts";
import { dataContent, dataMsg, saveData } from "./dataMsg.ts";
import { getLinkedRolesMetadata, registerLinkedRolesSchema } from "./linkedRolesMetadata.ts";
import { loadLinkedRolesTokens, saveLinkedRolesTokens } from "./linkedRolesStorage.ts";
import { startLinkedRolesApplication } from "./linkedRolesApplication.ts";
import { altLinkedRolesSchema, getAltLinkedRolesMetadata, watchAltPermissionChanges } from "./linkedRolesPermissions.ts";
import { describeLinkedRolesError } from "./linkedRolesErrors.ts";
import { startStatsRoleSlots } from "./statsRoleSlots.ts";
import { formatClaimedStatsRoleName } from "./statsRoleSlotData.ts";

export const startLinkedRoles = async (app: Express) => {
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;
    const mainMessageId = process.env.LINKED_ROLES_TOKEN_MESSAGE_ID;
    const unmyneToken = process.env.UNMYNE_TOKEN?.trim();
    const altToken = process.env.ALT_TOKEN;
    const altSecret = process.env.ALT_CLIENT_SECRET;
    const altMessageId = process.env.ALT_LINKED_ROLES_TOKEN_MESSAGE_ID;
    if (!clientSecret || !redirectUri || !mainMessageId) {
        throw new Error("Main Linked Roles requires DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, and LINKED_ROLES_TOKEN_MESSAGE_ID.");
    }
    if (!altToken || !altSecret || !altMessageId) {
        throw new Error("Alt Linked Roles requires ALT_TOKEN, ALT_CLIENT_SECRET, and ALT_LINKED_ROLES_TOKEN_MESSAGE_ID.");
    }
    if (!unmyneToken) throw new Error("UNMYNE_TOKEN is required for server changes.");
    if (mainMessageId === altMessageId) throw new Error("Main and Alt Linked Roles must use different token messages.");
    const describeStartupError = (error: unknown) => describeLinkedRolesError(error, [
        altToken, altSecret, clientSecret, unmyneToken, process.env.token ?? "", process.env.LINKED_ROLES_ENCRYPTION_KEY ?? "",
    ]);
    const channel = dataMsg.channel as TextChannel;
    const altRest = new REST({ version: "10" }).setToken(altToken);
    const altUser = await altRest.get(Routes.user()).catch(error => {
        throw new Error(`[Linked Roles: Alt] Could not identify application: ${describeStartupError(error)}`);
    }) as APIUser;
    if (altUser.id === client.user!.id) throw new Error("ALT_TOKEN must belong to a different Discord application.");
    const unmyneRest = new REST({ version: "10" }).setToken(unmyneToken);
    const unmyneUser = await unmyneRest.get(Routes.user()).catch(error => {
        throw new Error(`[Stats Roles] Could not identify Unmyne: ${describeStartupError(error)}`);
    }) as APIUser;
    const altRedirectUri = new URL("/alt/oauth/discord/callback", new URL(redirectUri).origin).href;
    const loadTokens = async (name: string, messageId: string) => {
        try {
            return await loadLinkedRolesTokens(channel, messageId);
        } catch (error) {
            throw new Error(`[Linked Roles: ${name}] Could not load encrypted tokens: ${describeStartupError(error)}`);
        }
    };
    const [mainTokens, altTokens] = await Promise.all([
        loadTokens("Main", mainMessageId),
        loadTokens("Alt", altMessageId),
    ]);
    await registerLinkedRolesSchema().catch(error => {
        throw new Error(`[Linked Roles: Main] Could not register metadata: ${describeStartupError(error)}`);
    });
    await altRest.put(Routes.applicationRoleConnectionMetadata(altUser.id), { body: altLinkedRolesSchema }).catch(error => {
        throw new Error(`[Linked Roles: Alt] Could not register metadata: ${describeStartupError(error)}`);
    });

    const main = startLinkedRolesApplication(app, {
        name: "Main",
        clientId: client.user!.id,
        clientSecret,
        redirectUri,
        verificationPath: "/linked-roles",
        callbackPath: "/oauth/discord/callback",
        cookieName: "linked_roles_state",
        tokens: mainTokens,
        saveTokens: tokens => saveLinkedRolesTokens(channel, mainMessageId, tokens),
        getMetadata: getLinkedRolesMetadata,
    });
    const slots = dataContent.statsRoleSlots ??= {};
    const alt = startLinkedRolesApplication(app, {
        name: "Alt",
        clientId: altUser.id,
        clientSecret: altSecret,
        redirectUri: altRedirectUri,
        verificationPath: "/alt/linked-roles",
        callbackPath: "/alt/oauth/discord/callback",
        cookieName: "alt_linked_roles_state",
        tokens: altTokens,
        saveTokens: tokens => saveLinkedRolesTokens(channel, altMessageId, tokens),
        getMetadata: userId => getAltLinkedRolesMetadata(client, streaksGuildId, userId, slots),
    });
    client.on(Events.GuildMemberUpdate, (previous, member) => {
        const roleId = dataContent.linkedRoles?.requiredRoleId;
        if (member.guild.id !== streaksGuildId || !roleId || !mainTokens[member.id]) return;
        if (previous.roles.cache.has(roleId) === member.roles.cache.has(roleId)) return;
        void main.syncUser(member.id).catch(() => console.error("[Linked Roles: Main] Could not persist Common Role updates."));
    });
    const naming = dataContent.statsRoleNaming ??= { nameFormat: "{status} Role {slot}" };
    startStatsRoleSlots(client, { id: unmyneUser.id, rest: unmyneRest }, streaksGuildId, slots, naming, saveData, alt.syncUsers, async userId => {
        const { metadata } = await getLinkedRolesMetadata(userId);
        return formatClaimedStatsRoleName(Number(metadata.current_streak), Number(metadata.longest_streak), Number(metadata.level), naming.claimedNameFormat);
    });
    watchAltPermissionChanges(client, streaksGuildId, alt.syncUser, alt.syncUsers);
};
