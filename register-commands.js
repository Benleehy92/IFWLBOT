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
        .setDescription("Game/platform")
        .setRequired(true)
        .addChoices(
          { name: "ACC PC", value: "acc_pc" },
          { name: "ACC Console", value: "acc_console" },
          { name: "Le Mans Ultimate", value: "lmu" },
          { name: "RaceRoom", value: "raceroom" },
          { name: "Custom / Adhoc Event", value: "custom" }
        )
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
        .setDescription("Optional notes for the event")
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName("category")
        .setDescription("Car category/class")
        .setRequired(false)
        .addChoices(
          { name: "GT3 New Gen", value: "gt3" },
          { name: "GT4", value: "gt4" },
          { name: "GT2", value: "gt2" },
          { name: "GTC / Cup", value: "gtc_cup" },
          { name: "TCX", value: "tcx" },
          { name: "Hypercar", value: "hypercar" },
          { name: "LMGT3", value: "lmgt3" },
          { name: "LMP2", value: "lmp2" },
          { name: "WTCR / TCR", value: "wtcr" },
          { name: "Multiclass / Custom", value: "multiclass" },
          { name: "Custom", value: "custom" }
        )
    )

    .addStringOption(option =>
      option
        .setName("customgame")
        .setDescription("Custom game name for adhoc events")
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName("customcategory")
        .setDescription("Custom class/category name for adhoc events")
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName("allowedcars")
        .setDescription("Manual allowed car list or class notes")
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName("imageurl")
        .setDescription("Optional event image URL")
        .setRequired(false)
    )

    .addAttachmentOption(option =>
      option
        .setName("image")
        .setDescription("Optional uploaded event image")
        .setRequired(false)
    )

    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log("Registering IFWL bot slash commands...");

    if (!process.env.DISCORD_TOKEN) {
      throw new Error("DISCORD_TOKEN is missing from .env / Railway variables.");
    }

    if (!process.env.CLIENT_ID) {
      throw new Error("CLIENT_ID is missing from .env / Railway variables.");
    }

    if (!process.env.GUILD_ID) {
      throw new Error("GUILD_ID is missing from .env / Railway variables.");
    }

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Slash commands registered successfully.");
  } catch (error) {
    console.error("Failed to register commands:");
    console.error(error);
  }
}

registerCommands();
