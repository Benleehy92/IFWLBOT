// index.js
console.log("INDEX FILE HAS STARTED");

require("dotenv").config();

console.log("Starting IFWL Discord bot v0.4...");
console.log("Discord token loaded:", process.env.DISCORD_TOKEN ? "YES" : "NO");
console.log("Google Sheet ID loaded:", process.env.GOOGLE_SHEET_ID ? "YES" : "NO");
console.log("Google service file:", process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "NOT SET");
console.log("Google service JSON loaded:", process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "YES" : "NO");
console.log("Apps Script URL loaded:", process.env.APPS_SCRIPT_URL ? "YES" : "NO");

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");

const BOT_VERSION = "IFWL Event Bot v0.4";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_FILE =
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "google-service-account.json";

const EVENTS_SHEET = "EventSignupEvents";
const SIGNUPS_SHEET = "Signups";

/**
 * IMPORTANT:
 * These names must match the Google Apps Script accCarModelFromName_() map exactly.
 */
const GT3_NEW_GEN_CARS = [
  "Aston Martin V8 Vantage GT3",
  "Audi R8 LMS Evo II",
  "Bentley Continental GT3 2018",
  "BMW M4 GT3",
  "Ferrari 296 GT3",
  "Ford Mustang GT3",
  "Honda NSX GT3 Evo",
  "Lamborghini Huracan GT3 Evo2",
  "Lexus RC F GT3",
  "McLaren 720S GT3 Evo",
  "Mercedes-AMG GT3 Evo",
  "Nissan GT-R Nismo GT3 2018",
  "Porsche 992 GT3 R"
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let sheetsClient = null;

// Google Sheets is the main source of truth.
// This just saves event details during the current runtime.
const eventCache = new Map();

// Temporarily stores selected car before modal submit.
// Key format: `${eventId}_${discordUserId}`
const pendingSignupCars = new Map();

// Temporarily stores the original Discord event message object.
// This avoids searching recent channel messages.
const pendingSignupMessages = new Map();

function getServiceAccountPath() {
  return path.join(__dirname, SERVICE_ACCOUNT_FILE);
}

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  let auth;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log("Using Google service account from Railway variable...");

    let credentials;

    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (error) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Check the Railway variable."
      );
    }

    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  } else {
    console.log("Using Google service account from local JSON file...");

    const serviceAccountPath = getServiceAccountPath();

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `Google service account file not found: ${serviceAccountPath}`
      );
    }

    auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  }

  sheetsClient = google.sheets({
    version: "v4",
    auth
  });

  return sheetsClient;
}

function makeSignupId() {
  return `discord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEventId() {
  return `IFWL-EVENT-${Date.now()}`;
}

function nowForSheet() {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    hour12: false
  });
}

function safeValue(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function makePendingSignupKey(eventId, discordUserId) {
  return `${eventId}_${discordUserId}`;
}

async function refreshEntryListViaAppsScript(eventId) {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;

  if (!appsScriptUrl) {
    console.warn("APPS_SCRIPT_URL is not set. EntryList refresh skipped.");
    return;
  }

  const url = `${appsScriptUrl}?action=entrylist&eventId=${encodeURIComponent(eventId)}`;

  try {
    console.log("Refreshing EntryList via Apps Script...");
    const response = await fetch(url);
    const text = await response.text();

    console.log("EntryList refresh response:", text.slice(0, 500));
  } catch (error) {
    console.error("Failed to refresh EntryList via Apps Script:", error);
  }
}

async function appendEventToSheet(eventData) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${EVENTS_SHEET}!A:G`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          true,
          eventData.eventId,
          eventData.eventName,
          eventData.eventUrl,
          eventData.date,
          eventData.slots,
          eventData.notes
        ]
      ]
    }
  });
}

async function getEventsFromSheet() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EVENTS_SHEET}!A:G`
  });

  return response.data.values || [];
}

async function getEventById(eventId) {
  if (eventCache.has(eventId)) {
    return eventCache.get(eventId);
  }

  const rows = await getEventsFromSheet();

  // Header:
  // Active | Event ID | Event Name | Event URL | Event Date | Max Seats | Notes
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (safeValue(row[1]) === eventId) {
      const eventData = {
        active: safeValue(row[0]).toLowerCase() === "true",
        eventId: safeValue(row[1]),
        eventName: safeValue(row[2]),
        eventUrl: safeValue(row[3]),
        date: safeValue(row[4]),
        slots: Number(row[5]) || 0,
        notes: safeValue(row[6]),
        game: safeValue(row[6]) || "GT3 New Gen"
      };

      eventCache.set(eventId, eventData);
      return eventData;
    }
  }

  return null;
}

async function getAllSignupsFromSheet() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SIGNUPS_SHEET}!A:L`
  });

  return response.data.values || [];
}

async function getActiveSignupsForEvent(eventId) {
  const rows = await getAllSignupsFromSheet();

  const signups = [];

  // Header:
  // Signup ID | Date Signed Up | Event ID | Event Name | Event URL |
  // Discord ID | Discord Name | Guild Nickname | Driver Number |
  // Driver Name | GT3 Car | Session Token
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (safeValue(row[2]) === eventId) {
      signups.push({
        rowNumber: i + 1,
        signupId: safeValue(row[0]),
        dateSignedUp: safeValue(row[1]),
        eventId: safeValue(row[2]),
        eventName: safeValue(row[3]),
        eventUrl: safeValue(row[4]),
        discordId: safeValue(row[5]),
        discordName: safeValue(row[6]),
        guildNickname: safeValue(row[7]),
        driverNumber: safeValue(row[8]),
        driverName: safeValue(row[9]),
        gt3Car: safeValue(row[10]),
        sessionToken: safeValue(row[11])
      });
    }
  }

  return signups;
}

async function findSignupRow(eventId, discordId) {
  const rows = await getAllSignupsFromSheet();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const rowEventId = safeValue(row[2]);
    const rowDiscordId = safeValue(row[5]);

    if (rowEventId === eventId && rowDiscordId === discordId) {
      return {
        rowNumber: i + 1,
        values: row
      };
    }
  }

  return null;
}

async function appendSignupToSheet(signupData) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SIGNUPS_SHEET}!A:L`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          signupData.signupId,
          signupData.dateSignedUp,
          signupData.eventId,
          signupData.eventName,
          signupData.eventUrl,
          signupData.discordId,
          signupData.discordName,
          signupData.guildNickname,
          signupData.driverNumber,
          signupData.driverName,
          signupData.gt3Car,
          signupData.sessionToken
        ]
      ]
    }
  });
}

async function deleteSignupRow(rowNumber) {
  const sheets = await getSheetsClient();

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  const signupSheet = spreadsheet.data.sheets.find(
    sheet => sheet.properties.title === SIGNUPS_SHEET
  );

  if (!signupSheet) {
    throw new Error(`Could not find sheet tab: ${SIGNUPS_SHEET}`);
  }

  const sheetId = signupSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    }
  });
}

async function buildEventEmbed(eventData) {
  const signups = await getActiveSignupsForEvent(eventData.eventId);
  const signupCount = signups.length;
  const slotsText = `${signupCount} / ${eventData.slots}`;

  const signedUpDrivers =
    signupCount === 0
      ? "No drivers signed up yet."
      : signups
          .map((driver, index) => {
            const mention = driver.discordId
              ? `<@${driver.discordId}>`
              : driver.guildNickname || driver.discordName || "Unknown driver";

            const number = driver.driverNumber
              ? `#${driver.driverNumber}`
              : "No number";

            const driverName = driver.driverName || "Unknown driver";
            const car = driver.gt3Car ? ` — ${driver.gt3Car}` : "";

            return `${index + 1}. ${mention} | ${number} | ${driverName}${car}`;
          })
          .join("\n")
          .slice(0, 3900);

  const embed = new EmbedBuilder()
    .setColor(0xf5c542)
    .setTitle("🏁 IFWL Event Signup")
    .setDescription("Click a button below to sign up or withdraw.")
    .addFields(
      {
        name: "Event",
        value: eventData.eventName || "Unknown event",
        inline: false
      },
      {
        name: "Game",
        value: eventData.game || eventData.notes || "GT3 New Gen",
        inline: true
      },
      {
        name: "Date / Time",
        value: eventData.date || "Not set",
        inline: true
      },
      {
        name: "Slots",
        value: slotsText,
        inline: true
      },
      {
        name: "Signed Up Drivers",
        value: signedUpDrivers || "No drivers signed up yet.",
        inline: false
      }
    )
    .setFooter({
      text: `${BOT_VERSION} • Google Sheets + EntryList connected`
    })
    .setTimestamp();

  if (eventData.eventUrl) {
    embed.addFields({
      name: "Event Link",
      value: eventData.eventUrl,
      inline: false
    });
  }

  return embed;
}

function buildEventButtons(eventId) {
  const signUpButton = new ButtonBuilder()
    .setCustomId(`ifwl_signup_${eventId}`)
    .setLabel("Sign Up")
    .setEmoji("✅")
    .setStyle(ButtonStyle.Success);

  const withdrawButton = new ButtonBuilder()
    .setCustomId(`ifwl_withdraw_${eventId}`)
    .setLabel("Withdraw")
    .setEmoji("❌")
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder().addComponents(signUpButton, withdrawButton);
}

function buildCarSelectMenu(eventId) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`ifwl_car_select_${eventId}`)
    .setPlaceholder("Select your GT3 New Gen car")
    .addOptions(
      GT3_NEW_GEN_CARS.map(car =>
        new StringSelectMenuOptionBuilder()
          .setLabel(car)
          .setValue(car)
      )
    );

  return new ActionRowBuilder().addComponents(selectMenu);
}

function buildSignupModal(eventId) {
  const modal = new ModalBuilder()
    .setCustomId(`ifwl_signup_modal_${eventId}`)
    .setTitle("IFWL Event Signup");

  const driverNameInput = new TextInputBuilder()
    .setCustomId("driver_name")
    .setLabel("Driver Name")
    .setPlaceholder("Example: IFWL XSL4Y3RX")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(60);

  const driverNumberInput = new TextInputBuilder()
    .setCustomId("driver_number")
    .setLabel("Driver Number")
    .setPlaceholder("Example: 81")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(8);

  modal.addComponents(
    new ActionRowBuilder().addComponents(driverNameInput),
    new ActionRowBuilder().addComponents(driverNumberInput)
  );

  return modal;
}

async function handlePostEvent(interaction) {
  await interaction.deferReply();

  const eventName = interaction.options.getString("eventname");
  const date = interaction.options.getString("date");
  const game = interaction.options.getString("game");
  const slots = interaction.options.getInteger("slots");
  const eventUrl = interaction.options.getString("eventurl") || "";
  const notes = interaction.options.getString("notes") || game || "";

  const eventId = makeEventId();

  const eventData = {
    active: true,
    eventId,
    eventName,
    eventUrl,
    date,
    game,
    slots,
    notes,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString()
  };

  eventCache.set(eventId, eventData);

  await appendEventToSheet(eventData);

  await interaction.editReply({
    embeds: [await buildEventEmbed(eventData)],
    components: [buildEventButtons(eventId)]
  });
}

async function handleSignupButton(interaction, eventId) {
  const eventData = await getEventById(eventId);

  if (!eventData) {
    await interaction.reply({
      content:
        "I could not find this event in Google Sheets. Please ask staff to repost the event.",
      ephemeral: true
    });
    return;
  }

  if (!eventData.active) {
    await interaction.reply({
      content: "This event is no longer active.",
      ephemeral: true
    });
    return;
  }

  const existingSignup = await findSignupRow(eventId, interaction.user.id);

  if (existingSignup) {
    await interaction.reply({
      content: "You are already signed up for this event.",
      ephemeral: true
    });
    return;
  }

  const currentSignups = await getActiveSignupsForEvent(eventId);

  if (currentSignups.length >= eventData.slots) {
    await interaction.reply({
      content: "This event is already full.",
      ephemeral: true
    });
    return;
  }

  const pendingKey = makePendingSignupKey(eventId, interaction.user.id);

  pendingSignupMessages.set(pendingKey, {
    message: interaction.message,
    savedAt: Date.now()
  });

  await interaction.reply({
    content: `Please select your GT3 New Gen car for **${eventData.eventName}**.`,
    components: [buildCarSelectMenu(eventId)],
    ephemeral: true
  });
}

async function handleCarSelect(interaction, eventId) {
  const eventData = await getEventById(eventId);

  if (!eventData) {
    await interaction.reply({
      content:
        "I could not find this event in Google Sheets. Please ask staff to repost the event.",
      ephemeral: true
    });
    return;
  }

  const existingSignup = await findSignupRow(eventId, interaction.user.id);

  if (existingSignup) {
    await interaction.reply({
      content: "You are already signed up for this event.",
      ephemeral: true
    });
    return;
  }

  const currentSignups = await getActiveSignupsForEvent(eventId);

  if (currentSignups.length >= eventData.slots) {
    await interaction.reply({
      content: "This event is already full.",
      ephemeral: true
    });
    return;
  }

  const selectedCar = interaction.values[0];

  if (!GT3_NEW_GEN_CARS.includes(selectedCar)) {
    await interaction.reply({
      content: "That car is not in the approved GT3 New Gen list.",
      ephemeral: true
    });
    return;
  }

  const pendingKey = makePendingSignupKey(eventId, interaction.user.id);

  pendingSignupCars.set(pendingKey, {
    car: selectedCar,
    selectedAt: Date.now()
  });

  await interaction.showModal(buildSignupModal(eventId));
}

async function handleSignupModal(interaction, eventId) {
  await interaction.deferReply({ ephemeral: true });

  const eventData = await getEventById(eventId);

  if (!eventData) {
    await interaction.editReply({
      content:
        "I could not find this event in Google Sheets. Please ask staff to repost the event."
    });
    return;
  }

  const existingSignup = await findSignupRow(eventId, interaction.user.id);

  if (existingSignup) {
    await interaction.editReply({
      content: "You are already signed up for this event."
    });
    return;
  }

  const currentSignups = await getActiveSignupsForEvent(eventId);

  if (currentSignups.length >= eventData.slots) {
    await interaction.editReply({
      content: "This event is already full."
    });
    return;
  }

  const pendingKey = makePendingSignupKey(eventId, interaction.user.id);
  const pendingCarData = pendingSignupCars.get(pendingKey);

  if (!pendingCarData || !pendingCarData.car) {
    await interaction.editReply({
      content:
        "I could not find your selected car. Please click Sign Up again and select your car first."
    });
    return;
  }

  const gt3Car = pendingCarData.car;

  if (!GT3_NEW_GEN_CARS.includes(gt3Car)) {
    pendingSignupCars.delete(pendingKey);

    await interaction.editReply({
      content:
        "Your selected car is not in the approved GT3 New Gen list. Please try signing up again."
    });
    return;
  }

  const driverName = interaction.fields.getTextInputValue("driver_name").trim();
  const driverNumber = interaction.fields
    .getTextInputValue("driver_number")
    .trim();

  const signupData = {
    signupId: makeSignupId(),
    dateSignedUp: nowForSheet(),
    eventId: eventData.eventId,
    eventName: eventData.eventName,
    eventUrl: eventData.eventUrl,
    discordId: interaction.user.id,
    discordName: interaction.user.username,
    guildNickname: interaction.member?.displayName || interaction.user.username,
    driverNumber,
    driverName,
    gt3Car,
    sessionToken: "DISCORD_BOT"
  };

  await appendSignupToSheet(signupData);

  // This is the important new part:
  // It forces your existing Apps Script to rebuild EntryList and EntryListJSON.
  await refreshEntryListViaAppsScript(eventData.eventId);

  pendingSignupCars.delete(pendingKey);

  try {
    const pendingMessageData = pendingSignupMessages.get(pendingKey);

    if (pendingMessageData && pendingMessageData.message) {
      await pendingMessageData.message.edit({
        embeds: [await buildEventEmbed(eventData)],
        components: [buildEventButtons(eventId)]
      });

      pendingSignupMessages.delete(pendingKey);
    }
  } catch (editError) {
    console.error("Could not edit event message after signup:", editError);
  }

  await interaction.editReply({
    content: `You are now signed up for **${eventData.eventName}** as **#${driverNumber} ${driverName}** in the **${gt3Car}**.`
  });
}

async function handleWithdrawButton(interaction, eventId) {
  await interaction.deferUpdate();

  const eventData = await getEventById(eventId);

  if (!eventData) {
    await interaction.followUp({
      content:
        "I could not find this event in Google Sheets. Please ask staff to repost the event.",
      ephemeral: true
    });
    return;
  }

  const existingSignup = await findSignupRow(eventId, interaction.user.id);

  if (!existingSignup) {
    await interaction.followUp({
      content: "You are not currently signed up for this event.",
      ephemeral: true
    });
    return;
  }

  await deleteSignupRow(existingSignup.rowNumber);

  // Rebuild EntryList and EntryListJSON after withdrawal too.
  await refreshEntryListViaAppsScript(eventData.eventId);

  await interaction.message.edit({
    embeds: [await buildEventEmbed(eventData)],
    components: [buildEventButtons(eventId)]
  });

  await interaction.followUp({
    content: `You have withdrawn from **${eventData.eventName}**.`,
    ephemeral: true
  });
}

client.once(Events.ClientReady, readyClient => {
  console.log(`${BOT_VERSION} is online as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "postevent") {
        await handlePostEvent(interaction);
        return;
      }
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith("ifwl_signup_")) {
        const eventId = customId.replace("ifwl_signup_", "");
        await handleSignupButton(interaction, eventId);
        return;
      }

      if (customId.startsWith("ifwl_withdraw_")) {
        const eventId = customId.replace("ifwl_withdraw_", "");
        await handleWithdrawButton(interaction, eventId);
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;

      if (customId.startsWith("ifwl_car_select_")) {
        const eventId = customId.replace("ifwl_car_select_", "");
        await handleCarSelect(interaction, eventId);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      if (customId.startsWith("ifwl_signup_modal_")) {
        const eventId = customId.replace("ifwl_signup_modal_", "");
        await handleSignupModal(interaction, eventId);
        return;
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message =
      "Something went wrong while handling that action. Check the bot terminal for the full error.";

    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content: message
        });
      } else if (interaction.replied) {
        await interaction.followUp({
          content: message,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: message,
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error("Could not send error response to Discord:", replyError);
    }
  }
});

client
  .login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log("Login request sent to Discord...");
  })
  .catch(error => {
    console.error("Bot login failed:");
    console.error(error);
  });