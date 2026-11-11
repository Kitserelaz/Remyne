import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "bun:test";
import { Collection, Events, PermissionFlagsBits, PermissionsBitField, Routes } from "discord.js";
import type { APIRoleColors, Client, REST, RoleColors } from "discord.js";
import { canClaimStatsRoleSlot, formatClaimedStatsRoleName, formatUnclaimedStatsRoleName, getStatsRoleSlot, getStatsRolePositions, parseStatsRoleColor } from "./statsRoleSlotData.ts";
import type { StatsRoleNaming, StatsRoleSlots } from "./statsRoleSlotData.ts";
import { startStatsRoleSlots } from "./statsRoleSlots.ts";

test("stats role colors accept six-digit hex, including black, and reject invalid input", () => {
    assert.equal(parseStatsRoleColor("#808080"), 0x808080);
    assert.equal(parseStatsRoleColor("ABCDEF"), 0xabcdef);
    assert.equal(parseStatsRoleColor("#000000"), 0);
    assert.equal(parseStatsRoleColor("#FFF"), null);
    assert.equal(parseStatsRoleColor("GG0000"), null);
    assert.equal(parseStatsRoleColor("red"), null);
});

test("claimed role names display current streak, longest streak when different, and level", () => {
    assert.equal(formatClaimedStatsRoleName(8, 21, 23), "8🔥21 • Level 23");
    assert.equal(formatClaimedStatsRoleName(8, 8, 23), "8🔥 • Level 23");
    assert.equal(formatClaimedStatsRoleName(0, 21, 0), "0🔥21 • Level 0");
    assert.equal(formatClaimedStatsRoleName(0, 0, 0), "0🔥 • Level 0");
    assert.equal(formatClaimedStatsRoleName(8, 21, 23, "{current}/{longest} • L{level} ({streak})"), "8/21 • L23 (8🔥21)");
});

test("owners retain their slot while unassigned members advance", () => {
    const slots: StatsRoleSlots = { "1": { roleId: "role1" }, "2": { roleId: "role2" } };
    assert.equal(getStatsRoleSlot(slots, "first"), 1);
    assert.equal(getStatsRoleSlot(slots, "second"), 1);
    assert.equal(canClaimStatsRoleSlot(slots, "2", "second"), false);
    slots["1"]!.ownerId = "first";
    assert.equal(getStatsRoleSlot(slots, "first"), 1);
    assert.equal(getStatsRoleSlot(slots, "second"), 2);
    assert.equal(canClaimStatsRoleSlot(slots, "1", "second"), false);
    slots["2"]!.ownerId = "second";
    assert.equal(getStatsRoleSlot(slots, "second"), 2);
    assert.equal(getStatsRoleSlot(slots, "third"), 3);
    assert.equal(getStatsRoleSlot(JSON.parse(JSON.stringify(slots)), "first"), 1);
});

test("new claims move below other stats roles and released slots return to numeric order", () => {
    const slots: StatsRoleSlots = { "1": { roleId: "role1" }, "2": { roleId: "role2" }, "10": { roleId: "role10" } };
    const roles = [{ id: "role1", position: 10 }, { id: "unrelated", position: 9 }, { id: "role2", position: 8 }, { id: "role10", position: 5 }];
    const apply = (claims: string[]) => {
        const positions = getStatsRolePositions(slots, roles, claims);
        for (const update of positions) roles.find(role => role.id === update.role)!.position = update.position;
        return roles.filter(role => role.id !== "unrelated").sort((a, b) => b.position - a.position).map(role => role.id);
    };
    assert.deepEqual(getStatsRolePositions(slots, roles, []), []);
    slots["1"]!.ownerId = "first";
    assert.deepEqual(apply(["role1"]), ["role2", "role10", "role1"]);
    slots["2"]!.ownerId = "second";
    assert.deepEqual(apply(["role2"]), ["role10", "role1", "role2"]);
    assert.deepEqual(getStatsRolePositions(slots, roles, []), []);
    delete slots["1"]!.ownerId;
    assert.deepEqual(apply([]), ["role1", "role10", "role2"]);
    delete slots["2"]!.ownerId;
    assert.deepEqual(apply([]), ["role1", "role2", "role10"]);
    assert.equal(roles.find(role => role.id === "unrelated")!.position, 9);
});

const applyRolePatch = (role: { name: string; colors: RoleColors }, body: unknown) => {
    const { name, colors } = body as { name: string; colors?: APIRoleColors };
    role.name = name;
    if (colors) {
        role.colors = {
            primaryColor: colors.primary_color,
            secondaryColor: colors.secondary_color,
            tertiaryColor: colors.tertiary_color,
        };
    }
    return colors !== undefined;
};

test("simultaneous role claims persist the first owner, rename the role, and remove competing claims", async () => {
    const client = new EventEmitter();
    const slots: StatsRoleSlots = { "1": { roleId: "role1" }, "2": { roleId: "role2" } };
    const removals: string[] = [];
    const renames: string[] = [];
    const saves: string[] = [];
    const published: number[][] = [];
    let positionUpdates = 0;
    let claimedEdits = 0;
    const roles = new Map(["role1", "role2"].map((id, index) => [id, {
        id, position: 2 - index,
        name: `Unclaimed Role ${index + 1}`,
        colors: { primaryColor: 0, secondaryColor: null, tertiaryColor: null } as RoleColors,
    }]));
    let initialized = false;
    const guild = {
        id: "guild",
        roles: { fetch: async (id?: string) => id ? roles.get(id)! : new Collection(roles) },
        members: { fetch: async (options?: { user: string }) => {
            if (options) return members.get(options.user)!;
            initialized = true;
            return new Collection();
        } },
    };
    const makeMember = (id: string) => {
        const cache = new Collection([["role1", { id: "role1" }]]);
        return {
            id, guild, user: { username: `${id}-name` },
            roles: {
                cache,
                highest: { colors: { primaryColor: 0x123456, secondaryColor: 0x654321, tertiaryColor: null } },
            },
        };
    };
    const members = new Map([["first", makeMember("first")], ["second", makeMember("second")]]);
    Object.assign(client, { guilds: { fetch: async () => guild } });
    Object.assign(client, {
        user: { id: "unmyne" },
        rest: {
            patch: async (route, { body } = {}) => {
                if (route === Routes.guildRoles("guild")) {
                    positionUpdates++;
                    for (const update of body as { id: string; position: number }[]) {
                        roles.get(update.id)!.position = update.position;
                    }
                    return;
                }
                const role = [...roles.values()].find(role => route === Routes.guildRole("guild", role.id));
                assert.ok(role);
                const previousName = role.name;
                if (applyRolePatch(role, body)) claimedEdits++;
                if (role.name !== previousName) renames.push(role.name);
            },
            delete: async route => {
                const member = members.get("second")!;
                assert.equal(route, Routes.guildMemberRole("guild", member.id, "role1"));
                member.roles.cache.delete("role1");
                removals.push(member.id);
            },
        } satisfies Pick<REST, "patch" | "delete">,
    });
    startStatsRoleSlots(client as unknown as Client, new EventEmitter() as unknown as Client, "guild", slots, { nameFormat: "{status} Role {slot}" },
        async () => { saves.push(JSON.stringify(slots)); },
        async () => { published.push([getStatsRoleSlot(slots, "first"), getStatsRoleSlot(slots, "second")]); },
        async () => formatClaimedStatsRoleName(8, 21, 23));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(initialized, true);
    client.emit(Events.GuildMemberUpdate, { roles: { cache: new Collection() } }, members.get("first"));
    client.emit(Events.GuildMemberUpdate, { roles: { cache: new Collection() } }, members.get("second"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(slots["1"]!.ownerId, "first");
    assert.equal(saves.length, 1);
    assert.equal(JSON.parse(saves[0]!)["1"].ownerId, "first");
    assert.deepEqual(renames, ["Locked Role 2", "8🔥21 • Level 23", "Unclaimed Role 2"]);
    assert.equal(roles.get("role1")!.name, "8🔥21 • Level 23");
    assert.equal(roles.get("role2")!.name, "Unclaimed Role 2");
    assert.equal(claimedEdits, 1);
    assert.deepEqual(roles.get("role1")!.colors, members.get("first")!.roles.highest.colors);
    assert.equal(roles.get("role1")!.position, 1);
    assert.equal(roles.get("role2")!.position, 2);
    assert.equal(positionUpdates, 1);
    assert.deepEqual(removals, ["second"]);
    assert.deepEqual(published.at(-1), [1, 2]);
    client.emit(Events.GuildMemberUpdate, { roles: { cache: new Collection([["role1", {}]]) } }, members.get("second"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(slots["1"]!.ownerId, "first");
    assert.equal(saves.length, 1);
    members.get("first")!.roles.cache.delete("role1");
    client.emit(Events.GuildMemberUpdate, { roles: { cache: new Collection([["role1", {}]]) } }, members.get("first"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(slots["1"]!.ownerId, undefined);
    assert.equal(saves.length, 2);
    assert.equal(JSON.parse(saves[1]!)["1"].ownerId, undefined);
    assert.equal(roles.get("role1")!.name, "Unclaimed Role 1");
    assert.equal(roles.get("role2")!.name, "Locked Role 2");
    assert.equal(roles.get("role1")!.position, 2);
    assert.equal(roles.get("role2")!.position, 1);
    assert.equal(positionUpdates, 2);
    assert.deepEqual(published.at(-1), [1, 1]);
});

test("managed Linked Roles can be configured when Unmyne passes permission and hierarchy checks", async () => {
    const client = new EventEmitter();
    const slots: StatsRoleSlots = {};
    const replies: string[] = [];
    let saves = 0;
    const botMember = {
        id: "unmyne",
        permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        roles: { highest: { id: "bot-role", position: 220, comparePositionTo: () => 1 } },
    };
    const role = {
        id: "linked-role", name: "Unclaimed Role 1", managed: true, editable: false, position: 2,
        colors: { primaryColor: 0x123456, secondaryColor: 0x654321 as number | null, tertiaryColor: null as number | null },
        tags: { guildConnections: true },
    };
    const guild = {
        roles: { fetch: async () => role },
        members: { fetch: async (options?: { user: string; force: boolean }) => {
            if (!options) return new Collection();
            assert.deepEqual(options, { user: "unmyne", force: true });
            return botMember;
        } },
    };
    Object.assign(client, { guilds: { fetch: async () => guild } });
    const naming: StatsRoleNaming = { nameFormat: "{status} Role {slot}" };
    Object.assign(client, {
        user: { id: "unmyne" },
        rest: {
            patch: async (route, { body } = {}) => {
                assert.equal(route, Routes.guildRole("guild", role.id));
                applyRolePatch(role, body);
            },
            delete: async () => { assert.fail("Unexpected role removal"); },
        } satisfies Pick<REST, "patch" | "delete">,
    });
    const commandClient = new EventEmitter();
    startStatsRoleSlots(client as unknown as Client, commandClient as unknown as Client, "guild", slots, naming,
        async () => { saves++; }, async () => {}, async () => formatClaimedStatsRoleName(0, 0, 0));
    const interaction = {
        isChatInputCommand: () => true,
        commandName: "stats-role",
        guildId: "guild",
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: { getSubcommand: () => "slot", getInteger: () => 1, getRole: () => role },
        deferReply: async () => {},
        editReply: async (reply: string | { content: string }) => { replies.push(typeof reply === "string" ? reply : reply.content); },
    };
    commandClient.emit(Events.InteractionCreate, interaction);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(slots["1"], { roleId: role.id });
    assert.equal(saves, 1);
    assert.match(replies.at(-1)!, /mapped to/);
    botMember.permissions = new PermissionsBitField();
    commandClient.emit(Events.InteractionCreate, interaction);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 1);
    assert.match(replies.at(-1)!, /Manage Roles permission:\*\* Missing/);
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "unclaimed_format" ? "{status} Stats #{slot}" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 2);
    assert.equal(naming.nameFormat, "{status} Stats #{slot}");
    assert.equal(role.name, "Unclaimed Stats #1");
    assert.equal(formatUnclaimedStatsRoleName(naming.nameFormat, "2", true), "Locked Stats #2");
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "claimed_format" ? "{streak} • L{level}" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 3);
    assert.equal(naming.claimedNameFormat, "{streak} • L{level}");
    assert.equal(naming.nameFormat, "{status} Stats #{slot}");
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "unclaimed_format" ? "{status} #{slot}" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 4);
    assert.equal(naming.claimedNameFormat, "{streak} • L{level}");
    assert.equal(naming.nameFormat, "{status} #{slot}");
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "locked_format" ? "🔒 Slot {slot}" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 5);
    assert.equal(naming.lockedNameFormat, "🔒 Slot {slot}");
    assert.equal(naming.claimedNameFormat, "{streak} • L{level}");
    assert.equal(naming.nameFormat, "{status} #{slot}");
    assert.equal(formatUnclaimedStatsRoleName(naming.lockedNameFormat, "2", true), "🔒 Slot 2");
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "unclaimed_format" ? "Open {slot}" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 6);
    assert.equal(naming.nameFormat, "Open {slot}");
    assert.equal(naming.lockedNameFormat, "🔒 Slot {slot}");
    assert.equal(naming.claimedNameFormat, "{streak} • L{level}");
    assert.equal(role.name, "Open 1");
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "unclaimed_color" ? "#000000" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 7);
    assert.equal(naming.unclaimedColor, 0);
    assert.deepEqual(role.colors, { primaryColor: 0, secondaryColor: null, tertiaryColor: null });
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: (name: string) => name === "locked_color" ? "#303030" : null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 8);
    assert.equal(naming.lockedColor, 0x303030);
    assert.equal(naming.unclaimedColor, 0);
    assert.equal(role.colors.primaryColor, 0);
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: {
            getSubcommand: () => "config",
            getString: (name: string) => name === "unclaimed_color" ? "#000001" : name === "locked_color" ? "GG0000" : null,
        },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 8);
    assert.equal(naming.unclaimedColor, 0);
    assert.equal(naming.lockedColor, 0x303030);
    assert.match(replies.at(-1)!, /six hexadecimal digits/);
    commandClient.emit(Events.InteractionCreate, {
        ...interaction,
        options: { getSubcommand: () => "config", getString: () => null },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 8);
    assert.equal(naming.claimedNameFormat, "{streak} • L{level}");
    assert.equal(naming.nameFormat, "Open {slot}");
    assert.equal(naming.lockedNameFormat, "🔒 Slot {slot}");
    assert.equal(naming.unclaimedColor, 0);
    assert.equal(naming.lockedColor, 0x303030);
    assert.match(replies.at(-1)!, /nothing changed/);
});
