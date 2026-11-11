import { Client, Events, GatewayIntentBits } from "discord.js";

export const streaksGuildId = "1216816878937313442";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.once(Events.ClientReady, ready => console.log(`Ready! Logged in as ${ready.user.tag}`));
await client.login(process.env.token);
export default client;
