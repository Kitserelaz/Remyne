import { REST, Routes } from "discord.js";
import type { APIUser } from "discord.js";
import { createMessageStore } from "./messageStore.ts";
import type { StatsRoleNaming, StatsRoleSlots } from "./statsRoleSlotData.ts";

const messageId = process.env.REMYNE_DATA_MESSAGE_ID;
if (!messageId || !/^\d+$/.test(messageId)) throw new Error("REMYNE_DATA_MESSAGE_ID is required.");
if (["1327068250848235611", process.env.LINKED_ROLES_TOKEN_MESSAGE_ID, process.env.ALT_LINKED_ROLES_TOKEN_MESSAGE_ID].includes(messageId)) {
    throw new Error("Remyne configuration must use a dedicated message.");
}
const mainToken = process.env.token?.trim();
if (!mainToken) throw new Error("The main bot token is required for OAuth metadata and storage.");
export const mainRest = new REST({ version: "10" }).setToken(mainToken);
const mainUser = await mainRest.get(Routes.user()).catch(() => {
    throw new Error("Could not identify the main Discord bot.");
}) as APIUser;
export const mainBotId = mainUser.id;
export const dataMessages = createMessageStore(mainRest, "1327066650133925898", mainBotId);
const attachment = await dataMessages.getAttachment(messageId, "data.json");
const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error("Could not download Remyne configuration.");
export const dataContent = await response.json() as {
    linkedRoles?: { requiredRoleId: string };
    statsRoleSlots?: StatsRoleSlots;
    statsRoleNaming?: StatsRoleNaming;
};

export const saveData = () =>
    dataMessages.replaceAttachment(messageId, "data.json", Buffer.from(JSON.stringify(dataContent)));
