import express from "express";
import { Routes } from "discord.js";
import client from "./client.ts";
import { startLinkedRoles } from "./linkedRoles.ts";
import { linkedRoleRequirementCommand } from "./linkedRolesSetup.ts";
import { statsRoleCommand } from "./statsRoleSlots.ts";

const app = express();
await startLinkedRoles(app);
for (const command of [linkedRoleRequirementCommand, statsRoleCommand]) {
    await client.rest.post(Routes.applicationCommands(client.user!.id), { body: command });
}
app.listen(3000, () => console.log("Remyne listening on port 3000"));
