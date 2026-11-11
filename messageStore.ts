import { Routes } from "discord.js";
import type { APIMessage, REST } from "discord.js";

export const createMessageStore = (rest: Pick<REST, "get" | "patch">, channelId: string, authorId: string) => ({
    getAttachment: async (messageId: string, filename: string) => {
        const message = await rest.get(Routes.channelMessage(channelId, messageId)) as APIMessage;
        const attachment = message.attachments.find(item => item.filename === filename);
        if (message.author.id !== authorId || !attachment) {
            throw new Error(`Data message must be authored by the main bot and contain ${filename}.`);
        }
        return attachment;
    },
    replaceAttachment: (messageId: string, filename: string, data: Buffer) =>
        rest.patch(Routes.channelMessage(channelId, messageId), {
            body: { attachments: [{ id: 0, filename }] },
            files: [{ name: filename, data }],
        }),
});

export type MessageStore = ReturnType<typeof createMessageStore>;
