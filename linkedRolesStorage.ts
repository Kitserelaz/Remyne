import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { TextChannel } from "discord.js";

export type LinkedRolesTokens = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
};

const attachmentName = "linked-roles-tokens.enc";

const getEncryptionKey = () => {
    const encoded = process.env.LINKED_ROLES_ENCRYPTION_KEY;
    if (!encoded) throw new Error("LINKED_ROLES_ENCRYPTION_KEY is required.");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
        throw new Error("LINKED_ROLES_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    }
    return key;
};

export const encryptLinkedRolesData = (plaintext: string) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
};

export const decryptLinkedRolesData = (encrypted: Buffer) => {
    if (encrypted.length < 28) throw new Error("Encrypted Linked Roles data is truncated.");
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), encrypted.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(encrypted.subarray(12, 28));
    return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString("utf8");
};

const getTokenMessage = async (channel: TextChannel, messageId: string) => {
    if (!messageId || !/^\d+$/.test(messageId)) {
        throw new Error("The token message ID must identify the encrypted token data message.");
    }
    const message = await channel.messages.fetch({ message: messageId, force: true });
    if (message.author.id !== channel.client.user!.id || !message.attachments.some(attachment => attachment.name === attachmentName)) {
        throw new Error("Linked Roles token storage must be a dedicated bot-authored message with an encrypted attachment.");
    }
    return message;
};

export const loadLinkedRolesTokens = async (channel: TextChannel, messageId: string): Promise<Record<string, LinkedRolesTokens>> => {
    const message = await getTokenMessage(channel, messageId);
    const attachment = message.attachments.find(item => item.name === attachmentName)!;
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Could not download encrypted Linked Roles tokens (HTTP ${response.status}).`);
    return JSON.parse(decryptLinkedRolesData(Buffer.from(await response.arrayBuffer())));
};

export const saveLinkedRolesTokens = async (channel: TextChannel, messageId: string, tokens: Record<string, LinkedRolesTokens>) => {
    const encrypted = encryptLinkedRolesData(JSON.stringify(tokens));
    const message = await getTokenMessage(channel, messageId);
    await message.edit({
        attachments: [],
        files: [{ attachment: encrypted, name: attachmentName }],
    });
};
