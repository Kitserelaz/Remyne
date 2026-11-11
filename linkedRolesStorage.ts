import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MessageStore } from "./messageStore.ts";

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

const getTokenAttachment = (messages: MessageStore, messageId: string) => {
    if (!messageId || !/^\d+$/.test(messageId)) {
        throw new Error("The token message ID must identify the encrypted token data message.");
    }
    return messages.getAttachment(messageId, attachmentName);
};

export const loadLinkedRolesTokens = async (messages: MessageStore, messageId: string): Promise<Record<string, LinkedRolesTokens>> => {
    const attachment = await getTokenAttachment(messages, messageId);
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Could not download encrypted Linked Roles tokens (HTTP ${response.status}).`);
    return JSON.parse(decryptLinkedRolesData(Buffer.from(await response.arrayBuffer())));
};

export const saveLinkedRolesTokens = async (messages: MessageStore, messageId: string, tokens: Record<string, LinkedRolesTokens>) => {
    const encrypted = encryptLinkedRolesData(JSON.stringify(tokens));
    await getTokenAttachment(messages, messageId);
    await messages.replaceAttachment(messageId, attachmentName, encrypted);
};
