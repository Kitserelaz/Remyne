import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ApplicationIntegrationType,
    Events,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import type { RESTPutAPIApplicationCommandsJSONBody } from "discord.js";
import { remyneClient, streaksGuildId } from "./client.ts";
import { dataContent, saveData } from "./dataMsg.ts";
import { registerLinkedRolesSchema } from "./linkedRolesMetadata.ts";

export const linkedRoleRequirementCommand: RESTPutAPIApplicationCommandsJSONBody[number] = {
    type: ApplicationCommandType.ChatInput,
    name: "linked-role-requirement",
    description: "Choose the Common Role used by Linked Roles",
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    integration_types: [ApplicationIntegrationType.GuildInstall],
    contexts: [InteractionContextType.Guild],
    options: [{
        type: ApplicationCommandOptionType.Role,
        name: "role",
        description: "The Common Role members must have",
        required: true,
    }],
};

remyneClient.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "linked-role-requirement") return;
    if (interaction.guildId !== streaksGuildId) {
        await interaction.reply({ content: "Common Role can only be configured in the tracked server.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "You need Manage Server to configure Common Role.", flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const previous = dataContent.linkedRoles;
    const setup = { requiredRoleId: interaction.options.getRole("role", true).id };
    dataContent.linkedRoles = setup;
    try {
        await saveData();
    } catch {
        if (dataContent.linkedRoles === setup) dataContent.linkedRoles = previous;
        console.error("[Linked Roles] Could not save Common Role to the data message.");
        await interaction.editReply("Could not save Common Role. Please try again.");
        return;
    }
    try {
        await registerLinkedRolesSchema();
    } catch {
        console.error("[Linked Roles] Could not update the Common Role description.");
        await interaction.editReply("Common Role saved, but its description could not be updated. Run the command again to retry.");
        return;
    }
    await interaction.editReply({
        content: `Common Role set to <@&${setup.requiredRoleId}>. Connected members update within five minutes.`,
        allowedMentions: { parse: [] },
    });
});
