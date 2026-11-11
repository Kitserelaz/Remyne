import { randomBytes } from "node:crypto";
import { DiscordAPIError, REST, Routes } from "discord.js";
import type { APIUser } from "discord.js";
import type { Express } from "express";
import type { LinkedRolesTokens } from "./linkedRolesStorage.ts";
import { describeLinkedRolesError } from "./linkedRolesErrors.ts";

const stateLifetime = 10 * 60 * 1000;
const refreshInterval = 5 * 60 * 1000;

type LinkedRolesApplicationOptions = {
    name: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    verificationPath: string;
    callbackPath: string;
    cookieName: string;
    tokens: Record<string, LinkedRolesTokens>;
    saveTokens: (tokens: Record<string, LinkedRolesTokens>) => Promise<void>;
    getMetadata: (userId: string) => Promise<{
        platform_name: string;
        platform_username: string;
        metadata: Record<string, string>;
    }>;
};

export const startLinkedRolesApplication = (app: Express, options: LinkedRolesApplicationOptions) => {
    const { name, clientId, clientSecret, redirectUri, verificationPath, callbackPath, cookieName, tokens, saveTokens, getMetadata } = options;
    const callbackUrl = new URL(redirectUri);
    if (!["http:", "https:"].includes(callbackUrl.protocol) || callbackUrl.pathname !== callbackPath || callbackUrl.search || callbackUrl.hash) {
        throw new Error(`${name}: redirect URI must be an HTTP or HTTPS URL ending in ${callbackPath}.`);
    }
    const secureCookie = callbackUrl.protocol === "https:";
    const stateCookie = secureCookie ? `__Host-${cookieName}` : cookieName;
    const cookieOptions = { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/" } as const;

    const pendingStates = new Map<string, number>();
    const userRest = new REST({ version: "10", authPrefix: "Bearer" });
    let updates = Promise.resolve();

    const describeError = (error: unknown, code = "") => describeLinkedRolesError(error, [
        clientSecret,
        process.env.ALT_CLIENT_SECRET ?? "",
        process.env.DISCORD_CLIENT_SECRET ?? "",
        process.env.ALT_TOKEN ?? "",
        process.env.token ?? "",
        process.env.STATS_API_TOKEN ?? "",
        process.env.LINKED_ROLES_ENCRYPTION_KEY ?? "",
        code,
        ...Object.values(tokens).flatMap(value => [value.accessToken, value.refreshToken]),
    ]);

    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = updates.then(operation);
        updates = result.then(() => {}, () => {});
        return result;
    };

    const exchangeToken = async (grant: Record<string, string>): Promise<LinkedRolesTokens> => {
        const response = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...grant }),
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
            const body = await response.json() as { error?: string };
            throw Object.assign(new Error("Discord OAuth token exchange failed."), { code: body.error });
        }
        const body = await response.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            scope: string;
        };
        if (!body.scope.split(" ").includes("role_connections.write") || !body.scope.split(" ").includes("identify")) {
            throw new Error("Required Discord OAuth scopes were not granted.");
        }
        return {
            accessToken: body.access_token,
            refreshToken: body.refresh_token,
            expiresAt: Date.now() + body.expires_in * 1000,
        };
    };

    const syncUser = async (userId: string) => {
        let credentials = tokens[userId]!;
        if (credentials.expiresAt <= Date.now() + 60_000) {
            credentials = await exchangeToken({ grant_type: "refresh_token", refresh_token: credentials.refreshToken });
            tokens[userId] = credentials;
            await saveTokens(tokens);
        }
        const metadata = await getMetadata(userId);
        userRest.setToken(credentials.accessToken);
        try {
            console.log(`[Linked Roles: ${name}] Publishing metadata for ${userId}: ${JSON.stringify(metadata.metadata)}`);
            await userRest.put(Routes.userApplicationRoleConnection(clientId), { body: metadata });
        } catch (error) {
            if (error instanceof DiscordAPIError && (error.status === 401 || error.status === 403)) {
                throw Object.assign(new Error("Linked Roles authorization was revoked."), { code: "authorization_revoked" });
            }
            throw error;
        }
    };

    const syncConnectedUser = (userId: string) => serialize(async () => {
        if (!tokens[userId]) return;
        try {
            await syncUser(userId);
        } catch (error) {
            const description = describeError(error);
            const revoked = error instanceof Error && "code" in error &&
                (error.code === "invalid_grant" || error.code === "authorization_revoked");
            if (revoked) {
                delete tokens[userId];
                await saveTokens(tokens);
            }
            console.error(`[Linked Roles: ${name}] ${revoked ? "Authorization revoked" : "Sync failed"} for ${userId}: ${description}`);
        }
    });

    const syncUsers = async () => {
        for (const userId of Object.keys(tokens)) await syncConnectedUser(userId);
    };

    app.get(verificationPath, (req, res) => {
        for (const [state, expiry] of pendingStates) {
            if (expiry <= Date.now()) pendingStates.delete(state);
        }
        const state = randomBytes(32).toString("base64url");
        pendingStates.set(state, Date.now() + stateLifetime);
        res.set("Cache-Control", "no-store");
        res.cookie(stateCookie, state, { ...cookieOptions, maxAge: stateLifetime });
        const query = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "identify role_connections.write",
            state,
        });
        res.redirect(`https://discord.com/oauth2/authorize?${query}`);
    });

    app.get(callbackPath, async (req, res) => {
        res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        const state = req.query.state;
        const cookie = req.headers.cookie?.split(";").map(value => value.trim())
            .find(value => value.startsWith(`${stateCookie}=`))?.slice(stateCookie.length + 1);
        if (typeof state !== "string" || state !== cookie || (pendingStates.get(state) ?? 0) <= Date.now()) {
            res.status(400).send("Invalid or expired authorization. Start again from Linked Roles in Discord.");
            return;
        }
        pendingStates.delete(state);
        res.clearCookie(stateCookie, cookieOptions);
        if (typeof req.query.code !== "string" || req.query.error) {
            res.status(400).send("Authorization was not completed. Start again from Linked Roles in Discord.");
            return;
        }
        const code = req.query.code;
        let stage = "exchange Discord authorization";
        try {
            await serialize(async () => {
                const credentials = await exchangeToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
                stage = "read Discord account";
                userRest.setToken(credentials.accessToken);
                const user = await userRest.get(Routes.user()) as APIUser;
                tokens[user.id] = credentials;
                stage = "save authorization";
                await saveTokens(tokens);
                stage = "sync server stats with Discord";
                await syncUser(user.id);
            });
            res.send("Your stats are connected. Return to Discord to claim your Linked Role.<script>window.close();</script>");
        } catch (error) {
            console.error(`[Linked Roles: ${name}] Could not ${stage}: ${describeError(error, code)}`);
            res.status(503).send("Could not finish connecting your stats. Please try again shortly.");
        }
    });

    const refresh = async () => {
        try {
            await syncUsers();
        } catch {
            console.error(`[Linked Roles: ${name}] Could not persist token updates.`);
        } finally {
            setTimeout(() => void refresh(), refreshInterval).unref();
        }
    };
    void refresh();
    return { syncUser: syncConnectedUser, syncUsers };
};
