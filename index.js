// index.js
console.log("INDEX FILE HAS STARTED");

require("dotenv").config();

console.log("Starting IFWL Discord bot v0.5...");
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

const BOT_VERSION = "IFWL Event Bot v0.5 Multi-Game";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_FILE =
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "google-service-account.json";

const EVENTS_SHEET = "EventSignupEvents";
const SIGNUPS_SHEET = "Signups";

const EVENT_META_MARKER = "---IFWL_EVENT_META_V1---";
const PENDING_DATA_TTL_MS = 1000 * 60 * 30;

/**
 * IMPORTANT:
 * Your existing sheets stay the same.
 *
 * EventSignupEvents columns:
 * Active | Event ID | Event Name | Event URL | Event Date | Max Seats | Notes
 *
 * Signups columns:
 * Signup ID | Date Signed Up | Event ID | Event Name | Event URL |
 * Discord ID | Discord Name | Guild Nickname | Driver Number |
 * Driver Name | GT3 Car | Session Token
 *
 * To avoid breaking the working sheet, extra multi-game event data is stored
 * inside the existing Notes column as readable notes + hidden JSON metadata.
 */

// ============================================================================
// CAR LISTS
// ============================================================================

const ACC_PC_GT3_CARS = [
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

const ACC_PC_GT4_CARS = [
  "Alpine A110 GT4",
  "Aston Martin Vantage GT4",
  "Audi R8 LMS GT4",
  "BMW M4 GT4",
  "Chevrolet Camaro GT4.R",
  "Ginetta G55 GT4",
  "KTM X-Bow GT4",
  "Maserati MC GT4",
  "McLaren 570S GT4",
  "Mercedes-AMG GT4",
  "Porsche 718 Cayman GT4 Clubsport"
];

const ACC_PC_GT2_CARS = [
  "Audi R8 LMS GT2",
  "KTM X-Bow GT2",
  "Maserati MC20 GT2",
  "Mercedes-AMG GT2",
  "Porsche 911 GT2 RS Clubsport Evo",
  "Porsche 935"
];

const ACC_PC_GTC_CUP_CARS = [
  "BMW M2 CS Racing",
  "Ferrari 488 Challenge Evo",
  "Lamborghini Huracan Super Trofeo Evo2",
  "Lamborghini Huracan Super Trofeo EVO",
  "Porsche 911 II GT3 Cup",
  "Porsche 992 GT3 Cup"
];

const ACC_PC_TCX_CARS = [
  "BMW M2 CS Racing"
];

/**
 * ACC Console is kept separate from ACC PC.
 * The public car names can look the same, but the IDs can differ later.
 * For now, signups still store the friendly car name because your sheet and
 * Apps Script currently expect a name in the existing "GT3 Car" column.
 */
const ACC_CONSOLE_GT3_CARS = [
  { id: "console_aston_martin_v8_vantage_gt3", name: "Aston Martin V8 Vantage GT3" },
  { id: "console_audi_r8_lms_evo_ii", name: "Audi R8 LMS Evo II" },
  { id: "console_bentley_continental_gt3_2018", name: "Bentley Continental GT3 2018" },
  { id: "console_bmw_m4_gt3", name: "BMW M4 GT3" },
  { id: "console_ferrari_296_gt3", name: "Ferrari 296 GT3" },
  { id: "console_ford_mustang_gt3", name: "Ford Mustang GT3" },
  { id: "console_honda_nsx_gt3_evo", name: "Honda NSX GT3 Evo" },
  { id: "console_lamborghini_huracan_gt3_evo2", name: "Lamborghini Huracan GT3 Evo2" },
  { id: "console_lexus_rc_f_gt3", name: "Lexus RC F GT3" },
  { id: "console_mclaren_720s_gt3_evo", name: "McLaren 720S GT3 Evo" },
  { id: "console_mercedes_amg_gt3_evo", name: "Mercedes-AMG GT3 Evo" },
  { id: "console_nissan_gt_r_nismo_gt3_2018", name: "Nissan GT-R Nismo GT3 2018" },
  { id: "console_porsche_992_gt3_r", name: "Porsche 992 GT3 R" }
];

const ACC_CONSOLE_GT4_CARS = [
  { id: "console_alpine_a110_gt4", name: "Alpine A110 GT4" },
  { id: "console_aston_martin_vantage_gt4", name: "Aston Martin Vantage GT4" },
  { id: "console_audi_r8_lms_gt4", name: "Audi R8 LMS GT4" },
  { id: "console_bmw_m4_gt4", name: "BMW M4 GT4" },
  { id: "console_chevrolet_camaro_gt4r", name: "Chevrolet Camaro GT4.R" },
  { id: "console_ginetta_g55_gt4", name: "Ginetta G55 GT4" },
  { id: "console_ktm_xbow_gt4", name: "KTM X-Bow GT4" },
  { id: "console_maserati_mc_gt4", name: "Maserati MC GT4" },
  { id: "console_mclaren_570s_gt4", name: "McLaren 570S GT4" },
  { id: "console_mercedes_amg_gt4", name: "Mercedes-AMG GT4" },
  { id: "console_porsche_718_cayman_gt4", name: "Porsche 718 Cayman GT4 Clubsport" }
];

const LMU_HYPERCARS = [
  { id: "alpine_a424", name: "Alpine A424" },
  { id: "aston_martin_valkyrie_amr_lmh", name: "Aston Martin Valkyrie AMR-LMH" },
  { id: "bmw_m_hybrid_v8", name: "BMW M Hybrid V8" },
  { id: "cadillac_v_series_r", name: "Cadillac V-Series.R" },
  { id: "ferrari_499p", name: "Ferrari 499P" },
  { id: "glickenhaus_scg_007", name: "Glickenhaus SCG 007" },
  { id: "isotta_fraschini_tipo_6", name: "Isotta Fraschini Tipo 6" },
  { id: "lamborghini_sc63", name: "Lamborghini SC63" },
  { id: "peugeot_9x8", name: "Peugeot 9X8" },
  { id: "peugeot_9x8_2024", name: "Peugeot 9X8 2024" },
  { id: "porsche_963", name: "Porsche 963" },
  { id: "toyota_gr010_hybrid", name: "Toyota GR010-Hybrid" },
  { id: "vanwall_vandervell_680", name: "Vanwall Vandervell 680" }
];

const LMU_LMGT3_CARS = [
  { id: "aston_martin_vantage_amr_lmgt3", name: "Aston Martin Vantage AMR LMGT3" },
  { id: "bmw_m4_lmgt3", name: "BMW M4 LMGT3" },
  { id: "corvette_z06_lmgt3r", name: "Corvette Z06 LMGT3.R" },
  { id: "ferrari_296_lmgt3", name: "Ferrari 296 LMGT3" },
  { id: "ford_mustang_lmgt3", name: "Ford Mustang LMGT3" },
  { id: "lexus_rc_f_lmgt3", name: "Lexus RC F LMGT3" },
  { id: "mclaren_720s_lmgt3_evo", name: "McLaren 720S LMGT3 Evo" },
  { id: "mercedes_amg_lmgt3", name: "Mercedes-AMG LMGT3" },
  { id: "porsche_911_gt3_r_lmgt3", name: "Porsche 911 GT3 R LMGT3" }
];

const LMU_LMP2_CARS = [
  { id: "oreca_07_gibson", name: "Oreca 07 Gibson" }
];

const RACEROOM_WTCR_CARS = [
  { id: "audi_rs3_lms_2021", name: "Audi RS 3 LMS 2021" },
  { id: "cupra_leon_competicion", name: "Cupra Leon Competición" },
  { id: "honda_civic_tcr", name: "Honda Civic TCR" },
  { id: "hyundai_elantra_tcr_2022", name: "Hyundai Elantra TCR 2022" },
  { id: "hyundai_i30_n_tcr", name: "Hyundai i30 N TCR" },
  { id: "lada_vesta_tcr", name: "Lada Vesta TCR" },
  { id: "lynk_co_03_tcr", name: "Lynk & Co 03 TCR" },
  { id: "renault_megane_rs_tcr", name: "Renault Mégane RS TCR" },
  { id: "volkswagen_golf_gti_tcr", name: "Volkswagen Golf GTI TCR" }
];

// ============================================================================
// EVENT CONFIG
// ============================================================================

const EVENT_CONFIG = {
  acc_pc: {
    key: "acc_pc",
    label: "ACC PC",
    shortLabel: "ACC PC",
    defaultCategory: "gt3",
    supportsEntryListRefresh: true,
    categories: {
      gt3: {
        key: "gt3",
        label: "GT3 New Gen",
        carLabel: "GT3 car",
        cars: ACC_PC_GT3_CARS.map(name => ({ id: name, name }))
      },
      gt4: {
        key: "gt4",
        label: "GT4",
        carLabel: "GT4 car",
        cars: ACC_PC_GT4_CARS.map(name => ({ id: name, name }))
      },
      gt2: {
        key: "gt2",
        label: "GT2",
        carLabel: "GT2 car",
        cars: ACC_PC_GT2_CARS.map(name => ({ id: name, name }))
      },
      gtc_cup: {
        key: "gtc_cup",
        label: "GTC / Cup",
        carLabel: "GTC / Cup car",
        cars: ACC_PC_GTC_CUP_CARS.map(name => ({ id: name, name }))
      },
      tcx: {
        key: "tcx",
        label: "TCX",
        carLabel: "TCX car",
        cars: ACC_PC_TCX_CARS.map(name => ({ id: name, name }))
      },
      multiclass: {
        key: "multiclass",
        label: "Multiclass / Custom",
        carLabel: "Car / class",
        cars: [],
        allowCustomCarInput: true
      }
    }
  },

  acc_console: {
    key: "acc_console",
    label: "ACC Console",
    shortLabel: "ACC Console",
    defaultCategory: "gt3",
    supportsEntryListRefresh: true,
    categories: {
      gt3: {
        key: "gt3",
        label: "GT3 New Gen",
        carLabel: "GT3 car",
        cars: ACC_CONSOLE_GT3_CARS
      },
      gt4: {
        key: "gt4",
        label: "GT4",
        carLabel: "GT4 car",
        cars: ACC_CONSOLE_GT4_CARS
      },
      custom: {
        key: "custom",
        label: "Custom Console Class",
        carLabel: "Car / class",
        cars: [],
        allowCustomCarInput: true
      }
    }
  },

  lmu: {
    key: "lmu",
    label: "Le Mans Ultimate",
    shortLabel: "LMU",
    defaultCategory: "hypercar",
    supportsEntryListRefresh: false,
    categories: {
      hypercar: {
        key: "hypercar",
        label: "Hypercar",
        carLabel: "Hypercar",
        cars: LMU_HYPERCARS
      },
      lmgt3: {
        key: "lmgt3",
        label: "LMGT3",
        carLabel: "LMGT3 car",
        cars: LMU_LMGT3_CARS
      },
      lmp2: {
        key: "lmp2",
        label: "LMP2",
        carLabel: "LMP2 car",
        cars: LMU_LMP2_CARS
      },
      multiclass: {
        key: "multiclass",
        label: "Multiclass / Custom",
        carLabel: "Car / class",
        cars: [],
        allowCustomCarInput: true
      }
    }
  },

  raceroom: {
    key: "raceroom",
    label: "RaceRoom",
    shortLabel: "RaceRoom",
    defaultCategory: "wtcr",
    supportsEntryListRefresh: false,
    categories: {
      wtcr: {
        key: "wtcr",
        label: "WTCR / TCR",
        carLabel: "WTCR / TCR car",
        cars: RACEROOM_WTCR_CARS
      },
      custom: {
        key: "custom",
        label: "Custom RaceRoom Class",
        carLabel: "Car / class",
        cars: [],
        allowCustomCarInput: true
      }
    }
  },

  custom: {
    key: "custom",
    label: "Custom / Adhoc Event",
    shortLabel: "Custom",
    defaultCategory: "custom",
    supportsEntryListRefresh: false,
    categories: {
      custom: {
        key: "custom",
        label: "Custom / Adhoc",
        carLabel: "Car / class",
        cars: [],
        allowCustomCarInput: true
      }
    }
  }
};

const GAME_ALIASES = {
  "acc pc": "acc_pc",
  "acc_pc": "acc_pc",
  "acc-pc": "acc_pc",
  "acc": "acc_pc",
  "gt3 new gen": "acc_pc",

  "acc console": "acc_console",
  "acc_console": "acc_console",
  "acc-console": "acc_console",
  "console": "acc_console",

  "lmu": "lmu",
  "le mans ultimate": "lmu",
  "lemans ultimate": "lmu",
  "le-mans-ultimate": "lmu",

  "raceroom": "raceroom",
  "race room": "raceroom",
  "rr": "raceroom",

  "custom": "custom",
  "adhoc": "custom",
  "ad hoc": "custom",
  "custom / adhoc": "custom"
};

// ============================================================================
// DISCORD CLIENT
// ============================================================================

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

// ============================================================================
// SMALL HELPERS
// ============================================================================

function getServiceAccountPath() {
  return path.join(__dirname, SERVICE_ACCOUNT_FILE);
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

function normaliseKey(value) {
  return safeValue(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normaliseGameKey(value) {
  const key = normaliseKey(value);

  if (!key) {
    return "acc_pc";
  }

  return GAME_ALIASES[key] || key.replace(/[\s-]+/g, "_");
}

function getGameConfig(gameKey) {
  return EVENT_CONFIG[gameKey] || EVENT_CONFIG.acc_pc;
}

function getCategoryConfig(gameKey, categoryKey) {
  const gameConfig = getGameConfig(gameKey);
  const chosenCategoryKey = categoryKey || gameConfig.defaultCategory;
  return (
    gameConfig.categories[chosenCategoryKey] ||
    gameConfig.categories[gameConfig.defaultCategory] ||
    Object.values(gameConfig.categories)[0]
  );
}

function cleanupPendingMaps() {
  const now = Date.now();

  for (const [key, value] of pendingSignupCars.entries()) {
    if (!value || now - value.selectedAt > PENDING_DATA_TTL_MS) {
      pendingSignupCars.delete(key);
    }
  }

  for (const [key, value] of pendingSignupMessages.entries()) {
    if (!value || now - value.savedAt > PENDING_DATA_TTL_MS) {
      pendingSignupMessages.delete(key);
    }
  }
}

function truncateText(value, maxLength) {
  const text = safeValue(value).trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function validateImageUrl(value) {
  const url = safeValue(value).trim();

  if (!url) {
    return "";
  }

  if (!/^https?:\/\//i.test(url)) {
    return "";
  }

  return url;
}

function getOptionalString(interaction, optionName, fallback = "") {
  try {
    return interaction.options.getString(optionName) || fallback;
  } catch (error) {
    return fallback;
  }
}

function getOptionalInteger(interaction, optionName, fallback = null) {
  try {
    const value = interaction.options.getInteger(optionName);
    return value === null || value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function getOptionalAttachment(interaction, optionName) {
  try {
    return interaction.options.getAttachment(optionName) || null;
  } catch (error) {
    return null;
  }
}

function formatAllowedCarsForNotes(cars) {
  if (!cars || !cars.length) {
    return "";
  }

  return cars.map(car => car.name || car).join(", ");
}

function buildHumanNotes(baseNotes, eventMeta) {
  const parts = [];

  if (baseNotes) {
    parts.push(baseNotes);
  }

  if (eventMeta.customGameLabel) {
    parts.push(`Custom Game: ${eventMeta.customGameLabel}`);
  }

  if (eventMeta.customCategoryLabel) {
    parts.push(`Custom Category: ${eventMeta.customCategoryLabel}`);
  }

  if (eventMeta.allowedCarsText) {
    parts.push(`Allowed Cars: ${eventMeta.allowedCarsText}`);
  }

  if (eventMeta.imageUrl) {
    parts.push(`Image: ${eventMeta.imageUrl}`);
  }

  return parts.join("\n");
}

function encodeEventNotes(baseNotes, eventMeta) {
  const humanNotes = buildHumanNotes(baseNotes, eventMeta);

  return [
    humanNotes,
    EVENT_META_MARKER,
    JSON.stringify(eventMeta)
  ]
    .filter(Boolean)
    .join("\n");
}

function decodeEventNotes(notes) {
  const raw = safeValue(notes);

  if (!raw.includes(EVENT_META_MARKER)) {
    return {
      humanNotes: raw,
      meta: null
    };
  }

  const [humanPart, jsonPart] = raw.split(EVENT_META_MARKER);

  try {
    return {
      humanNotes: safeValue(humanPart).trim(),
      meta: JSON.parse(safeValue(jsonPart).trim())
    };
  } catch (error) {
    console.warn("Could not parse event metadata from notes:", error);

    return {
      humanNotes: raw.replace(EVENT_META_MARKER, "").trim(),
      meta: null
    };
  }
}

function getEventGameLabel(eventData) {
  if (eventData.customGameLabel) {
    return eventData.customGameLabel;
  }

  return getGameConfig(eventData.gameKey).label;
}

function getEventCategoryLabel(eventData) {
  if (eventData.customCategoryLabel) {
    return eventData.customCategoryLabel;
  }

  return getCategoryConfig(eventData.gameKey, eventData.categoryKey).label;
}

function getEventCarLabel(eventData) {
  return getCategoryConfig(eventData.gameKey, eventData.categoryKey).carLabel || "Car";
}

function getEventCarOptions(eventData) {
  const categoryConfig = getCategoryConfig(eventData.gameKey, eventData.categoryKey);
  return Array.isArray(categoryConfig.cars) ? categoryConfig.cars : [];
}

function shouldUseCarSelect(eventData) {
  const categoryConfig = getCategoryConfig(eventData.gameKey, eventData.categoryKey);
  const cars = getEventCarOptions(eventData);

  return cars.length > 0 && !categoryConfig.allowCustomCarInput;
}

function isAccEvent(eventData) {
  return eventData.gameKey === "acc_pc" || eventData.gameKey === "acc_console";
}

function buildEventMetaFromInteraction(interaction) {
  const gameRaw = getOptionalString(interaction, "game", "ACC PC");
  const categoryRaw = getOptionalString(interaction, "category", "");
  const customGameLabel = getOptionalString(interaction, "customgame", "").trim();
  const customCategoryLabel = getOptionalString(interaction, "customcategory", "").trim();
  const allowedCarsText = getOptionalString(interaction, "allowedcars", "").trim();
  const imageUrlText = validateImageUrl(getOptionalString(interaction, "imageurl", ""));
  const imageAttachment = getOptionalAttachment(interaction, "image");

  let gameKey = normaliseGameKey(gameRaw);

  if (!EVENT_CONFIG[gameKey]) {
    gameKey = "custom";
  }

  const gameConfig = getGameConfig(gameKey);

  let categoryKey = categoryRaw
    ? normaliseKey(categoryRaw).replace(/[\s-]+/g, "_")
    : gameConfig.defaultCategory;

  if (!gameConfig.categories[categoryKey]) {
    categoryKey = gameConfig.defaultCategory;
  }

  if (gameKey === "custom") {
    categoryKey = "custom";
  }

  const imageUrl =
    imageUrlText ||
    validateImageUrl(imageAttachment?.url) ||
    "";

  const categoryConfig = getCategoryConfig(gameKey, categoryKey);

  return {
    version: 1,
    gameKey,
    categoryKey,
    gameLabel: gameConfig.label,
    categoryLabel: categoryConfig.label,
    customGameLabel,
    customCategoryLabel,
    allowedCarsText,
    imageUrl
  };
}

function buildEventDataFromSheetRow(row) {
  const decodedNotes = decodeEventNotes(row[6]);
  const meta = decodedNotes.meta || {};

  const gameKey = meta.gameKey || normaliseGameKey(meta.gameLabel || row[6] || "ACC PC");
  const gameConfig = getGameConfig(gameKey);
  const categoryKey = meta.categoryKey || gameConfig.defaultCategory;

  return {
    active: safeValue(row[0]).toLowerCase() === "true",
    eventId: safeValue(row[1]),
    eventName: safeValue(row[2]),
    eventUrl: safeValue(row[3]),
    date: safeValue(row[4]),
    slots: Number(row[5]) || 0,
    notes: decodedNotes.humanNotes,
    rawNotes: safeValue(row[6]),
    game: meta.customGameLabel || meta.gameLabel || gameConfig.label,
    gameKey,
    categoryKey,
    customGameLabel: meta.customGameLabel || "",
    customCategoryLabel: meta.customCategoryLabel || "",
    allowedCarsText: meta.allowedCarsText || "",
    imageUrl: validateImageUrl(meta.imageUrl || "")
  };
}

// ============================================================================
// GOOGLE SHEETS
// ============================================================================

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
          eventData.rawNotes
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

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (safeValue(row[1]) === eventId) {
      const eventData = buildEventDataFromSheetRow(row);
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

// ============================================================================
// APPS SCRIPT ENTRYLIST REFRESH
// ============================================================================

async function refreshEntryListViaAppsScript(eventId, eventData = null) {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;

  if (!appsScriptUrl) {
    console.warn("APPS_SCRIPT_URL is not set. EntryList refresh skipped.");
    return;
  }

  if (eventData && !isAccEvent(eventData)) {
    console.log(
      `EntryList refresh skipped for non-ACC event: ${eventData.gameKey}`
    );
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

// ============================================================================
// DISCORD UI BUILDERS
// ============================================================================

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

  const gameLabel = getEventGameLabel(eventData);
  const categoryLabel = getEventCategoryLabel(eventData);

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
        value: gameLabel || "ACC PC",
        inline: true
      },
      {
        name: "Category",
        value: categoryLabel || "GT3 New Gen",
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
      text: `${BOT_VERSION} • Google Sheets connected`
    })
    .setTimestamp();

  if (eventData.eventUrl) {
    embed.addFields({
      name: "Event Link",
      value: eventData.eventUrl,
      inline: false
    });
  }

  if (eventData.allowedCarsText) {
    embed.addFields({
      name: "Allowed Cars / Notes",
      value: truncateText(eventData.allowedCarsText, 900),
      inline: false
    });
  }

  if (eventData.notes) {
    const notesWithoutMeta = eventData.notes
      .split("\n")
      .filter(line => !line.startsWith("Image:"))
      .join("\n")
      .trim();

    if (notesWithoutMeta) {
      embed.addFields({
        name: "Notes",
        value: truncateText(notesWithoutMeta, 900),
        inline: false
      });
    }
  }

  if (eventData.imageUrl) {
    embed.setImage(eventData.imageUrl);
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

function buildCarSelectMenu(eventData) {
  const cars = getEventCarOptions(eventData).slice(0, 25);
  const categoryLabel = getEventCategoryLabel(eventData);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`ifwl_car_select_${eventData.eventId}`)
    .setPlaceholder(`Select your ${categoryLabel} car`);

  selectMenu.addOptions(
    cars.map(car =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(car.name, 100))
        .setValue(car.name)
    )
  );

  return new ActionRowBuilder().addComponents(selectMenu);
}

function buildSignupModal(eventData, customCarRequired) {
  const modal = new ModalBuilder()
    .setCustomId(`ifwl_signup_modal_${eventData.eventId}`)
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

  if (customCarRequired) {
    const customCarInput = new TextInputBuilder()
      .setCustomId("custom_car")
      .setLabel(getEventCarLabel(eventData))
      .setPlaceholder("Example: BMW M4 GT3 / Hypercar / WTCR / Any")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80);

    modal.addComponents(
      new ActionRowBuilder().addComponents(customCarInput)
    );
  }

  return modal;
}

// ============================================================================
// INTERACTION HANDLERS
// ============================================================================

async function handlePostEvent(interaction) {
  await interaction.deferReply();

  const eventName = interaction.options.getString("eventname");
  const date = interaction.options.getString("date");
  const slots = interaction.options.getInteger("slots");
  const eventUrl = getOptionalString(interaction, "eventurl", "");
  const baseNotes = getOptionalString(interaction, "notes", "");

  const eventMeta = buildEventMetaFromInteraction(interaction);
  const gameConfig = getGameConfig(eventMeta.gameKey);
  const categoryConfig = getCategoryConfig(eventMeta.gameKey, eventMeta.categoryKey);

  if (!eventMeta.allowedCarsText && categoryConfig.cars && categoryConfig.cars.length > 0) {
    eventMeta.allowedCarsText = formatAllowedCarsForNotes(categoryConfig.cars);
  }

  const eventId = makeEventId();

  const rawNotes = encodeEventNotes(baseNotes, eventMeta);

  const eventData = {
    active: true,
    eventId,
    eventName,
    eventUrl,
    date,
    slots,
    notes: buildHumanNotes(baseNotes, eventMeta),
    rawNotes,
    game: eventMeta.customGameLabel || gameConfig.label,
    gameKey: eventMeta.gameKey,
    categoryKey: eventMeta.categoryKey,
    customGameLabel: eventMeta.customGameLabel,
    customCategoryLabel: eventMeta.customCategoryLabel,
    allowedCarsText: eventMeta.allowedCarsText,
    imageUrl: eventMeta.imageUrl,
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
  cleanupPendingMaps();

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

  if (shouldUseCarSelect(eventData)) {
    await interaction.reply({
      content: `Please select your ${getEventCarLabel(eventData)} for **${eventData.eventName}**.`,
      components: [buildCarSelectMenu(eventData)],
      ephemeral: true
    });
    return;
  }

  pendingSignupCars.set(pendingKey, {
    car: "",
    selectedAt: Date.now(),
    customInputRequired: true
  });

  await interaction.showModal(buildSignupModal(eventData, true));
}

async function handleCarSelect(interaction, eventId) {
  cleanupPendingMaps();

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
  const allowedCarNames = getEventCarOptions(eventData).map(car => car.name);

  if (!allowedCarNames.includes(selectedCar)) {
    await interaction.reply({
      content: `That is not in the approved ${getEventCategoryLabel(eventData)} list.`,
      ephemeral: true
    });
    return;
  }

  const pendingKey = makePendingSignupKey(eventId, interaction.user.id);

  pendingSignupCars.set(pendingKey, {
    car: selectedCar,
    selectedAt: Date.now(),
    customInputRequired: false
  });

  await interaction.showModal(buildSignupModal(eventData, false));
}

async function handleSignupModal(interaction, eventId) {
  cleanupPendingMaps();

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

  if (!pendingCarData && shouldUseCarSelect(eventData)) {
    await interaction.editReply({
      content:
        "I could not find your selected car. Please click Sign Up again and select your car first."
    });
    return;
  }

  const driverName = interaction.fields.getTextInputValue("driver_name").trim();
  const driverNumber = interaction.fields
    .getTextInputValue("driver_number")
    .trim();

  let selectedCar = pendingCarData?.car || "";

  if (pendingCarData?.customInputRequired || !shouldUseCarSelect(eventData)) {
    try {
      selectedCar = interaction.fields.getTextInputValue("custom_car").trim();
    } catch (error) {
      selectedCar = selectedCar || getEventCategoryLabel(eventData);
    }
  }

  if (!selectedCar) {
    await interaction.editReply({
      content: `Please provide your ${getEventCarLabel(eventData)}.`
    });
    return;
  }

  if (shouldUseCarSelect(eventData)) {
    const allowedCarNames = getEventCarOptions(eventData).map(car => car.name);

    if (!allowedCarNames.includes(selectedCar)) {
      pendingSignupCars.delete(pendingKey);

      await interaction.editReply({
        content:
          "Your selected car is not in the approved list. Please try signing up again."
      });
      return;
    }
  }

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
    gt3Car: selectedCar,
    sessionToken: "DISCORD_BOT"
  };

  await appendSignupToSheet(signupData);

  await refreshEntryListViaAppsScript(eventData.eventId, eventData);

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
    content: `You are now signed up for **${eventData.eventName}** as **#${driverNumber} ${driverName}** in **${selectedCar}**.`
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

  await refreshEntryListViaAppsScript(eventData.eventId, eventData);

  await interaction.message.edit({
    embeds: [await buildEventEmbed(eventData)],
    components: [buildEventButtons(eventId)]
  });

  await interaction.followUp({
    content: `You have withdrawn from **${eventData.eventName}**.`,
    ephemeral: true
  });
}

// ============================================================================
// DISCORD EVENTS
// ============================================================================

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
