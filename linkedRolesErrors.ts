export const describeLinkedRolesError = (error: unknown, secrets: string[]) => {
    let message = error instanceof Error ? error.message : "Unknown error";
    if (error instanceof Error && "code" in error) message += ` (code: ${String(error.code)})`;
    if (error instanceof Error && "status" in error) message += ` (HTTP ${String(error.status)})`;
    for (const secret of secrets) {
        if (secret) message = message.replaceAll(secret, "[REDACTED]");
    }
    return message;
};
