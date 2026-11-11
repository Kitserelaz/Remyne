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
