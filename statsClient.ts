type Stats = { currentStreak: number; longestStreak: number; level: number };

const isStat = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const createStatsClient = (baseUrl: string, token: string) => {
    if (!URL.canParse(baseUrl)) throw new Error("MAIKAKY_STATS_URL must be an HTTPS base URL.");
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new Error("MAIKAKY_STATS_URL must be an HTTPS base URL without credentials, query, or fragment.");
    }
    if (!token.trim()) throw new Error("STATS_API_TOKEN is required.");

    return async (userId: string): Promise<Stats> => {
        try {
            const response = await fetch(new URL(`/internal/stats/${encodeURIComponent(userId)}`, url), {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15_000),
                redirect: "error",
            });
            if (!response.ok) throw new Error();
            const stats = await response.json() as Partial<Stats> | null;
            const { currentStreak, longestStreak, level } = stats ?? {};
            if (!isStat(currentStreak) || !isStat(longestStreak) || !isStat(level)) throw new Error();
            return { currentStreak, longestStreak, level };
        } catch {
            throw new Error("Could not retrieve valid Maikaky stats.");
        }
    };
};
