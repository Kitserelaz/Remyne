import { TextChannel } from "discord.js";
import client from "./client.ts";
import type { StatsRoleNaming, StatsRoleSlots } from "./statsRoleSlotData.ts";

const messageId = process.env.REMYNE_DATA_MESSAGE_ID;
if (!messageId || !/^\d+$/.test(messageId)) throw new Error("REMYNE_DATA_MESSAGE_ID is required.");
if (["1327068250848235611", process.env.LINKED_ROLES_TOKEN_MESSAGE_ID, process.env.ALT_LINKED_ROLES_TOKEN_MESSAGE_ID].includes(messageId)) {
    throw new Error("Remyne configuration must use a dedicated message.");
}
const channel = await client.channels.fetch("1327066650133925898");
if (!(channel instanceof TextChannel)) throw new Error("Remyne data channel must be a text channel.");
export const dataMsg = await channel.messages.fetch(messageId);
const attachment = dataMsg.attachments.find(item => item.name === "data.json");
if (dataMsg.author.id !== client.user!.id || !attachment) {
    throw new Error("Remyne configuration must be a main-bot-authored message with a data.json attachment.");
}
const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error("Could not download Remyne configuration.");
export const dataContent = await response.json() as {
    linkedRoles?: { requiredRoleId: string };
    statsRoleSlots?: StatsRoleSlots;
    statsRoleNaming?: StatsRoleNaming;
};

export const saveData = async () => {
    await dataMsg.edit({
        attachments: [],
        files: [{ attachment: Buffer.from(JSON.stringify(dataContent)), name: "data.json" }],
    });
};
