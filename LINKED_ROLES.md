# Linked Roles

For hosting and cutover, see [Remyne setup](README.md).

## Common Role

In the tracked server, members with **Manage Server** can run
`/linked-role-requirement role:@CommonRole` to select the Common Role. The bot
saves its ID as `linkedRoles.requiredRoleId` in the Remyne configuration message.

Enable **Common Role** in the target role's Linked Roles requirements. Its
`has_required_role` value is `1` only when the connected member currently has
the configured role; it is `0` when no Common Role is configured or the member
does not have it. Membership is derived from Discord rather than stored.
Changes to the setting apply within five minutes. Adding or removing the
Common Role from a connected member also triggers a sync.

## Alt application: permission requirements

The main application keeps its four requirements. The alt application exposes:

| Requirement | Metadata key | Guild permission |
| --- | --- | --- |
| Has Timeout Members permission | `has_timeout_members_permission` | Moderate Members |
| Has Manage Roles permission | `has_manage_roles_permission` | Manage Roles |

The alt also exposes the integer-equality requirement **Stats role slot ID**
(`stats_role_slot_id`).

Set `ALT_TOKEN`, `ALT_CLIENT_SECRET`, and `ALT_LINKED_ROLES_TOKEN_MESSAGE_ID`.
Both applications' configuration and encrypted token messages are required at
startup. The alt token must belong to a different application, and its message
ID must differ from `LINKED_ROLES_TOKEN_MESSAGE_ID`.

Each member authorizes the alt separately from the main application. The two
applications have separate OAuth state, cookies, refresh tokens, REST clients,
and update queues. Existing main connections do not need to reconnect.

The permission values use effective guild permissions: Administrator and the
server owner satisfy both checks. They indicate permission possession rather
than whether an action can be taken against a particular member or role.
Members outside the tracked server receive `0` for both fields. Failed API
requests retain previously published values until a successful sync.

Alt syncs run at startup, after authorization, and every five minutes. Member
role changes, joining/leaving, role permission edits/deletions, and ownership
changes also queue updates through Remyne's Gateway connection.
Alt syncing does not wait for streak data or call Lurkr.

## Stats role slots

1. Restart the bot to register **Stats role slot ID** and the admin command.
2. Create or select a Linked Role. In its requirements, choose the alt application
   and enable **Stats role slot ID**, with its value set to `1`.
3. Run `/stats-role slot slot:1 role:@YourRole` with **Manage Server** in the
   tracked server. Unmyne needs **Manage Roles** and a role above that role.
4. Repeat for slots `2`, `3`, and so on, setting each role's requirement to its
   matching number. The bot cannot read or configure these requirements, so the
   command records the mapping you supply.

Run `/stats-role setup` with **Manage Server** to replace every configured stats
role's channel overwrite with empty allow and deny permissions. This applies to
existing nonempty overwrites and missing overwrites; already-empty overwrites
are skipped without an update request. The command reports the skipped count.
All needed stats role changes for a channel are sent in one update, preserving
the other role and member overwrites. Fully configured channels receive no update.
It targets categories and channels that were not synced to their category when setup began;
synced children inherit their category's changes. Other roles' overwrites are
not edited. Unmyne needs **Manage Channels** and **Manage Roles** in the target channels.
The command reports successful and failed overwrites, logs each channel result,
and keeps running if an individual channel update fails. It does not shut down the bot.

Run `/stats-role audit` with **Manage Server** to list unsynced channels whose
overwrites match their category after excluding configured stats roles. Other
role and member overwrites must match exactly. Synced channels and channels
without a category are excluded. The public report lists each matching channel
and its category, using a text attachment when the list is too long for a message.
When matches are found, click **Reconcile** within 14 minutes to sync the listed
channels to their categories, replacing their overwrites with the categories'
overwrites. Only the administrator who ran the audit can use the button, and
they must still have **Manage Server**. Channels are checked again before syncing;
channels that moved categories, are already synced, or now have other overwrite
differences are skipped. The result reports synced, skipped, and failed channels.

Run `/unsynced_channels` with **Manage Server** for a public report of every
unsynced channel in the server, including channels with differences outside
stats roles. Each differing role or member overwrite shows the category's and
channel's allowed and denied permission names. Missing overwrites are shown
separately from empty overwrites. Long reports are attached as a text file.

Connected members initially publish slot `1`. The first processed claim reserves
that slot for the claimant, saves the ownership, and renames the role using their
current streak, longest streak, and Lurkr level: `8🔥21 • Level 23`. When current
and longest streaks match, the name shortens to `8🔥 • Level 23`.
Its owner continues publishing `1`; unassigned members advance
to `2`. Later claims follow the same pattern. A member can own only one slot.
Members outside the tracked server publish `0`.

Set unused role names with `/stats-role config unclaimed_format:{status} Role {slot}`.
This format applies only to available slots. Configure unavailable slots
independently with `/stats-role config locked_format:🔒 Slot {slot}`.
`{status}` expands to `Unclaimed` or `Locked` for the respective format;
`{slot}` expands to the slot number. Both placeholders are optional. The default
for each format is `{status} Role {slot}`, and resulting names must fit Discord's
100-character limit. The available format is saved as `statsRoleNaming.nameFormat`
and the locked format as `statsRoleNaming.lockedNameFormat` in the Remyne configuration message. Changing one does not change the other.

Set claimed role names separately with
`/stats-role config claimed_format:{streak} • Level {level}`. This is the default
claimed format. `{streak}` produces `8🔥21` or `8🔥` when the two streaks match;
`{current}`, `{longest}`, and `{level}` insert their numeric values individually.
The claimed format is saved as `statsRoleNaming.claimedNameFormat` in the same
data message. All format options are optional and can be provided together.
Omitting an option leaves its saved format unchanged; omitting all makes no
configuration changes. Names update after configuration and claims, and during
startup and periodic reconciliation.

Set available and locked role colors independently with
`/stats-role config unclaimed_color:#808080 locked_color:#303030`. Each color is
six hexadecimal digits, with an optional `#` prefix. Both options are optional;
omitting one keeps its saved value. Colors are saved as
`statsRoleNaming.unclaimedColor` and `statsRoleNaming.lockedColor` in the same
data message. If a color has not been configured, that state's existing role
color is preserved. Unused role name and color changes use a single edit and are
skipped when already correct. Claimed roles still inherit their owner's highest
role colors.

Claimed stats roles also copy their owner's highest role colors, including
gradient colors when present. Name and color changes are combined into one edit
and skipped when both already match. Colors refresh on claim and during the
five-minute reconciliation cycle.

Unclaimed stats roles appear above claimed ones in ascending slot order. A newly
claimed role moves below all other stats roles, preserving the order of previous
claims. Releasing a slot returns it to ascending order among the unclaimed roles.
Reordering uses a single batch request when changes are needed and keeps stats
roles in their existing hierarchy positions so unrelated roles are not reordered.
Position update failures are logged and retried during periodic reconciliation.

Simultaneous claim events are processed through a single queue. If another
member also receives an already claimed role, the bot attempts to remove it and
publishes that member's assigned or next available slot. There can be temporary
overlap while these requests complete. Failed renames or removals are logged and
retried every five minutes; Discord permissions or API restrictions must be
resolved if removal continues failing.

Mappings and ownership are stored in `statsRoleSlots` in the Remyne configuration message. When the recorded owner loses the role, the bot clears and saves the
ownership, restores the configured Unclaimed/Locked name, and refreshes slot
metadata. Removing a competing claimant's role does not release the slot.
Reconciliation also releases slots whose owners are still in the server but no
longer hold their roles, covering missed events. Reservations survive restarts,
OAuth disconnection, and server departures; absence from the server alone does
not release a slot. Claimed slots cannot be remapped to another role.
The bot reconciles existing holders on startup and every five minutes. Claims
missed while offline are resolved in the order members are observed during
reconciliation, since Discord does not provide role acquisition timestamps.
If the next number has no configured role yet, members keep that slot value
until an admin sets up its role.

## Token storage

OAuth access tokens, refresh tokens, and expiry times are stored in a dedicated
bot-authored message in the existing data channel. Its `linked-roles-tokens.enc`
attachment is encrypted with AES-256-GCM, using a fresh 12-byte nonce and a
16-byte authentication tag on each save. The attachment contains the nonce,
authentication tag, and ciphertext, in that order. Plaintext tokens stay in
memory and are never written to disk by the token store.

`LINKED_ROLES_TOKEN_MESSAGE_ID` selects the message.
`LINKED_ROLES_ENCRYPTION_KEY` is a base64-encoded random 32-byte key kept only in
the private `.env`. Keep a private backup of that key; losing it requires members
to reconnect. Never put it in Discord. Missing attachments, failed downloads,
and decryption errors stop loading rather than reset the token store.
Run only one Remyne process against these messages to prevent competing writers.

The alt uses its own main-bot-authored message selected by
`ALT_LINKED_ROLES_TOKEN_MESSAGE_ID`, in the same data channel and encrypted with
the same `LINKED_ROLES_ENCRYPTION_KEY`. Its attachment has the same filename and
format but contains only alt OAuth tokens. Both messages are accessed through
the main bot, so the alt does not need access to the data channel. Preserve both
message IDs and the encryption key when deploying; do not recreate the stores
on startup or overwrite the main message when configuring the alt.

Revoked authorizations are removed from encrypted storage when detected. Members can
disconnect the application in Discord's connection settings. A bot restart
invalidates pending OAuth attempts; members can simply start again.

The registered fields always describe the tracked server, including when an
admin configures this application as a Linked Role requirement in another server.
