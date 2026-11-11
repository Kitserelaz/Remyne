export type StatsRoleSlots = Record<string, { roleId: string; ownerId?: string }>;
export type StatsRoleNaming = {
    nameFormat: string;
    claimedNameFormat?: string;
    lockedNameFormat?: string;
    unclaimedColor?: number;
    lockedColor?: number;
};

export const parseStatsRoleColor = (value: string) =>
    /^#?[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.replace("#", ""), 16) : null;

export const getNextStatsRoleSlot = (slots: StatsRoleSlots) => {
    let next = 1;
    while (slots[String(next)]?.ownerId) next++;
    return next;
};

export const getStatsRoleSlot = (slots: StatsRoleSlots, userId: string) => {
    const owned = Object.entries(slots).find(([, slot]) => slot.ownerId === userId);
    if (owned) return Number(owned[0]);
    return getNextStatsRoleSlot(slots);
};

export const formatUnclaimedStatsRoleName = (format = "{status} Role {slot}", slotId: string, locked: boolean) =>
    format.replaceAll("{status}", locked ? "Locked" : "Unclaimed").replaceAll("{slot}", slotId);

export const formatClaimedStatsRoleName = (
    current: number,
    longest: number,
    level: number,
    format = "{streak} • Level {level}",
) => format.replaceAll("{streak}", `${current}🔥${current === longest ? "" : longest}`)
    .replaceAll("{current}", String(current))
    .replaceAll("{longest}", String(longest))
    .replaceAll("{level}", String(level));

export const getStatsRolePositions = (
    slots: StatsRoleSlots,
    roles: { id: string; position: number }[],
    recentClaims: string[],
) => {
    const slotsByRole = new Map(Object.entries(slots).map(([id, slot]) => [slot.roleId, { id: Number(id), ownerId: slot.ownerId }]));
    const current = roles.filter(role => slotsByRole.has(role.id)).sort((a, b) => b.position - a.position);
    const unclaimed = current.filter(role => !slotsByRole.get(role.id)!.ownerId)
        .sort((a, b) => slotsByRole.get(a.id)!.id - slotsByRole.get(b.id)!.id);
    const claimed = current.filter(role => slotsByRole.get(role.id)!.ownerId);
    const recent = recentClaims.flatMap(id => claimed.filter(role => role.id === id));
    const desired = [...unclaimed, ...claimed.filter(role => !recentClaims.includes(role.id)), ...recent];
    return desired.flatMap((role, index) => role.id === current[index]!.id ? [] : [{ role: role.id, position: current[index]!.position }]);
};

export const canClaimStatsRoleSlot = (slots: StatsRoleSlots, slotId: string, userId: string) => {
    const slot = slots[slotId];
    return Boolean(slot && (!slot.ownerId || slot.ownerId === userId) && getStatsRoleSlot(slots, userId) === Number(slotId));
};
