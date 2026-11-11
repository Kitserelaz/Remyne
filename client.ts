import { once } from "node:events";
import { Client, Events, GatewayIntentBits } from "discord.js";

export const streaksGuildId = "1216816878937313442";

const unmyneToken = process.env.UNMYNE_TOKEN?.trim();
const altToken = process.env.ALT_TOKEN?.trim();
if (!unmyneToken || !altToken) throw new Error("UNMYNE_TOKEN and ALT_TOKEN are required.");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
export const remyneClient = new Client({ intents: [GatewayIntentBits.Guilds] });
const connect = async (bot: Client, token: string) => {
    const ready = once(bot, Events.ClientReady);
    await Promise.all([ready, bot.login(token)]);
    console.log(`Ready! Logged in as ${bot.user!.tag}`);
};

await Promise.all([connect(client, unmyneToken), connect(remyneClient, altToken)]);
export default client;
