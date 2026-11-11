type Stats = { currentStreak: number; longestStreak: number; level: number };

const isStat = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const statsBaseUrl = (baseUrl: string, token: string) => {
    if (!URL.canParse(baseUrl)) throw new Error("MAIKAKY_STATS_URL must be an HTTPS base URL.");
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new Error("MAIKAKY_STATS_URL must be an HTTPS base URL without credentials, query, or fragment.");
    }
    if (!token.trim()) throw new Error("STATS_API_TOKEN is required.");
    return url;
};

export const createStatsClient = (baseUrl: string, token: string) => {
    const url = statsBaseUrl(baseUrl, token);

    return async (userId: string): Promise<Stats> => {
        const signal = AbortSignal.timeout(15_000);
        const timeout = "Maikaky stats request timed out after 15 seconds.";
        const response = await fetch(new URL(`/internal/stats/${encodeURIComponent(userId)}`, url), {
            headers: { Authorization: `Bearer ${token}` },
            signal,
            redirect: "error",
        }).catch(() => {
            throw new Error(signal.aborted ? timeout : "Could not reach the Maikaky stats endpoint.");
        });
        if (!response.ok) throw new Error(`Maikaky stats endpoint returned HTTP ${response.status}.`);
        const stats = await response.json().catch(() => {
            throw new Error(signal.aborted ? timeout : "Maikaky stats endpoint did not return valid JSON.");
        }) as Partial<Stats> | null;
        const { currentStreak, longestStreak, level } = stats ?? {};
        if (!isStat(currentStreak) || !isStat(longestStreak) || !isStat(level)) {
            throw new Error("Maikaky stats response must contain nonnegative integers for currentStreak, longestStreak, and level.");
        }
        return { currentStreak, longestStreak, level };
    };
};

export const watchStatsEvents = (baseUrl: string, token: string, refreshUser: (userId: string) => Promise<unknown>) => {
    const url = new URL("/internal/stats/events", statsBaseUrl(baseUrl, token));
    url.protocol = "wss:";
    let retryDelay = 1_000;

    const connect = () => {
        const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
        let watchdog = setTimeout(() => socket.terminate(), 15_000).unref();
        const expectHeartbeat = () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => socket.terminate(), 65_000).unref();
        };
        socket.addEventListener("open", () => {
            console.log("[Stats Events] Connected to Maikaky.");
            expectHeartbeat();
        });
        socket.addEventListener("ping", () => {
            retryDelay = 1_000;
            expectHeartbeat();
        });
        socket.addEventListener("message", event => {
            const userId = event.data;
            if (typeof userId !== "string" || !/^[1-9]\d{16,19}$/.test(userId) || BigInt(userId) > 18446744073709551615n) return;
            void refreshUser(userId).catch(() => console.error(`[Stats Events] Could not refresh ${userId}; periodic sync will retry.`));
        });
        socket.addEventListener("error", () => console.warn("[Stats Events] Maikaky WebSocket error."));
        socket.addEventListener("close", event => {
            clearTimeout(watchdog);
            console.warn(`[Stats Events] Disconnected from Maikaky (code ${event.code}); reconnecting in ${retryDelay / 1000}s.`);
            setTimeout(connect, retryDelay).unref();
            retryDelay = Math.min(retryDelay * 2, 30_000);
        }, { once: true });
    };

    connect();
};
