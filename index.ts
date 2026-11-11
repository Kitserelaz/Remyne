import express from "express";
import { Routes } from "discord.js";
import client, { remyneClient } from "./client.ts";
import { dataContent } from "./dataMsg.ts";
import { startLinkedRoles } from "./linkedRoles.ts";
import { linkedRoleRequirementCommand } from "./linkedRolesSetup.ts";
import { statsRoleCommand } from "./statsRoleSlots.ts";

const app = express();
await startLinkedRoles(app);
for (const command of [linkedRoleRequirementCommand, statsRoleCommand]) {
    await client.rest.post(Routes.applicationCommands(client.user!.id), { body: command });
}
app.get("/", (_req, res) => {
    const slots = Object.values(dataContent.statsRoleSlots ?? {});
    const claimed = slots.filter(slot => slot.ownerId).length;
    res.set("Cache-Control", "no-store").type("html").send(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Remyne Dashboard</title>
    <style>
        :root {
            color-scheme: light dark;
        }

        body {
            font-family: Inter, system-ui, sans-serif;
        }

        main {
            max-width: 32rem;
            margin: 3rem auto;
            padding: 0 1rem;
        }

        dl {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 0.75rem 1rem;
        }

        dd {
            margin: 0;
        }
    </style>
</head>
<body>
    <main>
        <h1>Remyne</h1>
        <dl>
            <dt>Remyne connection</dt><dd>${remyneClient.isReady() ? "Connected" : "Not ready"}</dd>
            <dt>Unmyne connection</dt><dd>${client.isReady() ? "Connected" : "Not ready"}</dd>
            <dt>Configured stats role slots</dt><dd>${slots.length}</dd>
            <dt>Claimed slots</dt><dd>${claimed}</dd>
        </dl>
    </main>
</body>
</html>`);
});
app.listen(3000, () => console.log("Remyne listening on port 3000"));
