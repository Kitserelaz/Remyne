# Remyne

Remyne runs both Discord Linked Roles providers, Common Role and permission checks,
and stats-role management. Maikaky tracks streaks, fetches Lurkr levels, and
serves both through its authenticated stats endpoint. See [Linked Roles](LINKED_ROLES.md)
for the server commands and role setup.

## Configuration

Install with `bun install --frozen-lockfile` and run with `bun run index.ts`.
Remyne listens on port 3000. Set these variables in the host's private environment:

```dotenv
token=<same existing main Discord bot token as Maikaky>
UNMYNE_TOKEN=<Unmyne bot token>
DISCORD_CLIENT_SECRET=<existing main application OAuth secret>
DISCORD_REDIRECT_URI=<existing HTTPS URL ending in /oauth/discord/callback>
LINKED_ROLES_TOKEN_MESSAGE_ID=<existing main token message ID>
ALT_TOKEN=<existing alt Discord bot token>
ALT_CLIENT_SECRET=<existing alt application OAuth secret>
ALT_LINKED_ROLES_TOKEN_MESSAGE_ID=<existing alt token message ID>
LINKED_ROLES_ENCRYPTION_KEY=<existing base64 encryption key>
REMYNE_DATA_MESSAGE_ID=<new roles configuration message ID>
MAIKAKY_STATS_URL=https://stats.example.com
STATS_API_TOKEN=<same dedicated shared secret as Maikaky>
```

Maikaky keeps `LURKR_API_KEY`; Remyne does not need it. Both processes use the
existing main bot identity and therefore share its credentials and Discord limits.
Keep the existing Guild Members intent enabled on the main bot. Remyne uses
Unmyne for guild role changes and channel permission updates. Install Unmyne in
the tracked server, give it Manage Roles, and place its highest role above the
stats roles. Channel overwrite setup and reconciliation also require Manage
Channels on the affected channels. The alt application remains installed as a
Linked Roles provider and is accessed through REST only.

## Cutover from the combined bot

1. Prepare both releases and their private environments. On Maikaky, set
   `STATS_API_TOKEN` to the same new random secret and expose
   `GET /internal/stats/:userId` at the HTTPS origin in `MAIKAKY_STATS_URL`.
   Keep `LURKR_API_KEY` and Maikaky's existing streak and general settings.
2. Stop the old combined process before switching over. Save a private backup
   of its general `data.json`. Using the main bot identity, post a new message
   in the existing data channel with a `data.json` attachment containing only
   `linkedRoles`, `statsRoleSlots`, and `statsRoleNaming` from the old file.
   Omit fields that weren't set. Use the new message ID for `REMYNE_DATA_MESSAGE_ID`.
   Replace the original attachment with the same general data minus those three
   fields. Keep the two encrypted token messages and their encryption key as-is.
3. Route these existing public paths to Remyne, preserving the HTTPS host and
   paths configured in Discord:

   - `/linked-roles`
   - `/oauth/discord/callback`
   - `/alt/linked-roles`
   - `/alt/oauth/discord/callback`

   Avoid logging callback query strings or stats authorization headers.
4. Start Maikaky, then one Remyne process. Remyne alone updates the two token
   messages, role settings, and role commands. Existing authorizations remain
   tied to the same applications; anyone mid-authorization at cutover can start
   the verification flow again.
5. Remove the linked-role OAuth, token storage, and alt settings from Maikaky's
   environment after the cutover. Keep the main bot token on both hosts.

A stats request failure leaves the affected member's published main-provider
metadata and claimed-role name in place until a successful refresh. Alt permission
and slot metadata does not need the stats service.
