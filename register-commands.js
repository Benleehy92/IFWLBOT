// register-commands.js
require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("postevent")
    .setDescription("Post an IFWL event signup message")
    .addStringOption(option =>
      option
        .setName("eventname")
        .setDescription("Event name, e.g. IFWL TEST EVENT")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("date")
        .setDescription("Event date/time, e.g. 2026-08-21 20:00")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("game")
        .setDescription("Game/platform, e.g. ACC Console, ACC PC, F1 25")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("slots")
        .setDescription("Maximum number of signup slots")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("eventurl")
        .setDescription("Optional event URL, e.g. SimGrid event link")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("notes")
        .setDescription("Optional notes for the sheet")
        .setRequired(false)
    )
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log("Registering IFWL bot slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Slash commands registered successfully.");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

registerCommands();