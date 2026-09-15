"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const node_path = require("node:path");
const node_fs = require("node:fs");
const node_child_process = require("node:child_process");
const node_os = require("node:os");
const node_crypto = require("node:crypto");
const node_http = require("node:http");
const zod = require("zod");
const promises = require("node:fs/promises");
const node_stream = require("node:stream");
const promises$1 = require("node:stream/promises");
const hostResolve = require("./chunks/hostResolve-BiertG9H.js");
const node_net = require("node:net");
const node_events = require("node:events");
const AdmZip = require("adm-zip");
const node_util = require("node:util");
const node_dgram = require("node:dgram");
const node_url = require("node:url");
const promises$2 = require("node:dns/promises");
const node_zlib = require("node:zlib");
function file() {
  return node_path.join(electron.app.getPath("userData"), "bootstrap.json");
}
function readBootstrap() {
  if (process.env.NEXUSCRAFT_DATA_DIR?.trim()) {
    return { dataDir: process.env.NEXUSCRAFT_DATA_DIR.trim() };
  }
  try {
    return JSON.parse(node_fs.readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}
function writeBootstrap(config) {
  node_fs.writeFileSync(file(), JSON.stringify(config, null, 2), "utf8");
}
let rootDir = "";
function initPaths(customRoot) {
  rootDir = customRoot && customRoot.trim() ? node_path.resolve(customRoot) : node_path.join(electron.app.getPath("userData"), "data");
  for (const dir of [rootDir, instancesRoot(), versionsRoot(), librariesRoot(), assetsRoot(), runtimesRoot(), cacheRoot(), logsRoot(), skinsRoot()]) {
    node_fs.mkdirSync(dir, { recursive: true });
  }
  return rootDir;
}
function dataRoot() {
  if (!rootDir) throw new Error("paths not initialised");
  return rootDir;
}
const instancesRoot = () => node_path.join(dataRoot(), "instances");
const versionsRoot = () => node_path.join(dataRoot(), "versions");
const librariesRoot = () => node_path.join(dataRoot(), "libraries");
const assetsRoot = () => node_path.join(dataRoot(), "assets");
const runtimesRoot = () => node_path.join(dataRoot(), "runtimes");
const cacheRoot = () => node_path.join(dataRoot(), "cache");
const logsRoot = () => node_path.join(dataRoot(), "logs");
const skinsRoot = () => node_path.join(dataRoot(), "skins");
const nativesRoot = () => node_path.join(dataRoot(), "natives");
const dbFile = () => node_path.join(dataRoot(), "nexuscraft.db");
function instanceDir(instanceId) {
  return node_path.join(instancesRoot(), instanceId);
}
function ensureDir(dir) {
  node_fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function assertInside(parent, child) {
  const p = node_path.resolve(parent);
  const c = node_path.resolve(child);
  if (c !== p && !c.startsWith(p.endsWith(node_path.sep) ? p : p + node_path.sep)) {
    throw new Error(`path escapes its parent directory`);
  }
  return c;
}
const REDACTIONS = [
  // JSON fields carrying secrets
  [/("(?:access_token|refresh_token|id_token|accessToken|refreshToken|Token|device_code|RpsTicket|client_secret|Authorization)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"'],
  // Authorization headers, including the Minecraft XBL3.0 scheme. The whole
  // value has to go, not just the first word after the colon: the secret in
  // "Authorization: Bearer <jwt>" is the *second* word, so a \S+ that stops at
  // "Bearer" leaves the token sitting in the log.
  [/\b(Authorization)\s*[:=]\s*[^\r\n"',}]+/gi, "$1: [redacted]"],
  [/\b(Bearer|XBL3\.0 x=)\s*[^\r\n"',}]+/gi, "$1 [redacted]"],
  // JWTs anywhere in free text
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"],
  // Long opaque MSA tokens
  [/\bM\.[A-Za-z0-9._~-]{20,}/g, "[redacted-token]"],
  // Query-string secrets
  [/([?&](?:code|access_token|refresh_token|token)=)[^&\s]+/gi, "$1[redacted]"]
];
function redact(input) {
  let text;
  if (typeof input === "string") text = input;
  else if (input instanceof Error) text = `${input.name}: ${input.message}
${input.stack ?? ""}`;
  else {
    try {
      text = JSON.stringify(input) ?? String(input);
    } catch {
      text = String(input);
    }
  }
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
}
let stream = null;
function openStream() {
  if (stream) return stream;
  try {
    ensureDir(logsRoot());
    stream = node_fs.createWriteStream(node_path.join(logsRoot(), "launcher.log"), { flags: "a" });
  } catch {
    stream = null;
  }
  return stream;
}
function write(level, scope, parts) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} [${level.toUpperCase()}] [${scope}] ${parts.map(redact).join(" ")}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  openStream()?.write(line + "\n");
}
function createLogger(scope) {
  return {
    debug: (...p) => write("debug", scope, p),
    info: (...p) => write("info", scope, p),
    warn: (...p) => write("warn", scope, p),
    error: (...p) => write("error", scope, p)
  };
}
function closeLogger() {
  stream?.end();
  stream = null;
}
const log$S = createLogger("db");
class SqliteStore {
  backend = "sqlite";
  // Typed loosely: better-sqlite3 is an optional dependency and may be absent.
  db;
  constructor(Database, file2) {
    this.db = new Database(file2);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
  all(collection) {
    const rows = this.db.prepare("SELECT data FROM documents WHERE collection = ?").all(collection);
    const out = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.data));
      } catch {
        log$S.warn(`skipping unparseable document in ${collection}`);
      }
    }
    return out;
  }
  get(collection, id2) {
    const row = this.db.prepare("SELECT data FROM documents WHERE collection = ? AND id = ?").get(collection, id2);
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }
  put(collection, id2, doc) {
    this.db.prepare(
      `INSERT INTO documents (collection, id, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).run(collection, id2, JSON.stringify(doc), Date.now());
  }
  remove(collection, id2) {
    this.db.prepare("DELETE FROM documents WHERE collection = ? AND id = ?").run(collection, id2);
  }
  clear(collection) {
    this.db.prepare("DELETE FROM documents WHERE collection = ?").run(collection);
  }
  kvGet(key) {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
    return row ? row.value : null;
  }
  kvSet(key, value) {
    this.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  kvRemove(key) {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
  close() {
    try {
      this.db.close();
    } catch {
    }
  }
}
class JsonStore {
  constructor(file2) {
    this.file = file2;
    if (node_fs.existsSync(file2)) {
      try {
        const parsed = JSON.parse(node_fs.readFileSync(file2, "utf8"));
        this.data = { documents: parsed.documents ?? {}, kv: parsed.kv ?? {} };
      } catch {
        log$S.warn("json store was unreadable; starting from empty state");
      }
    }
  }
  backend = "json";
  data = { documents: {}, kv: {} };
  writeTimer = null;
  /** Debounced so a burst of writes costs one flush, then written atomically. */
  scheduleFlush() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 120);
  }
  flush() {
    try {
      const tmp = this.file + ".tmp";
      node_fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      node_fs.renameSync(tmp, this.file);
    } catch (err) {
      log$S.error("failed to persist json store", err);
    }
  }
  all(collection) {
    return Object.values(this.data.documents[collection] ?? {});
  }
  get(collection, id2) {
    return (this.data.documents[collection] ?? {})[id2] ?? null;
  }
  put(collection, id2, doc) {
    this.data.documents[collection] ??= {};
    this.data.documents[collection][id2] = doc;
    this.scheduleFlush();
  }
  remove(collection, id2) {
    delete this.data.documents[collection]?.[id2];
    this.scheduleFlush();
  }
  clear(collection) {
    this.data.documents[collection] = {};
    this.scheduleFlush();
  }
  kvGet(key) {
    return this.data.kv[key] ?? null;
  }
  kvSet(key, value) {
    this.data.kv[key] = value;
    this.scheduleFlush();
  }
  kvRemove(key) {
    delete this.data.kv[key];
    this.scheduleFlush();
  }
  close() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.flush();
  }
}
const Collections = {
  accounts: "accounts",
  instances: "instances",
  servers: "servers",
  hostedServers: "hosted_servers",
  skins: "skins"
};
const PROBE_MARKER = "NEXUSCRAFT_SQLITE_OK";
function probeCacheFile() {
  return node_path.join(dataRoot(), ".native-probe.json");
}
function sqliteIsLoadable() {
  let modulePath;
  try {
    modulePath = require.resolve("better-sqlite3");
  } catch {
    log$S.warn("better-sqlite3 is not installed");
    return false;
  }
  const key = `${process.versions.electron ?? "node"}|${process.versions.modules}|${modulePath}`;
  try {
    const cached2 = JSON.parse(node_fs.readFileSync(probeCacheFile(), "utf8"));
    if (cached2.key === key && typeof cached2.ok === "boolean") return cached2.ok;
  } catch {
  }
  const script = `const D=require(${JSON.stringify(modulePath)});const d=new D(':memory:');d.exec('CREATE TABLE probe(a)');d.close();console.log(${JSON.stringify(PROBE_MARKER)})`;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.NODE_OPTIONS;
  let ok = false;
  try {
    const result = node_child_process.spawnSync(process.execPath, ["-e", script], {
      env,
      encoding: "utf8",
      timeout: 2e4,
      windowsHide: true
    });
    ok = result.status === 0 && (result.stdout ?? "").includes(PROBE_MARKER);
    if (!ok) {
      const abiCrash = result.status === 3221225477 || result.signal === "SIGSEGV";
      log$S.warn(
        `better-sqlite3 failed to load (exit ${result.status ?? "signal " + result.signal}); using the JSON backend instead` + (abiCrash ? ` — its prebuilt binary is built for Node's ABI, not Electron ${process.versions.electron}'s (module version ${process.versions.modules}). Rebuilding it from source against Electron would fix it; the JSON store works meanwhile.` : "")
      );
    }
  } catch (err) {
    log$S.warn("could not probe better-sqlite3:", err.message);
    ok = false;
  }
  try {
    node_fs.writeFileSync(probeCacheFile(), JSON.stringify({ key, ok }), "utf8");
  } catch {
  }
  return ok;
}
let store = null;
const MIGRATION_KEY = "migrated-from-json";
function migrateFromJson(target, jsonFile) {
  if (!node_fs.existsSync(jsonFile)) return;
  if (target.kvGet(MIGRATION_KEY)) return;
  let parsed;
  try {
    parsed = JSON.parse(node_fs.readFileSync(jsonFile, "utf8"));
  } catch {
    log$S.warn("the json store could not be read for migration; leaving it alone");
    return;
  }
  const collections = Object.keys(parsed.documents ?? {});
  const keys = Object.keys(parsed.kv ?? {});
  if (collections.length === 0 && keys.length === 0) {
    target.kvSet(MIGRATION_KEY, (/* @__PURE__ */ new Date()).toISOString());
    return;
  }
  const occupied = collections.find((collection) => target.all(collection).length > 0);
  if (occupied) {
    log$S.warn(`sqlite already holds "${occupied}"; skipping the json migration`);
    target.kvSet(MIGRATION_KEY, "skipped: target not empty");
    return;
  }
  let documents = 0;
  for (const collection of collections) {
    for (const [id2, doc] of Object.entries(parsed.documents[collection] ?? {})) {
      if (doc && typeof doc === "object") {
        target.put(collection, id2, doc);
        documents += 1;
      }
    }
  }
  for (const [key, value] of Object.entries(parsed.kv ?? {})) {
    if (typeof value === "string") target.kvSet(key, value);
  }
  target.kvSet(MIGRATION_KEY, (/* @__PURE__ */ new Date()).toISOString());
  log$S.info(
    `migrated ${documents} document(s) across ${collections.length} collection(s) and ${keys.length} setting(s) from the json store; the json file has been left in place`
  );
}
function initDatabase() {
  if (store) return store;
  if (sqliteIsLoadable()) {
    try {
      const Database = require("better-sqlite3");
      const sqlite = new SqliteStore(Database, dbFile());
      migrateFromJson(sqlite, node_path.join(dataRoot(), "nexuscraft-data.json"));
      store = sqlite;
      log$S.info("using the sqlite backend");
      return store;
    } catch (err) {
      log$S.warn("sqlite passed its probe but failed to open:", err.message);
    }
  }
  store = new JsonStore(node_path.join(dataRoot(), "nexuscraft-data.json"));
  log$S.info("using the json backend");
  return store;
}
function db() {
  if (!store) throw new Error("database not initialised");
  return store;
}
function closeDatabase() {
  store?.close();
  store = null;
}
function emit(channel, payload) {
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
function toast(kind, title, message) {
  emit("toast", { kind, title, message });
}
const log$R = createLogger("settings");
const KEY = "app-settings";
function recommendedRamMb() {
  const systemMb = Math.floor(node_os.totalmem() / 1024 / 1024);
  const ceiling = Math.max(1024, Math.min(Math.floor(systemMb * 0.7), systemMb - 2048));
  let max;
  if (systemMb >= 32768) max = 8192;
  else if (systemMb >= 16384) max = 6144;
  else if (systemMb >= 12288) max = 4096;
  else if (systemMb >= 8192) max = 3072;
  else max = 2048;
  max = Math.min(max, ceiling);
  return { min: Math.min(1024, max), max, ceiling, systemMb };
}
function defaults$1() {
  const ram = recommendedRamMb();
  return {
    dataDir: "",
    defaultMaxRamMb: ram.max,
    defaultMinRamMb: ram.min,
    // Modern low-pause collector; the defaults Mojang's own launcher ships with.
    defaultJvmArgs: "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M",
    javaPath: null,
    closeLauncherOnLaunch: false,
    restoreOnGameExit: true,
    keepLauncherOpen: true,
    closeToTray: true,
    desktopNotifications: true,
    discordPresence: true,
    maxConcurrentDownloads: 8,
    showSnapshots: false,
    authFlow: "device-code",
    curseForgeApiKey: process.env.NEXUSCRAFT_CURSEFORGE_KEY?.trim() ?? "",
    /*
     * The Microsoft application this launcher signs in as.
     *
     * Not a secret. Sign-in is the authorization code flow with PKCE and no
     * client secret, which is the pattern Microsoft publishes for desktop apps
     * precisely so the identifier can ship inside one. Every player still signs
     * in with their own Microsoft account and still has to own the game — this
     * only says which application is asking.
     *
     * BUNDLED_CLIENT_ID is replaced at build time from NEXUSCRAFT_CLIENT_ID, so
     * a build made with that set works for whoever installs it without them
     * registering anything. Left unset it stays empty and each person supplies
     * their own in Settings, which is the right default for source builds.
     */
    clientId: (process.env.NEXUSCRAFT_CLIENT_ID?.trim() || "").trim(),
    animatedBackground: true,
    particles: true,
    accentColor: "#5eead4",
    onboardingComplete: false,
    selectedInstanceId: null,
    directoryUrl: ""
  };
}
let cached$1 = null;
function getSettings() {
  if (cached$1) return cached$1;
  const raw = db().kvGet(KEY);
  const base = defaults$1();
  if (!raw) {
    cached$1 = base;
    return cached$1;
  }
  try {
    const stored = JSON.parse(raw);
    cached$1 = { ...base, ...stored };
    if (process.env.NEXUSCRAFT_CLIENT_ID?.trim()) cached$1.clientId = process.env.NEXUSCRAFT_CLIENT_ID.trim();
  } catch {
    log$R.warn("settings were unreadable; restoring defaults");
    cached$1 = base;
  }
  return cached$1;
}
const NUMERIC_BOUNDS = {
  defaultMaxRamMb: [512, 65536],
  defaultMinRamMb: [256, 65536],
  maxConcurrentDownloads: [1, 24]
};
function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in current)) continue;
    const typed = key;
    const expected = typeof current[typed];
    if (value === null && (typed === "javaPath" || typed === "selectedInstanceId")) {
      next[typed] = null;
      continue;
    }
    if (typeof value !== expected && current[typed] !== null) continue;
    if (typeof value === "number") {
      const bounds = NUMERIC_BOUNDS[key];
      if (!Number.isFinite(value)) continue;
      const clamped = bounds ? Math.min(Math.max(Math.round(value), bounds[0]), bounds[1]) : Math.round(value);
      next[typed] = clamped;
      continue;
    }
    if (typeof value === "string") {
      next[typed] = value.slice(0, 4096);
      continue;
    }
    next[typed] = value;
  }
  if (next.defaultMinRamMb > next.defaultMaxRamMb) {
    if ("defaultMinRamMb" in patch) next.defaultMaxRamMb = next.defaultMinRamMb;
    else next.defaultMinRamMb = next.defaultMaxRamMb;
  }
  cached$1 = next;
  db().kvSet(KEY, JSON.stringify(next));
  emit("settings:changed", next);
  return next;
}
const settingsService = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getSettings,
  recommendedRamMb,
  updateSettings
}, Symbol.toStringTag, { value: "Module" }));
const CATALOGUE = {
  // Not a failure: something was superseded or deliberately stopped. The UI
  // treats this code as "say nothing" rather than showing an error.
  CANCELLED: {
    title: "Cancelled",
    message: "That operation was stopped before it finished.",
    actions: []
  },
  AUTH_NOT_CONFIGURED: {
    title: "Microsoft sign-in is not configured",
    message: "This build of NexusCraft has no Azure application (client) ID, so it cannot talk to Microsoft sign-in. A client ID identifies the launcher to Microsoft; it is not a password and is not secret.",
    actions: [
      "Open Settings → Account and paste your Azure application (client) ID",
      'See the README section "Configuring Microsoft authentication" to create one for free',
      "Restart the sign-in once the ID is saved"
    ]
  },
  APP_NOT_APPROVED: {
    title: "This Azure app is not approved for Minecraft yet",
    message: "You signed in successfully and Xbox Live authorised the account — but Mojang refused the final step with HTTP 403. Since 2022, Mojang requires every Azure application to be individually approved before it may use the Minecraft services API. Approval is free, and this is a one-time step for the application, not for your account.",
    actions: [
      "Apply for approval at https://aka.ms/mce-reviewappid using your Azure application (client) ID",
      "Approval is granted by Mojang and can take several days",
      "Nothing else needs changing — sign-in will work once the app is approved",
      'See "Getting your app approved by Mojang" in the README'
    ]
  },
  AUTH_DECLINED: {
    title: "Sign-in was cancelled",
    message: "The sign-in was closed or declined before Microsoft could confirm your account.",
    actions: ['Press "Sign in with Microsoft" to try again']
  },
  AUTH_TIMEOUT: {
    title: "Sign-in timed out",
    message: "The code shown expired before it was entered. Microsoft sign-in codes are only valid for a few minutes.",
    actions: ["Start the sign-in again", "Have the browser window ready before you begin"]
  },
  AUTH_FAILED: {
    title: "Microsoft sign-in failed",
    message: "Microsoft rejected the sign-in attempt.",
    actions: [
      "Check that you are signing in with the account that owns Minecraft",
      'Confirm your Azure app has "Allow public client flows" enabled',
      "Try again in a moment"
    ]
  },
  XBOX_NO_ACCOUNT: {
    title: "No Xbox profile on this account",
    message: "This Microsoft account has no Xbox Live profile. Minecraft: Java Edition sign-in goes through Xbox Live, so one is required.",
    actions: [
      "Sign in at minecraft.net once in a browser to create the Xbox profile",
      "Then return here and sign in again"
    ]
  },
  XBOX_CHILD_ACCOUNT: {
    title: "This account needs to join a family",
    message: "Xbox Live reports this as a child account that is not part of a family group. Microsoft blocks sign-in until an adult adds it to a Microsoft family.",
    actions: ["Add the account to a Microsoft family group at account.microsoft.com/family", "Sign in again afterwards"]
  },
  XBOX_REGION_BLOCKED: {
    title: "Xbox Live is unavailable in this region",
    message: "Xbox Live is not available for the country set on this Microsoft account.",
    actions: ["Check the country/region on your Microsoft account", "Contact Xbox support if it looks correct"]
  },
  NO_MINECRAFT_ENTITLEMENT: {
    title: "No Minecraft: Java Edition on this account",
    message: "Sign-in worked, but this Microsoft account does not own or have access to Minecraft: Java Edition. NexusCraft only launches the game for accounts that own it.",
    actions: [
      "Check you signed in with the right Microsoft account",
      "If you own the game on a different account, switch accounts",
      "If you have Game Pass, launch Minecraft once from the official launcher to activate it"
    ]
  },
  NO_MINECRAFT_PROFILE: {
    title: "Minecraft profile not set up",
    message: "This account has access to Minecraft: Java Edition but has not chosen a username yet, so there is no profile to play with.",
    actions: ["Set your username at minecraft.net/profile", "Then sign in again here"]
  },
  TOKEN_EXPIRED: {
    title: "Your session expired",
    message: "The stored Microsoft session is no longer valid and could not be renewed automatically.",
    actions: ["Sign in again from the Account screen"]
  },
  NETWORK_ERROR: {
    title: "Cannot reach the internet",
    message: "NexusCraft could not reach Mojang or Microsoft servers. This is usually local connectivity, a VPN, or a firewall rule.",
    actions: [
      "Check your internet connection",
      "Allow NexusCraft through your firewall",
      "Disable any VPN or proxy and retry",
      "Mojang services may be down — check status.mojang.com"
    ]
  },
  DOWNLOAD_FAILED: {
    title: "A download did not finish",
    message: "One or more game files could not be downloaded after several attempts.",
    actions: ["Press Retry to resume the failed files only", "Check your connection or antivirus settings"]
  },
  CHECKSUM_MISMATCH: {
    title: "A downloaded file was corrupt",
    message: "A file arrived with the wrong checksum, which means it was damaged in transit or altered by another program.",
    actions: [
      "Press Retry — the file will be downloaded again",
      "If it keeps failing, add NexusCraft to your antivirus exclusions"
    ]
  },
  JAVA_NOT_FOUND: {
    title: "No Java runtime found",
    message: "Minecraft: Java Edition needs a Java runtime, and none was found on this PC.",
    actions: [
      'Press "Install Java automatically" to fetch the runtime Mojang ships for this version',
      "Or set a Java path yourself in Settings → Java"
    ]
  },
  JAVA_VERSION_MISMATCH: {
    title: "Wrong Java version",
    message: "The selected Java runtime is a different major version than this Minecraft version requires.",
    actions: [
      "Let NexusCraft install the matching runtime automatically",
      "Or pick a different Java installation in Settings → Java"
    ]
  },
  INSTANCE_CORRUPT: {
    title: "This instance is incomplete",
    message: "Files this instance needs are missing or unreadable, so it cannot be launched as it stands.",
    actions: ['Press "Repair instance" to re-verify and re-download the missing files']
  },
  MISSING_LIBRARIES: {
    title: "Game libraries are missing",
    message: "Some of the libraries Minecraft loads at startup are not on disk.",
    actions: ['Press "Repair instance" to download them', "Check that antivirus is not quarantining files"]
  },
  LOADER_INSTALL_FAILED: {
    title: "Mod loader installation failed",
    message: "The mod loader could not be installed for this Minecraft version.",
    actions: [
      "Check that the loader supports this Minecraft version",
      "Try a different loader version",
      "Make sure Java is installed — Forge and NeoForge need it to run their installer"
    ]
  },
  MOD_CONFLICT: {
    title: "Mods conflict with each other",
    message: "Two or more mods clash, or a mod does not match this instance. Minecraft would crash on startup.",
    actions: ["Open the Mods screen and review the highlighted mods", "Disable one of each conflicting pair"]
  },
  LAUNCH_FAILED: {
    title: "Minecraft did not start",
    message: "The game process could not be started.",
    actions: [
      'Press "Repair instance" and try again',
      "Check the launch log for the last few lines",
      "Make sure your antivirus is not blocking Java"
    ]
  },
  GAME_CRASHED: {
    title: "Minecraft closed unexpectedly",
    message: "The game started but exited with an error. Mods are the most common cause.",
    actions: ["Open the log to see the final lines", "Disable recently added mods", "Try launching without mods"]
  },
  ALREADY_RUNNING: {
    title: "This instance is already running",
    message: "Minecraft is already open for this instance. Running the same instance twice can corrupt worlds.",
    actions: ["Switch to the running game", "Or stop it from the Play screen first"]
  },
  NOT_FOUND: {
    title: "Not found",
    message: "The item you asked for no longer exists.",
    actions: ["Refresh the screen"]
  },
  INVALID_INPUT: {
    title: "That input is not valid",
    message: "The value provided did not pass validation and was rejected.",
    actions: ["Check the highlighted field and try again"]
  },
  UNKNOWN: {
    title: "Something went wrong",
    message: "An unexpected problem occurred.",
    actions: ["Try again", "If it keeps happening, check the launcher log from Settings"]
  }
};
class LauncherError extends Error {
  code;
  /** Extra technical context, already redacted. */
  detail;
  /** Overrides for the catalogue defaults. */
  overrides;
  constructor(code, detail, overrides = {}) {
    const template = CATALOGUE[code] ?? CATALOGUE.UNKNOWN;
    super(overrides.title ?? template.title);
    this.name = "LauncherError";
    this.code = code;
    this.detail = detail === void 0 || detail === null ? null : redact(detail).slice(0, 2e3);
    this.overrides = overrides;
  }
  toPayload() {
    const template = CATALOGUE[this.code] ?? CATALOGUE.UNKNOWN;
    return {
      code: this.code,
      title: this.overrides.title ?? template.title,
      message: this.overrides.message ?? template.message,
      actions: this.overrides.actions ?? template.actions,
      detail: this.detail
    };
  }
}
function toErrorPayload(err) {
  if (err instanceof LauncherError) return err.toPayload();
  const code = err?.code;
  if (code && ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "ECONNRESET"].includes(code)) {
    return new LauncherError("NETWORK_ERROR", err).toPayload();
  }
  if (code === "ENOENT") {
    return new LauncherError("NOT_FOUND", err).toPayload();
  }
  return new LauncherError("UNKNOWN", err).toPayload();
}
const log$Q = createLogger("http");
const USER_AGENT = "NexusCraftLauncher/1.0.0 (+https://github.com/nexuscraft/launcher)";
const RETRYABLE_STATUS = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504]);
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer2 = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer2);
        reject(new LauncherError("CANCELLED", "aborted while waiting to retry"));
      },
      { once: true }
    );
  });
}
async function request(url, opts = {}) {
  const { method = "GET", headers = {}, body, timeoutMs = 3e4, retries = 3, signal } = opts;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new LauncherError("CANCELLED", "aborted");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer2 = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: { "User-Agent": USER_AGENT, ...headers },
        // Node's fetch accepts strings, Buffers and FormData; the DOM BodyInit
        // type is not available in a Node-targeted lib.
        body,
        signal: controller.signal,
        redirect: "follow"
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1e3 : 500 * 2 ** attempt;
        log$Q.warn(`HTTP ${response.status} for ${safeUrl(url)}; retrying in ${wait}ms`);
        await sleep(Math.min(wait, 15e3), signal);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw new LauncherError("CANCELLED", "aborted");
      if (attempt >= retries) break;
      const wait = 500 * 2 ** attempt;
      log$Q.warn(`request to ${safeUrl(url)} failed (${err.message}); retrying in ${wait}ms`);
      await sleep(wait, signal);
    } finally {
      clearTimeout(timer2);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new LauncherError("NETWORK_ERROR", `${safeUrl(url)}: ${lastError?.message ?? "unknown"}`);
}
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid url]";
  }
}
async function getJson(url, opts = {}) {
  const response = await request(url, opts);
  if (!response.ok) {
    throw new LauncherError("NETWORK_ERROR", `GET ${safeUrl(url)} -> HTTP ${response.status}`);
  }
  return await response.json();
}
async function getBuffer(url, opts = {}) {
  const response = await request(url, opts);
  if (!response.ok) {
    throw new LauncherError("NETWORK_ERROR", `GET ${safeUrl(url)} -> HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
async function getText(url, opts = {}) {
  const response = await request(url, opts);
  if (!response.ok) {
    throw new LauncherError("NETWORK_ERROR", `GET ${safeUrl(url)} -> HTTP ${response.status}`);
  }
  return await response.text();
}
async function fetchImageAsDataUrl(url, opts = {}) {
  try {
    const response = await request(url, { retries: 1, timeoutMs: 15e3, ...opts });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 4 * 1024 * 1024) return null;
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
const log$P = createLogger("secure-store");
const PREFIX = "secret:";
let warnedUnavailable = false;
function isEncryptionAvailable() {
  try {
    return electron.safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
function guard() {
  if (isEncryptionAvailable()) return true;
  if (!warnedUnavailable) {
    warnedUnavailable = true;
    log$P.warn(
      "OS credential encryption is unavailable; refresh tokens will not be persisted and sign-in will be required each session"
    );
  }
  return false;
}
function setSecret(key, value) {
  if (!guard()) return false;
  try {
    const encrypted = electron.safeStorage.encryptString(value);
    db().kvSet(PREFIX + key, encrypted.toString("base64"));
    return true;
  } catch (err) {
    log$P.error(`failed to store secret "${key}"`, err.message);
    return false;
  }
}
function getSecret(key) {
  if (!guard()) return null;
  const stored = db().kvGet(PREFIX + key);
  if (!stored) return null;
  try {
    return electron.safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch (err) {
    log$P.warn(`stored secret "${key}" could not be decrypted; discarding it`);
    db().kvRemove(PREFIX + key);
    return null;
  }
}
function removeSecret(key) {
  db().kvRemove(PREFIX + key);
}
const secretKeys = {
  msRefreshToken: (accountId) => `ms-refresh:${accountId}`,
  minecraftToken: (accountId) => `mc-token:${accountId}`
};
const log$O = createLogger("ms-oauth");
const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const DEVICE_CODE_URL = `${AUTHORITY}/devicecode`;
const TOKEN_URL = `${AUTHORITY}/token`;
const AUTHORIZE_URL = `${AUTHORITY}/authorize`;
const SCOPE = "XboxLive.signin offline_access";
function assertClientId(clientId) {
  if (!clientId || clientId.trim().length < 10) {
    throw new LauncherError("AUTH_NOT_CONFIGURED", "no client id configured");
  }
}
function mapOAuthError(error, description) {
  switch (error) {
    case "authorization_declined":
    case "access_denied":
      return new LauncherError("AUTH_DECLINED", description);
    case "expired_token":
    case "code_expired":
      return new LauncherError("AUTH_TIMEOUT", description);
    case "invalid_client":
    case "unauthorized_client":
      return new LauncherError("AUTH_NOT_CONFIGURED", description, {
        title: "Microsoft rejected this application ID",
        message: "Microsoft did not recognise the Azure application (client) ID, or the app is not set up for public client sign-in.",
        actions: [
          "Check the client ID in Settings → Account for typos",
          'In Azure, open the app → Authentication → enable "Allow public client flows"',
          'Make sure the app supports "Personal Microsoft accounts"'
        ]
      });
    case "invalid_grant":
      return new LauncherError("TOKEN_EXPIRED", description);
    default:
      return new LauncherError("AUTH_FAILED", `${error}: ${description ?? ""}`);
  }
}
async function postForm(url, form, signal) {
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    retries: 1,
    signal
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LauncherError("AUTH_FAILED", `${safeUrl(url)} returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const err = parsed;
    throw mapOAuthError(err.error ?? "unknown", err.error_description);
  }
  return parsed;
}
function toTokens(response) {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    // Renew a minute early so a request never races the expiry.
    expiresAt: Date.now() + Math.max(0, response.expires_in - 60) * 1e3
  };
}
async function deviceCodeFlow(clientId, onPrompt, signal) {
  assertClientId(clientId);
  const response = await request(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString(),
    signal,
    retries: 1
  });
  const text = await response.text();
  if (!response.ok) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LauncherError("AUTH_FAILED", `device code request failed with HTTP ${response.status}`);
    }
    throw mapOAuthError(parsed.error ?? "unknown", parsed.error_description);
  }
  const device = JSON.parse(text);
  const expiresAt = Date.now() + device.expires_in * 1e3;
  onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresAt,
    message: device.message
  });
  let intervalMs = Math.max(1, device.interval || 5) * 1e3;
  for (; ; ) {
    if (signal.aborted) throw new LauncherError("AUTH_DECLINED", "cancelled by user");
    if (Date.now() > expiresAt) throw new LauncherError("AUTH_TIMEOUT", "device code expired");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (signal.aborted) throw new LauncherError("AUTH_DECLINED", "cancelled by user");
    const pollResponse = await request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: device.device_code
      }).toString(),
      signal,
      retries: 0
    });
    const pollText = await pollResponse.text();
    let parsed;
    try {
      parsed = JSON.parse(pollText);
    } catch {
      continue;
    }
    if (pollResponse.ok) {
      log$O.info("device code flow completed");
      return toTokens(parsed);
    }
    const err = parsed;
    if (err.error === "authorization_pending") continue;
    if (err.error === "slow_down") {
      intervalMs += 5e3;
      continue;
    }
    throw mapOAuthError(err.error ?? "unknown", err.error_description);
  }
}
function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const CALLBACK_HTML = (heading2, body, accent) => `<!doctype html>
<html><head><meta charset="utf-8"><title>NexusCraft</title><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0f14;color:#e8eef5;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
  .card{text-align:center;padding:48px 56px;border-radius:20px;background:#121a23;
        border:1px solid #1e2a36;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  h1{margin:0 0 12px;font-size:24px;color:${accent}}
  p{margin:0;color:#93a4b5;font-size:15px}
</style></head>
<body><div class="card"><h1>${heading2}</h1><p>${body}</p></div></body></html>`;
async function openAuthorizeUrl(clientId, redirectUri, challenge, state) {
  const url = `${AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  })}`;
  await electron.shell.openExternal(url);
}
function listenOnLoopback() {
  return new Promise((resolve, reject) => {
    const server2 = node_http.createServer();
    server2.on("error", reject);
    server2.listen(0, "127.0.0.1", () => {
      const address = server2.address();
      if (!address || typeof address === "string") {
        reject(new LauncherError("AUTH_FAILED", "could not bind loopback listener"));
        return;
      }
      resolve({ server: server2, port: address.port });
    });
  });
}
async function refreshTokens(clientId, refreshToken) {
  assertClientId(clientId);
  const response = await postForm(TOKEN_URL, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPE
  });
  return toTokens(response);
}
async function startBrowserRedirectFlow(clientId, signal) {
  assertClientId(clientId);
  const verifier = base64Url(node_crypto.randomBytes(32));
  const challenge = base64Url(node_crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(node_crypto.randomBytes(16));
  const { server: server2, port } = await listenOnLoopback();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const codePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new LauncherError("AUTH_TIMEOUT", "no redirect within 5 minutes")), 3e5);
    const settle = (fn) => {
      clearTimeout(timeout);
      fn();
    };
    signal.addEventListener("abort", () => settle(() => reject(new LauncherError("AUTH_DECLINED", "cancelled"))), {
      once: true
    });
    server2.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const respond = (heading2, body, accent, status2 = 200) => {
        res.writeHead(status2, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CALLBACK_HTML(heading2, body, accent));
      };
      if (url.searchParams.get("state") !== state) {
        respond("Sign-in rejected", "The response did not match this sign-in request.", "#f87171", 400);
        settle(() => reject(new LauncherError("AUTH_FAILED", "state mismatch on redirect")));
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        respond("Sign-in cancelled", "You can close this tab and return to NexusCraft.", "#f87171", 400);
        settle(() => reject(mapOAuthError(error, url.searchParams.get("error_description") ?? void 0)));
        return;
      }
      const authCode = url.searchParams.get("code");
      if (!authCode) {
        respond("Sign-in failed", "No authorization code was returned.", "#f87171", 400);
        settle(() => reject(new LauncherError("AUTH_FAILED", "redirect carried no authorization code")));
        return;
      }
      respond("You are signed in", "You can close this tab and return to NexusCraft.", "#5eead4");
      settle(() => resolve(authCode));
    });
  });
  try {
    await openAuthorizeUrl(clientId, redirectUri, challenge, state);
    const code = await codePromise;
    const tokens = await postForm(
      TOKEN_URL,
      {
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope: SCOPE
      },
      signal
    );
    return toTokens(tokens);
  } finally {
    server2.close();
  }
}
const log$N = createLogger("mc-auth");
const XBL_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const XBOX_PROFILE_URL = "https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,GameDisplayPicRaw";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS_URL = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";
async function errorBody(response) {
  try {
    const text = (await response.text()).trim();
    return text ? text.slice(0, 500) : "(empty body)";
  } catch {
    return "(body could not be read)";
  }
}
async function authenticateWithXboxLive(msAccessToken) {
  const response = await request(XBL_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        // The `d=` prefix marks this as a Microsoft access token rather than a
        // legacy RPS ticket.
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT"
    }),
    retries: 2
  });
  if (!response.ok) {
    throw new LauncherError(
      "AUTH_FAILED",
      `POST user.auth.xboxlive.com/user/authenticate -> HTTP ${response.status}: ${await errorBody(response)}`,
      {
        title: "Xbox Live would not accept the sign-in",
        message: "Microsoft signed you in, but Xbox Live rejected the token. Minecraft: Java Edition authenticates through Xbox Live, so this step has to succeed. This is almost always the Azure app registration rather than your account.",
        actions: [
          `In Azure, confirm the app's "Supported account types" is "Personal Microsoft accounts only"`,
          'Confirm "Allow public client flows" is enabled under Authentication',
          "If you have never used this Microsoft account with Xbox, sign in once at minecraft.net to create the Xbox profile",
          "Open Settings → About → logs folder for the exact response"
        ]
      }
    );
  }
  const data = await response.json();
  const userHash = data.DisplayClaims?.xui?.[0]?.uhs;
  if (!data.Token || !userHash) {
    throw new LauncherError("AUTH_FAILED", "Xbox Live response was missing the user hash");
  }
  return { token: data.Token, userHash };
}
async function authorizeXsts(xblToken, relyingParty) {
  const response = await request(XSTS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
      RelyingParty: relyingParty,
      TokenType: "JWT"
    }),
    retries: 2
  });
  if (response.status === 401) {
    const raw = await response.text().catch(() => "");
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
    }
    switch (body.XErr) {
      case 2148916233:
        throw new LauncherError("XBOX_NO_ACCOUNT", `XErr ${body.XErr}`);
      case 2148916235:
        throw new LauncherError("XBOX_REGION_BLOCKED", `XErr ${body.XErr}`);
      case 2148916236:
      case 2148916237:
        throw new LauncherError("AUTH_FAILED", `XErr ${body.XErr}`, {
          title: "Adult verification required",
          message: "Xbox Live needs this account to complete adult verification before it can sign in.",
          actions: ["Sign in at account.xbox.com and complete the prompts", "Then try again here"]
        });
      case 2148916238:
        throw new LauncherError("XBOX_CHILD_ACCOUNT", `XErr ${body.XErr}`);
      default:
        throw new LauncherError(
          "AUTH_FAILED",
          `POST xsts.auth.xboxlive.com (${relyingParty}) -> HTTP 401 XErr ${body.XErr ?? "none"}: ${raw.slice(0, 500) || "(empty body)"}`,
          {
            title: "Xbox declined to authorise this account",
            message: "Xbox Live accepted the sign-in but refused to issue the token Minecraft needs. This usually means the Microsoft account has no Xbox profile yet, or Xbox is unavailable in its region.",
            actions: [
              "Sign in once at minecraft.net in a browser to create the Xbox profile",
              "Check the country set on the Microsoft account",
              "Open Settings → About → logs folder for the exact response"
            ]
          }
        );
    }
  }
  if (!response.ok) {
    throw new LauncherError(
      "AUTH_FAILED",
      `POST xsts.auth.xboxlive.com (${relyingParty}) -> HTTP ${response.status}: ${await errorBody(response)}`,
      {
        title: "Xbox authorisation failed",
        message: "Xbox Live returned an unexpected response while authorising this account for Minecraft.",
        actions: ["Try signing in again in a moment", "Open Settings → About → logs folder for the exact response"]
      }
    );
  }
  const data = await response.json();
  const claim = data.DisplayClaims?.xui?.[0];
  if (!data.Token || !claim?.uhs) {
    throw new LauncherError("AUTH_FAILED", "XSTS response was missing the user hash");
  }
  return { token: data.Token, userHash: claim.uhs };
}
async function loginWithXbox(xsts) {
  const response = await request(MC_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${xsts.userHash};${xsts.token}` }),
    retries: 2
  });
  if (response.status === 403) {
    throw new LauncherError(
      "APP_NOT_APPROVED",
      `POST api.minecraftservices.com/authentication/login_with_xbox -> HTTP 403: ${await errorBody(response)}`
    );
  }
  if (!response.ok) {
    throw new LauncherError(
      "AUTH_FAILED",
      `POST api.minecraftservices.com/authentication/login_with_xbox -> HTTP ${response.status}: ${await errorBody(response)}`,
      {
        title: "Minecraft services rejected the sign-in",
        message: "Xbox Live authorised the account, but Mojang's Minecraft service would not issue a session token. This is usually a temporary Mojang outage.",
        actions: [
          "Try again in a few minutes",
          "Check status.mojang.com for a reported outage",
          "Open Settings → About → logs folder for the exact response"
        ]
      }
    );
  }
  const data = await response.json();
  if (!data.access_token) {
    throw new LauncherError("AUTH_FAILED", "Minecraft services returned no access token");
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 86400) - 120) * 1e3
  };
}
async function checkEntitlements(minecraftToken) {
  const response = await request(MC_ENTITLEMENTS_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${minecraftToken}`, Accept: "application/json" },
    retries: 2
  });
  if (response.status === 401) throw new LauncherError("TOKEN_EXPIRED", "entitlement check rejected the token");
  if (!response.ok) throw new LauncherError("NETWORK_ERROR", `entitlement check returned HTTP ${response.status}`);
  const data = await response.json();
  const names = (data.items ?? []).map((item) => item.name ?? "");
  const ownsGame = names.some((n) => n === "product_minecraft" || n === "game_minecraft");
  const gamePass = names.some((n) => n.includes("game_pass") || n === "product_game_pass_ultimate" || n === "product_game_pass_pc");
  if (ownsGame) return { owns: true, source: "purchase" };
  if (gamePass) return { owns: true, source: "game_pass" };
  return { owns: names.length > 0, source: names.length > 0 ? "unknown" : "none" };
}
async function fetchMinecraftProfile(minecraftToken) {
  const response = await request(MC_PROFILE_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${minecraftToken}`, Accept: "application/json" },
    retries: 2
  });
  if (response.status === 404) throw new LauncherError("NO_MINECRAFT_PROFILE", "profile endpoint returned 404");
  if (response.status === 401) throw new LauncherError("TOKEN_EXPIRED", "profile request rejected the token");
  if (!response.ok) throw new LauncherError("NETWORK_ERROR", `profile request returned HTTP ${response.status}`);
  const data = await response.json();
  const activeSkin = data.skins?.find((s) => s.state === "ACTIVE") ?? data.skins?.[0];
  const capes = [];
  for (const cape of data.capes ?? []) {
    capes.push({
      id: cape.id,
      name: cape.alias ?? "Cape",
      state: cape.state === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      imageDataUrl: await fetchImageAsDataUrl(cape.url)
    });
  }
  return {
    id: data.id,
    name: data.name,
    skinUrl: activeSkin?.url ?? null,
    skinVariant: activeSkin?.variant?.toUpperCase() === "SLIM" ? "slim" : "classic",
    capes
  };
}
async function fetchXboxProfile(xblToken) {
  try {
    const xsts = await authorizeXsts(xblToken, "http://xboxlive.com");
    const data = await getJson(XBOX_PROFILE_URL, {
      headers: {
        Authorization: `XBL3.0 x=${xsts.userHash};${xsts.token}`,
        "x-xbl-contract-version": "3",
        Accept: "application/json"
      },
      retries: 1
    });
    const user = data.profileUsers?.[0];
    const settings = new Map((user?.settings ?? []).map((s) => [s.id, s.value]));
    return {
      gamertag: settings.get("Gamertag") ?? null,
      avatarUrl: settings.get("GameDisplayPicRaw") ?? null,
      xuid: user?.id ?? null
    };
  } catch (err) {
    log$N.warn("could not read the Xbox profile:", err.message);
    return { gamertag: null, avatarUrl: null, xuid: null };
  }
}
async function completeMinecraftAuth(msAccessToken, onStage) {
  onStage("xbox-live", "Signing in to Xbox Live");
  const xbl = await authenticateWithXboxLive(msAccessToken);
  onStage("xsts", "Authorising with Xbox");
  const xsts = await authorizeXsts(xbl.token, "rp://api.minecraftservices.com/");
  onStage("minecraft", "Signing in to Minecraft services");
  const minecraft = await loginWithXbox(xsts);
  onStage("entitlements", "Checking your Minecraft licence");
  const entitlement = await checkEntitlements(minecraft.accessToken);
  if (!entitlement.owns) {
    throw new LauncherError("NO_MINECRAFT_ENTITLEMENT", "entitlement API reported no Java Edition access");
  }
  onStage("profile", "Loading your profile");
  const profile = await fetchMinecraftProfile(minecraft.accessToken);
  const xbox = await fetchXboxProfile(xbl.token);
  return { minecraft, profile, xbox, entitlement, xuid: xbox.xuid };
}
const log$M = createLogger("accounts");
const liveTokens = /* @__PURE__ */ new Map();
let currentFlow = null;
let inFlight$3 = null;
let lastPrompt = null;
function progress(stage, message) {
  emit("auth:progress", { stage, message });
}
function listAccounts() {
  return db().all(Collections.accounts).sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.addedAt - b.addedAt);
}
function getActiveAccount() {
  return listAccounts().find((a) => a.isActive) ?? null;
}
function broadcastAccounts() {
  emit("auth:accounts-changed", listAccounts());
}
function saveAccount(account) {
  db().put(Collections.accounts, account.id, account);
}
async function beginSignIn() {
  if (inFlight$3) {
    if (lastPrompt && lastPrompt.expiresAt > Date.now()) {
      emit("auth:device-code", lastPrompt);
      progress("polling", "Waiting for you to finish signing in");
    }
    return inFlight$3;
  }
  const settings = getSettings();
  if (!settings.clientId) {
    progress("error", "Microsoft sign-in is not configured");
    throw new LauncherError("AUTH_NOT_CONFIGURED", "client id is empty");
  }
  const controller = new AbortController();
  currentFlow = controller;
  const run2 = (async () => {
    try {
      progress("awaiting-user", "Waiting for you to approve the sign-in");
      let tokens;
      if (settings.authFlow === "browser-redirect") {
        tokens = await startBrowserRedirectFlow(settings.clientId, controller.signal);
      } else {
        tokens = await deviceCodeFlow(
          settings.clientId,
          (prompt) => {
            lastPrompt = prompt;
            emit("auth:device-code", prompt);
            progress("polling", "Waiting for you to finish signing in");
          },
          controller.signal
        );
      }
      const account = await finalise(tokens);
      progress("done", `Signed in as ${account.username}`);
      return account;
    } catch (err) {
      const cancelled = err instanceof LauncherError && (err.code === "CANCELLED" || err.code === "AUTH_DECLINED");
      progress(cancelled ? "idle" : "error", cancelled ? "" : err instanceof LauncherError ? err.message : "Sign-in failed");
      throw err;
    } finally {
      if (currentFlow === controller) currentFlow = null;
      lastPrompt = null;
    }
  })();
  inFlight$3 = run2;
  try {
    return await run2;
  } finally {
    if (inFlight$3 === run2) inFlight$3 = null;
  }
}
function cancelSignIn() {
  currentFlow?.abort();
  currentFlow = null;
  inFlight$3 = null;
  lastPrompt = null;
  progress("idle", "Sign-in cancelled");
}
async function finalise(tokens) {
  const result = await completeMinecraftAuth(tokens.accessToken, (stage, message) => progress(stage, message));
  const existing = db().get(Collections.accounts, result.profile.id);
  const skinDataUrl = result.profile.skinUrl ? await fetchImageAsDataUrl(result.profile.skinUrl) : null;
  const avatarDataUrl = result.xbox.avatarUrl ? await fetchImageAsDataUrl(result.xbox.avatarUrl) : null;
  const account = {
    id: result.profile.id,
    username: result.profile.name,
    gamertag: result.xbox.gamertag,
    xuid: result.xuid,
    ownsMinecraft: result.entitlement.owns,
    entitlementSource: result.entitlement.source,
    avatarDataUrl,
    skinDataUrl,
    skinVariant: result.profile.skinVariant,
    capes: result.profile.capes,
    expiresAt: result.minecraft.expiresAt,
    isActive: true,
    addedAt: existing?.addedAt ?? Date.now()
  };
  for (const other of listAccounts()) {
    if (other.id !== account.id && other.isActive) saveAccount({ ...other, isActive: false });
  }
  saveAccount(account);
  liveTokens.set(account.id, { accessToken: result.minecraft.accessToken, expiresAt: result.minecraft.expiresAt });
  if (tokens.refreshToken) {
    const stored = setSecret(secretKeys.msRefreshToken(account.id), tokens.refreshToken);
    if (!stored) {
      log$M.warn("refresh token was not persisted; this account will need to sign in again next session");
    }
  }
  log$M.info(`signed in as ${account.username} (entitlement: ${account.entitlementSource})`);
  broadcastAccounts();
  return account;
}
async function getValidMinecraftToken(accountId) {
  const cached2 = liveTokens.get(accountId);
  if (cached2 && cached2.expiresAt > Date.now()) return cached2.accessToken;
  const refreshToken = getSecret(secretKeys.msRefreshToken(accountId));
  if (!refreshToken) {
    throw new LauncherError(
      "TOKEN_EXPIRED",
      isEncryptionAvailable() ? "no stored refresh token" : "secure storage unavailable on this system"
    );
  }
  const settings = getSettings();
  log$M.info(`renewing session for account ${accountId.slice(0, 8)}…`);
  let tokens;
  try {
    tokens = await refreshTokens(settings.clientId, refreshToken);
  } catch (err) {
    if (err instanceof LauncherError && err.code === "TOKEN_EXPIRED") {
      removeSecret(secretKeys.msRefreshToken(accountId));
    }
    throw err;
  }
  const result = await completeMinecraftAuth(tokens.accessToken, () => void 0);
  if (tokens.refreshToken) setSecret(secretKeys.msRefreshToken(accountId), tokens.refreshToken);
  liveTokens.set(accountId, { accessToken: result.minecraft.accessToken, expiresAt: result.minecraft.expiresAt });
  const existing = db().get(Collections.accounts, accountId);
  if (existing) {
    saveAccount({
      ...existing,
      username: result.profile.name,
      gamertag: result.xbox.gamertag ?? existing.gamertag,
      xuid: result.xuid ?? existing.xuid,
      ownsMinecraft: result.entitlement.owns,
      entitlementSource: result.entitlement.source,
      skinDataUrl: result.profile.skinUrl ? await fetchImageAsDataUrl(result.profile.skinUrl) : existing.skinDataUrl,
      skinVariant: result.profile.skinVariant,
      capes: result.profile.capes,
      expiresAt: result.minecraft.expiresAt
    });
    broadcastAccounts();
  }
  return result.minecraft.accessToken;
}
async function refreshAccount(accountId) {
  await getValidMinecraftToken(accountId);
  const account = db().get(Collections.accounts, accountId);
  if (!account) throw new LauncherError("NOT_FOUND", "account no longer exists");
  return account;
}
function setActiveAccount(accountId) {
  const target = db().get(Collections.accounts, accountId);
  if (!target) throw new LauncherError("NOT_FOUND", "account no longer exists");
  for (const account of listAccounts()) {
    const shouldBeActive = account.id === accountId;
    if (account.isActive !== shouldBeActive) saveAccount({ ...account, isActive: shouldBeActive });
  }
  broadcastAccounts();
  return { ...target, isActive: true };
}
function logout(accountId) {
  const wasActive = db().get(Collections.accounts, accountId)?.isActive ?? false;
  removeSecret(secretKeys.msRefreshToken(accountId));
  removeSecret(secretKeys.minecraftToken(accountId));
  liveTokens.delete(accountId);
  db().remove(Collections.accounts, accountId);
  if (wasActive) {
    const remaining = listAccounts();
    if (remaining.length > 0) saveAccount({ ...remaining[0], isActive: true });
  }
  log$M.info(`signed out account ${accountId.slice(0, 8)}…`);
  broadcastAccounts();
}
async function restoreSession() {
  const active = getActiveAccount();
  if (!active) return;
  try {
    await getValidMinecraftToken(active.id);
    log$M.info("restored the previous session");
  } catch (err) {
    log$M.info("could not restore the previous session:", err.message);
  }
}
const id = zod.z.string().min(1).max(128);
const path = zod.z.string().min(1).max(4096);
const modpackName = zod.z.string().max(256).optional();
const safeSegment = zod.z.string().min(1).max(255).refine((v) => !v.includes("/") && !v.includes("\\") && v !== "." && v !== "..", {
  message: "must be a single path segment"
});
const loaderId = zod.z.enum(["vanilla", "fabric", "forge", "neoforge", "quilt"]);
const IpcRequestSchemas = {
  /* ---------------------------------------------------------------- system */
  "app:info": zod.z.void(),
  "app:openExternal": zod.z.object({ url: zod.z.string().url() }),
  "app:openPath": zod.z.object({ path }),
  "app:pickDirectory": zod.z.object({ title: zod.z.string().optional() }).optional(),
  "app:pickFiles": zod.z.object({
    title: zod.z.string().optional(),
    extensions: zod.z.array(zod.z.string()).optional(),
    multi: zod.z.boolean().optional()
  }).optional(),
  "app:pickSavePath": zod.z.object({
    title: zod.z.string().max(120).optional(),
    defaultName: zod.z.string().max(255).optional(),
    extensions: zod.z.array(zod.z.string().max(16)).max(8).optional()
  }),
  "app:window": zod.z.object({ action: zod.z.enum(["minimize", "maximize", "close"]) }),
  "app:systemMemory": zod.z.void(),
  "app:diagnostics": zod.z.object({
    outputPath: path,
    instanceId: id.optional(),
    note: zod.z.string().max(500).optional()
  }),
  /** Renderer-side crash reporting, so a UI failure reaches the log file. */
  "app:reportError": zod.z.object({
    source: zod.z.string().max(64),
    message: zod.z.string().max(2e3),
    stack: zod.z.string().max(8e3).optional(),
    componentStack: zod.z.string().max(8e3).optional()
  }),
  /* -------------------------------------------------------------- settings */
  "settings:get": zod.z.void(),
  "settings:update": zod.z.record(zod.z.string(), zod.z.unknown()),
  /* ------------------------------------------------------------------ auth */
  "auth:begin": zod.z.void(),
  "auth:cancel": zod.z.void(),
  "auth:list": zod.z.void(),
  "auth:setActive": zod.z.object({ accountId: id }),
  "auth:logout": zod.z.object({ accountId: id }),
  "auth:refresh": zod.z.object({ accountId: id }),
  /* ------------------------------------------------------------- versions */
  "versions:manifest": zod.z.object({ refresh: zod.z.boolean().optional() }).optional(),
  "versions:installed": zod.z.void(),
  "versions:loaderVersions": zod.z.object({ loader: loaderId, minecraftVersion: zod.z.string().min(1) }),
  "versions:delete": zod.z.object({ versionId: safeSegment }),
  /* ------------------------------------------------------------ instances */
  "instances:list": zod.z.void(),
  "instances:create": zod.z.object({
    name: zod.z.string().min(1).max(64),
    minecraftVersion: zod.z.string().min(1).max(64),
    loader: loaderId,
    loaderVersion: zod.z.string().max(64).nullable().optional(),
    maxRamMb: zod.z.number().int().min(512).max(65536).optional(),
    iconColor: zod.z.string().max(32).optional()
  }),
  "instances:update": zod.z.object({ id, patch: zod.z.record(zod.z.string(), zod.z.unknown()) }),
  "instances:delete": zod.z.object({ id, deleteFiles: zod.z.boolean() }),
  "instances:duplicate": zod.z.object({ id, name: zod.z.string().min(1).max(64) }),
  "instances:stats": zod.z.object({ id }),
  "instances:openFolder": zod.z.object({ id, sub: zod.z.string().max(64).optional() }),
  "instances:install": zod.z.object({ id }),
  "instances:repair": zod.z.object({ id }),
  "instances:export": zod.z.object({
    id,
    outputPath: path,
    includeWorlds: zod.z.boolean(),
    includeScreenshots: zod.z.boolean()
  }),
  "instances:inspectArchive": zod.z.object({ filePath: path }),
  "instances:import": zod.z.object({ filePath: path, name: modpackName }),
  "instances:findForeign": zod.z.void(),
  "instances:importForeign": zod.z.object({ id: zod.z.string().min(1).max(256), name: modpackName }),
  "instances:snapshots": zod.z.object({ id }),
  "instances:snapshot": zod.z.object({ id, name: zod.z.string().min(1).max(60), note: zod.z.string().max(300).optional() }),
  "instances:restoreSnapshot": zod.z.object({ id, snapshotId: id }),
  "instances:deleteSnapshot": zod.z.object({ id, snapshotId: id }),
  "instances:diffSnapshot": zod.z.object({ id, snapshotId: id }),
  "instances:exportPack": zod.z.object({
    id,
    outputPath: path,
    name: zod.z.string().max(120).optional(),
    version: zod.z.string().max(32).optional(),
    summary: zod.z.string().max(400).optional(),
    includeConfigs: zod.z.boolean().optional(),
    includeWorlds: zod.z.boolean().optional()
  }),
  /* --------------------------------------------------------------- launch */
  "launch:start": zod.z.object({ instanceId: id, serverAddress: zod.z.string().max(255).optional() }),
  "launch:stop": zod.z.object({ instanceId: id }),
  "launch:state": zod.z.void(),
  "launch:logs": zod.z.object({ instanceId: id, limit: zod.z.number().int().min(1).max(5e3).optional() }),
  "launch:autopsy": zod.z.object({ instanceId: id }),
  "launch:autopsyAvailable": zod.z.void(),
  "launch:applyFix": zod.z.object({
    instanceId: id,
    fix: zod.z.object({
      kind: zod.z.enum(["disable-mod", "update-mod", "more-memory", "less-memory", "repair", "manual"]),
      label: zod.z.string().max(80),
      detail: zod.z.string().max(300),
      modFileName: safeSegment.nullable()
    })
  }),
  /* ------------------------------------------------------------ downloads */
  "downloads:state": zod.z.void(),
  "downloads:pause": zod.z.object({ taskId: id }),
  "downloads:resume": zod.z.object({ taskId: id }),
  "downloads:cancel": zod.z.object({ taskId: id }),
  "downloads:retry": zod.z.object({ taskId: id }),
  /* ----------------------------------------------------------------- java */
  "java:list": zod.z.object({ refresh: zod.z.boolean().optional() }).optional(),
  "java:test": zod.z.object({ path }),
  "java:installRuntime": zod.z.object({ majorVersion: zod.z.number().int().min(8).max(64) }),
  "java:recommend": zod.z.object({ minecraftVersion: zod.z.string().min(1) }),
  /* ----------------------------------------------------------------- mods */
  "mods:list": zod.z.object({ instanceId: id }),
  "mods:setEnabled": zod.z.object({ instanceId: id, fileName: safeSegment, enabled: zod.z.boolean() }),
  "mods:delete": zod.z.object({ instanceId: id, fileName: safeSegment }),
  "mods:import": zod.z.object({ instanceId: id, files: zod.z.array(path).min(1).max(200) }),
  "mods:openFolder": zod.z.object({ instanceId: id }),
  /* -------------------------------------------------- resource packs/shaders */
  "content:list": zod.z.object({ instanceId: id, kind: zod.z.enum(["resourcepacks", "shaderpacks"]) }),
  "content:import": zod.z.object({
    instanceId: id,
    kind: zod.z.enum(["resourcepacks", "shaderpacks"]),
    files: zod.z.array(path).min(1).max(200)
  }),
  "content:setEnabled": zod.z.object({
    instanceId: id,
    kind: zod.z.enum(["resourcepacks", "shaderpacks"]),
    fileName: safeSegment,
    enabled: zod.z.boolean()
  }),
  "content:delete": zod.z.object({
    instanceId: id,
    kind: zod.z.enum(["resourcepacks", "shaderpacks"]),
    fileName: safeSegment
  }),
  "content:openFolder": zod.z.object({
    instanceId: id,
    kind: zod.z.enum(["resourcepacks", "shaderpacks", "screenshots"])
  }),
  "content:screenshots": zod.z.object({ instanceId: id }),
  /* ------------------------------------------------- modrinth browser */
  "modrinth:search": zod.z.object({
    query: zod.z.string().max(120),
    kind: zod.z.enum(["mod", "resourcepack", "shader", "modpack"]),
    gameVersion: zod.z.string().max(64).nullable().optional(),
    loader: zod.z.string().max(32).nullable().optional(),
    offset: zod.z.number().int().min(0).max(5e3).optional(),
    limit: zod.z.number().int().min(1).max(50).optional(),
    instanceId: id.nullable().optional()
  }),
  "modrinth:versions": zod.z.object({
    projectId: zod.z.string().min(1).max(64),
    kind: zod.z.enum(["mod", "resourcepack", "shader", "modpack"]),
    gameVersion: zod.z.string().max(64).nullable().optional(),
    loader: zod.z.string().max(32).nullable().optional()
  }),
  "modrinth:install": zod.z.object({
    instanceId: id,
    versionId: zod.z.string().min(1).max(64),
    kind: zod.z.enum(["mod", "resourcepack", "shader", "modpack"])
  }),
  "modrinth:project": zod.z.object({ projectId: zod.z.string().min(1).max(64) }),
  "modpack:inspect": zod.z.object({ filePath: path }),
  "modpack:installFile": zod.z.object({ filePath: path, name: modpackName }),
  "modpack:installModrinth": zod.z.object({ versionId: zod.z.string().min(1).max(64), name: modpackName }),
  /*
   * Hosting a pack rather than playing it. The options mirror what a new server
   * needs and are all optional: left out, the pack's own name is used, the port
   * is the first one free, and the memory is a modded-server default.
   */
  "modpack:serverFromFile": zod.z.object({
    filePath: path,
    name: modpackName,
    port: zod.z.number().int().min(1024).max(65535).optional(),
    memoryMb: zod.z.number().int().min(512).max(65536).optional()
  }),
  "modpack:serverFromModrinth": zod.z.object({
    versionId: zod.z.string().min(1).max(64),
    name: modpackName,
    port: zod.z.number().int().min(1024).max(65535).optional(),
    memoryMb: zod.z.number().int().min(512).max(65536).optional()
  }),
  "modpack:serverFromCurseForge": zod.z.object({
    projectId: zod.z.string().min(1).max(32),
    fileId: zod.z.string().min(1).max(32),
    name: modpackName,
    port: zod.z.number().int().min(1024).max(65535).optional(),
    memoryMb: zod.z.number().int().min(512).max(65536).optional()
  }),
  "modpack:installCurseForge": zod.z.object({
    projectId: zod.z.string().min(1).max(32),
    fileId: zod.z.string().min(1).max(32),
    name: modpackName
  }),
  "mods:checkUpdates": zod.z.object({ instanceId: id }),
  "mods:applyUpdate": zod.z.object({ instanceId: id, update: zod.z.record(zod.z.string(), zod.z.unknown()) }),
  "mods:changelog": zod.z.object({ instanceId: id, update: zod.z.record(zod.z.string(), zod.z.unknown()) }),
  "mods:autoUpdateSettings": zod.z.object({}),
  "mods:setAutoUpdateSettings": zod.z.object({
    patch: zod.z.object({
      mode: zod.z.enum(["off", "notify", "install"]).optional(),
      everyHours: zod.z.number().int().min(1).max(168).optional(),
      reviewRisky: zod.z.boolean().optional()
    })
  }),
  "mods:checkAllNow": zod.z.object({}),
  "mods:bundledStatus": zod.z.object({ instanceId: id }),
  "voice:status": zod.z.void(),
  /* Downloading the model is the slow part, so it is asked for explicitly. */
  "voice:prepare": zod.z.object({ build: zod.z.enum(["q4", "q8"]).optional() }),
  "voice:speak": zod.z.object({
    text: zod.z.string().min(1).max(400),
    voice: zod.z.string().max(40).optional(),
    build: zod.z.enum(["q4", "q8"]).optional()
  }),
  "voice:serveToGame": zod.z.object({ on: zod.z.boolean() }),
  "mods:installBundled": zod.z.object({ instanceId: id, modId: zod.z.string().min(1).max(64) }),
  "mods:rollbacks": zod.z.object({ instanceId: id }),
  "mods:rollback": zod.z.object({ instanceId: id, fileName: safeSegment }),
  "curseforge:verify": zod.z.object({ key: zod.z.string().optional() }).optional(),
  "curseforge:status": zod.z.void(),
  "datapacks:list": zod.z.void(),
  "datapacks:preview": zod.z.object({
    instanceId: id,
    packId: zod.z.string().min(1).max(64),
    options: zod.z.record(zod.z.string(), zod.z.union([zod.z.string(), zod.z.number(), zod.z.boolean()]))
  }),
  "datapacks:install": zod.z.object({
    instanceId: id,
    worldFolder: safeSegment,
    packId: zod.z.string().min(1).max(64),
    options: zod.z.record(zod.z.string(), zod.z.union([zod.z.string(), zod.z.number(), zod.z.boolean()]))
  }),
  "datapacks:installed": zod.z.object({ instanceId: id, worldFolder: safeSegment }),
  "datapacks:remove": zod.z.object({ instanceId: id, worldFolder: safeSegment, fileName: safeSegment }),
  /* ---------------------------------------------------------- companion */
  "companion:toolSizes": zod.z.object({}),
  "companion:setMicrophone": zod.z.object({ wanted: zod.z.boolean() }),
  "companion:routines": zod.z.undefined(),
  "companion:list": zod.z.void(),
  "companion:create": zod.z.object({ name: zod.z.string().max(16).optional() }),
  "companion:delete": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:settings": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:updateSettings": zod.z.object({ id: zod.z.string().min(1), patch: zod.z.record(zod.z.string(), zod.z.unknown()) }),
  "companion:start": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:stop": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:instruct": zod.z.object({ id: zod.z.string().min(1), text: zod.z.string().min(1).max(500) }),
  "companion:state": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:states": zod.z.void(),
  "companion:clearMemory": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:camera": zod.z.object({ id: zod.z.string().min(1), on: zod.z.boolean() }),
  "companion:interrupt": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:usage": zod.z.void(),
  "companion:resetUsage": zod.z.object({ id: zod.z.string().min(1).optional() }).optional(),
  "companion:builds": zod.z.void(),
  "companion:undoBuild": zod.z.object({
    buildId: zod.z.string().min(1).max(64),
    companionId: zod.z.string().min(1).optional()
  }),
  "companion:blueprints": zod.z.void(),
  "companion:importSchematic": zod.z.object({ filePath: path }),
  "companion:build": zod.z.object({ id: zod.z.string().min(1), blueprintId: zod.z.string().min(1).max(128) }),
  "blueprints:export": zod.z.object({
    blueprintId: zod.z.string().min(1).max(128),
    /** Where it goes: a client instance, or a hosted server's world. */
    instanceId: id.optional(),
    serverId: id.optional(),
    format: zod.z.enum(["schem", "nbt"])
  }),
  "blueprints:setupLitematica": zod.z.object({ instanceId: id }),
  "companion:testModel": zod.z.object({ id: zod.z.string().min(1) }),
  "companion:listModels": zod.z.object({ id: zod.z.string().min(1) }),
  "crew:list": zod.z.void(),
  "crew:create": zod.z.object({
    name: zod.z.string().min(1).max(40),
    foremanId: zod.z.string().min(1),
    memberIds: zod.z.array(zod.z.string().min(1)).max(8)
  }),
  "crew:update": zod.z.object({
    id: zod.z.string().min(1),
    patch: zod.z.object({
      name: zod.z.string().max(40).optional(),
      memberIds: zod.z.array(zod.z.string().min(1)).max(8).optional()
    })
  }),
  "crew:delete": zod.z.object({ id: zod.z.string().min(1) }),
  "crew:start": zod.z.object({ id: zod.z.string().min(1) }),
  "crew:stop": zod.z.object({ id: zod.z.string().min(1) }),
  "crew:notes": zod.z.object({ id: zod.z.string().min(1) }),
  "crew:clearNotes": zod.z.object({ id: zod.z.string().min(1) }),
  "host:installModrinth": zod.z.object({ id: zod.z.string(), versionId: zod.z.string(), kind: zod.z.string() }),
  "host:installCurseForge": zod.z.object({ id: zod.z.string(), projectId: zod.z.string(), fileId: zod.z.string(), kind: zod.z.string() }),
  "host:share": zod.z.object({ id: zod.z.string() }),
  "host:forwardStatus": zod.z.object({ id: zod.z.string() }),
  "host:openPort": zod.z.object({ id: zod.z.string(), acceptUnverified: zod.z.boolean().optional() }),
  "host:closePort": zod.z.object({ id: zod.z.string() }),
  "host:list": zod.z.void(),
  "host:save": zod.z.object({
    id: zod.z.string().nullable(),
    name: zod.z.string().min(1).max(60),
    minecraftVersion: zod.z.string().min(1).max(40),
    software: zod.z.enum(["vanilla", "paper", "purpur", "fabric", "forge", "neoforge"]),
    port: zod.z.number().int().min(1024).max(65535),
    onlineMode: zod.z.boolean(),
    reachability: zod.z.enum(["local", "network", "anyone"]),
    memoryMb: zod.z.number().int().min(512).max(16384),
    motd: zod.z.string().max(59),
    difficulty: zod.z.enum(["peaceful", "easy", "normal", "hard"]),
    gameMode: zod.z.enum(["survival", "creative", "adventure"]),
    maxPlayers: zod.z.number().int().min(1).max(100),
    allowCheats: zod.z.boolean(),
    operators: zod.z.array(zod.z.string().min(1).max(16)).max(20),
    /*
     * The world and gameplay settings.
     *
     * These were missing, and zod strips whatever a schema does not name — so
     * every one of them was silently discarded on the way through. The settings
     * screen showed them, the form sent them, the server-properties writer
     * expected them, and they never arrived: turn on "allow flight", save,
     * reopen, and it is off again. Spawn protection, view distance, PVP,
     * hardcore and the seed all went the same way, which is also why the
     * companions kept being refused near spawn.
     *
     * Optional, because a form that has never shown a field should not be
     * forced to invent a value for it.
     */
    levelSeed: zod.z.string().max(120).optional(),
    pvp: zod.z.boolean().optional(),
    hardcore: zod.z.boolean().optional(),
    allowFlight: zod.z.boolean().optional(),
    spawnProtection: zod.z.number().int().min(0).max(256).optional(),
    viewDistance: zod.z.number().int().min(2).max(32).optional(),
    simulationDistance: zod.z.number().int().min(2).max(32).optional(),
    spawnMonsters: zod.z.boolean().optional(),
    spawnAnimals: zod.z.boolean().optional(),
    whitelist: zod.z.boolean().optional()
  }),
  "host:delete": zod.z.object({ id: zod.z.string().min(1), deleteWorld: zod.z.boolean() }),
  "host:install": zod.z.object({ id: zod.z.string().min(1) }),
  "host:acceptEula": zod.z.object({ id: zod.z.string().min(1) }),
  "host:start": zod.z.object({ id: zod.z.string().min(1) }),
  "host:stop": zod.z.object({ id: zod.z.string().min(1) }),
  "host:command": zod.z.object({ id: zod.z.string().min(1), command: zod.z.string().min(1).max(256) }),
  "host:states": zod.z.void(),
  "host:console": zod.z.object({ id: zod.z.string().min(1) }),
  "host:eulaUrl": zod.z.void(),
  "host:software": zod.z.void(),
  "host:mods": zod.z.object({ id: zod.z.string().min(1) }),
  "host:importMods": zod.z.object({ id: zod.z.string().min(1) }),
  "host:toggleMod": zod.z.object({ id: zod.z.string().min(1), fileName: zod.z.string().min(1).max(255), enabled: zod.z.boolean() }),
  "host:deleteMod": zod.z.object({ id: zod.z.string().min(1), fileName: zod.z.string().min(1).max(255) }),
  "host:installMod": zod.z.object({ id: zod.z.string().min(1), versionId: zod.z.string().min(1).max(64) }),
  "host:joinTargets": zod.z.object({ id: zod.z.string().min(1) }),
  "host:join": zod.z.object({ id: zod.z.string().min(1), instanceId: zod.z.string().min(1).optional() }),
  "host:openFolder": zod.z.object({ id: zod.z.string().min(1) }),
  "host:syncMods": zod.z.object({ id: zod.z.string().min(1), instanceId: zod.z.string().min(1) }),
  "host:deploySteward": zod.z.object({ id: zod.z.string().min(1), companionId: zod.z.string().min(1).optional() }),
  "host:dismissSteward": zod.z.object({ companionId: zod.z.string().min(1) }),
  "host:stewards": zod.z.object({ id: zod.z.string().min(1) }),
  "host:backup": zod.z.object({ id: zod.z.string().min(1) }),
  "host:backups": zod.z.object({ id: zod.z.string().min(1) }),
  "host:restoreBackup": zod.z.object({ id: zod.z.string().min(1), fileName: safeSegment }),
  "host:deleteBackup": zod.z.object({ id: zod.z.string().min(1), fileName: safeSegment }),
  "host:restartSettings": zod.z.object({ id: zod.z.string().min(1) }),
  "host:setRestartSettings": zod.z.object({
    id: zod.z.string().min(1),
    patch: zod.z.object({
      enabled: zod.z.boolean().optional(),
      intervalHours: zod.z.number().int().min(1).max(168).optional(),
      warnMinutes: zod.z.number().int().min(0).max(30).optional(),
      skipIfPlayers: zod.z.boolean().optional()
    })
  }),
  "host:backupSettings": zod.z.object({ id: zod.z.string().min(1) }),
  "host:inviteLink": zod.z.object({ id: zod.z.string().min(1) }),
  "host:tunnelSettings": zod.z.object({ id: zod.z.string().min(1) }),
  "host:setTunnelSettings": zod.z.object({
    id: zod.z.string().min(1),
    patch: zod.z.object({
      agentPath: path.optional(),
      provider: zod.z.enum(["playit", "custom"]).optional(),
      args: zod.z.string().max(500).optional()
    })
  }),
  "host:startTunnel": zod.z.object({ id: zod.z.string().min(1) }),
  "host:stopTunnel": zod.z.object({ id: zod.z.string().min(1) }),
  "host:tunnelState": zod.z.object({ id: zod.z.string().min(1) }),
  "links:pendingInvite": zod.z.void(),
  "links:acceptInvite": zod.z.object({
    host: zod.z.string().min(1).max(255),
    port: zod.z.number().int().min(1).max(65535),
    name: zod.z.string().max(64).nullable().optional(),
    minecraftVersion: zod.z.string().max(32).nullable().optional(),
    loader: zod.z.string().max(16).nullable().optional(),
    packVersionId: zod.z.string().max(64).nullable().optional(),
    instanceId: id.nullable().optional()
  }),
  "host:setBackupSettings": zod.z.object({
    id: zod.z.string().min(1),
    patch: zod.z.object({
      enabled: zod.z.boolean().optional(),
      intervalMinutes: zod.z.number().int().min(5).max(1440).optional(),
      keep: zod.z.number().int().min(1).max(50).optional(),
      onStop: zod.z.boolean().optional()
    })
  }),
  "datapacks:export": zod.z.object({
    instanceId: id,
    packId: zod.z.string().min(1).max(64),
    options: zod.z.record(zod.z.string(), zod.z.union([zod.z.string(), zod.z.number(), zod.z.boolean()])),
    outputPath: path
  }),
  "curseforge:search": zod.z.object({
    query: zod.z.string().max(120),
    kind: zod.z.enum(["mod", "resourcepack", "shader", "modpack"]),
    gameVersion: zod.z.string().max(64).nullable().optional(),
    loader: zod.z.string().max(32).nullable().optional(),
    offset: zod.z.number().int().min(0).max(5e3).optional(),
    limit: zod.z.number().int().min(1).max(50).optional(),
    instanceId: id.nullable().optional()
  }),
  "curseforge:files": zod.z.object({
    projectId: zod.z.string().min(1).max(32),
    kind: zod.z.enum(["mod", "resourcepack", "shader", "modpack"]),
    gameVersion: zod.z.string().max(64).nullable().optional(),
    loader: zod.z.string().max(32).nullable().optional()
  }),
  "curseforge:install": zod.z.object({
    instanceId: id,
    projectId: zod.z.string().min(1).max(32),
    fileId: zod.z.string().min(1).max(32),
    kind: zod.z.enum(["mod", "resourcepack", "shader", "modpack"])
  }),
  /* --------------------------------------------------------------- worlds */
  "worlds:list": zod.z.object({ instanceId: id }),
  "worlds:openFolder": zod.z.object({ instanceId: id, folderName: safeSegment.optional() }),
  "worlds:backup": zod.z.object({ instanceId: id, folderName: safeSegment }),
  "worlds:map": zod.z.object({ instanceId: id, folderName: safeSegment }),
  "worlds:listBackups": zod.z.object({ instanceId: id }),
  "worlds:deleteBackup": zod.z.object({ instanceId: id, fileName: safeSegment }),
  "worlds:restore": zod.z.object({ instanceId: id, fileName: safeSegment }),
  "worlds:import": zod.z.object({ instanceId: id, filePath: path }),
  "worlds:delete": zod.z.object({ instanceId: id, folderName: safeSegment }),
  /* --------------------------------------------------- public directory */
  "directory:list": zod.z.void(),
  "directory:refresh": zod.z.object({ force: zod.z.boolean().optional() }).optional(),
  "directory:ping": zod.z.object({ id: zod.z.string().min(1).max(64) }),
  /* A typed-in address, parsed and bounds-checked in the service. */
  "directory:lookup": zod.z.object({ address: zod.z.string().min(1).max(300) }),
  "directory:add": zod.z.object({
    name: zod.z.string().min(1).max(64),
    address: zod.z.string().min(1).max(255),
    port: zod.z.number().int().min(1).max(65535)
  }),
  "directory:compatibility": zod.z.void(),
  "directory:joinTargets": zod.z.object({
    address: zod.z.string().min(1).max(255),
    port: zod.z.number().int().min(1).max(65535)
  }),
  "directory:join": zod.z.object({
    address: zod.z.string().min(1).max(255),
    port: zod.z.number().int().min(1).max(65535),
    instanceId: id.optional()
  }),
  /* -------------------------------------------------------------- servers */
  "servers:list": zod.z.void(),
  "servers:save": zod.z.object({
    id: id.nullable(),
    name: zod.z.string().min(1).max(64),
    address: zod.z.string().min(1).max(255),
    port: zod.z.number().int().min(1).max(65535),
    notedVersion: zod.z.string().max(64).nullable().optional(),
    description: zod.z.string().max(512).nullable().optional(),
    favorite: zod.z.boolean().optional(),
    preferredInstanceId: id.nullable().optional()
  }),
  "servers:delete": zod.z.object({ id }),
  "servers:favorite": zod.z.object({ id, favorite: zod.z.boolean() }),
  "servers:ping": zod.z.object({ id }),
  "servers:pingAll": zod.z.void(),
  "servers:import": zod.z.object({ instanceId: id }),
  /* ---------------------------------------------------------------- skins */
  "skins:list": zod.z.void(),
  "skins:import": zod.z.object({
    filePath: path,
    name: zod.z.string().min(1).max(64),
    variant: zod.z.enum(["classic", "slim"])
  }),
  "skins:delete": zod.z.object({ id }),
  "skins:favorite": zod.z.object({ id, favorite: zod.z.boolean() }),
  "skins:apply": zod.z.object({ id }),
  "skins:resetToCurrent": zod.z.void()
};
const log$L = createLogger("ipc");
const registered = /* @__PURE__ */ new Set();
const trusted = /* @__PURE__ */ new WeakSet();
function trustWebContents(contents) {
  trusted.add(contents);
}
function handle(channel, handler) {
  const schema = IpcRequestSchemas[channel];
  if (!schema) throw new Error(`refusing to register unknown IPC channel "${channel}"`);
  if (registered.has(channel)) throw new Error(`IPC channel "${channel}" is already registered`);
  registered.add(channel);
  electron.ipcMain.handle(channel, async (event, rawPayload) => {
    if (!trusted.has(event.sender)) {
      log$L.warn(`rejected an IPC call to "${channel}" from an untrusted frame`);
      return { ok: false, error: toErrorPayload(new Error("untrusted sender")) };
    }
    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      log$L.warn(`rejected "${channel}": ${issues}`);
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          title: "That request was not valid",
          message: "The launcher sent a request the main process could not accept. This is a bug.",
          actions: ["Try the action again", "Restart NexusCraft if it keeps happening"],
          detail: issues.slice(0, 500)
        }
      };
    }
    try {
      const data = await handler(parsed.data, event);
      return { ok: true, data: data ?? null };
    } catch (err) {
      const payload = toErrorPayload(err);
      log$L.error(
        `"${channel}" failed [${payload.code}] ${payload.title}` + (payload.detail ? `
  detail: ${payload.detail}` : "") + (err instanceof Error && err.stack ? `
  at: ${err.stack.split("\n").slice(1, 4).join(" | ").trim()}` : "")
      );
      return { ok: false, error: payload };
    }
  });
}
function assertAllChannelsHandled() {
  const missing = Object.keys(IpcRequestSchemas).filter((channel) => !registered.has(channel));
  if (missing.length > 0) {
    log$L.error(`these IPC channels have no handler: ${missing.join(", ")}`);
  }
}
const log$K = createLogger("instances");
const INSTANCE_SUBDIRS = [
  "mods",
  "resourcepacks",
  "shaderpacks",
  "saves",
  "screenshots",
  "config",
  "crash-reports",
  "logs"
];
function gameDirOf(instance) {
  return instance.gameDir;
}
function instanceSubdir(instance, sub) {
  const target = node_path.join(instance.gameDir, sub);
  assertInside(instance.gameDir, target);
  return ensureDir(target);
}
function listInstances() {
  return db().all(Collections.instances).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || a.createdAt - b.createdAt);
}
function getInstance(id2) {
  const instance = db().get(Collections.instances, id2);
  if (!instance) {
    throw new LauncherError("NOT_FOUND", `instance ${id2} does not exist`, {
      title: "That instance no longer exists",
      message: "The instance you tried to use has been deleted.",
      actions: ["Pick another instance from the Instances screen"]
    });
  }
  return instance;
}
function findInstance(id2) {
  return db().get(Collections.instances, id2);
}
function broadcast$1() {
  emit("instances:changed", listInstances());
}
function saveInstance(instance) {
  db().put(Collections.instances, instance.id, instance);
}
const ACCENTS = ["#5eead4", "#818cf8", "#f472b6", "#fbbf24", "#4ade80", "#60a5fa", "#f87171", "#c084fc"];
async function createInstance(input) {
  const settings = getSettings();
  const ram = recommendedRamMb();
  const id2 = node_crypto.randomUUID();
  const root = instanceDir(id2);
  const gameDir = node_path.join(root, "minecraft");
  await promises.mkdir(gameDir, { recursive: true });
  for (const sub of INSTANCE_SUBDIRS) await promises.mkdir(node_path.join(gameDir, sub), { recursive: true });
  await promises.mkdir(node_path.join(root, "backups"), { recursive: true });
  const maxRam = Math.min(Math.max(input.maxRamMb ?? settings.defaultMaxRamMb, 512), ram.ceiling);
  const instance = {
    id: id2,
    name: input.name.trim().slice(0, 64) || "New instance",
    minecraftVersion: input.minecraftVersion,
    loader: input.loader,
    loaderVersion: input.loaderVersion ?? null,
    // Populated once the loader profile has actually been installed.
    resolvedVersionId: input.loader === "vanilla" ? input.minecraftVersion : null,
    gameDir,
    java: {
      javaPath: null,
      minRamMb: Math.min(settings.defaultMinRamMb, maxRam),
      maxRamMb: maxRam,
      jvmArgs: settings.defaultJvmArgs
    },
    window: { width: 1280, height: 720, fullscreen: false },
    iconColor: input.iconColor ?? ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    notes: "",
    createdAt: Date.now(),
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    installed: false
  };
  saveInstance(instance);
  log$K.info(`created instance "${instance.name}" (${instance.minecraftVersion}, ${instance.loader})`);
  broadcast$1();
  return instance;
}
const EDITABLE_TOP_LEVEL = /* @__PURE__ */ new Set([
  "name",
  "minecraftVersion",
  "loader",
  "loaderVersion",
  "resolvedVersionId",
  "iconColor",
  "notes",
  "installed"
]);
function updateInstance(id2, patch) {
  const current = getInstance(id2);
  const next = { ...current, java: { ...current.java }, window: { ...current.window } };
  const ram = recommendedRamMb();
  for (const [key, value] of Object.entries(patch)) {
    if (EDITABLE_TOP_LEVEL.has(key)) {
      if (key === "name" && typeof value === "string") next.name = value.trim().slice(0, 64) || current.name;
      else if (key === "loader" && typeof value === "string") {
        const loader = value;
        if (["vanilla", "fabric", "forge", "neoforge", "quilt"].includes(loader)) {
          next.loader = loader;
          if (loader !== current.loader) {
            next.resolvedVersionId = loader === "vanilla" ? next.minecraftVersion : null;
            next.installed = false;
          }
        }
      } else if (key === "minecraftVersion" && typeof value === "string") {
        next.minecraftVersion = value;
        if (value !== current.minecraftVersion) {
          next.resolvedVersionId = next.loader === "vanilla" ? value : null;
          next.installed = false;
        }
      } else if (key === "loaderVersion") {
        next.loaderVersion = value === null ? null : String(value).slice(0, 64);
        if (next.loaderVersion !== current.loaderVersion) {
          next.resolvedVersionId = null;
          next.installed = false;
        }
      } else if (key === "resolvedVersionId") {
        next.resolvedVersionId = value === null ? null : String(value).slice(0, 128);
      } else if (key === "installed" && typeof value === "boolean") next.installed = value;
      else if (typeof value === "string") next[key] = value.slice(0, 2e3);
      continue;
    }
    if (key === "java" && value && typeof value === "object") {
      const java = value;
      if ("javaPath" in java) next.java.javaPath = java.javaPath === null ? null : String(java.javaPath).slice(0, 4096);
      if (typeof java.maxRamMb === "number" && Number.isFinite(java.maxRamMb)) {
        next.java.maxRamMb = Math.min(Math.max(Math.round(java.maxRamMb), 512), ram.ceiling);
      }
      if (typeof java.minRamMb === "number" && Number.isFinite(java.minRamMb)) {
        next.java.minRamMb = Math.min(Math.max(Math.round(java.minRamMb), 256), ram.ceiling);
      }
      if (typeof java.jvmArgs === "string") next.java.jvmArgs = java.jvmArgs.slice(0, 2e3);
      if (next.java.minRamMb > next.java.maxRamMb) next.java.minRamMb = next.java.maxRamMb;
      continue;
    }
    if (key === "window" && value && typeof value === "object") {
      const win = value;
      if (typeof win.width === "number") next.window.width = Math.min(Math.max(Math.round(win.width), 320), 7680);
      if (typeof win.height === "number") next.window.height = Math.min(Math.max(Math.round(win.height), 240), 4320);
      if (typeof win.fullscreen === "boolean") next.window.fullscreen = win.fullscreen;
      continue;
    }
    if (key === "lastPlayedAt" && typeof value === "number") next.lastPlayedAt = value;
    if (key === "totalPlaytimeMs" && typeof value === "number") next.totalPlaytimeMs = Math.max(0, value);
  }
  saveInstance(next);
  broadcast$1();
  return next;
}
async function deleteInstance(id2, deleteFiles) {
  const instance = getInstance(id2);
  db().remove(Collections.instances, id2);
  if (deleteFiles) {
    const root = instanceDir(id2);
    assertInside(instancesRoot(), root);
    await promises.rm(root, { recursive: true, force: true });
  }
  const settings = getSettings();
  if (settings.selectedInstanceId === id2) {
    const remaining = listInstances();
    const { updateSettings: updateSettings2 } = await Promise.resolve().then(() => settingsService);
    updateSettings2({ selectedInstanceId: remaining[0]?.id ?? null });
  }
  log$K.info(`deleted instance "${instance.name}"${deleteFiles ? " and its files" : ""}`);
  broadcast$1();
}
async function duplicateInstance(id2, name) {
  const source = getInstance(id2);
  const copy = await createInstance({
    name,
    minecraftVersion: source.minecraftVersion,
    loader: source.loader,
    loaderVersion: source.loaderVersion,
    maxRamMb: source.java.maxRamMb,
    iconColor: source.iconColor
  });
  await promises.cp(source.gameDir, copy.gameDir, { recursive: true, force: false, errorOnExist: false }).catch((err) => {
    log$K.warn(`could not copy every file while duplicating: ${err.message}`);
  });
  const updated = updateInstance(copy.id, {
    resolvedVersionId: source.resolvedVersionId,
    installed: source.installed
  });
  return updated;
}
async function directorySize$1(dir) {
  let total = 0;
  let entries;
  try {
    entries = await promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = node_path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize$1(full);
    else if (entry.isFile()) {
      try {
        total += (await promises.stat(full)).size;
      } catch {
      }
    }
  }
  return total;
}
async function countEntries(dir, filter) {
  try {
    const entries = await promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => filter ? filter(e.name) : true).length;
  } catch {
    return 0;
  }
}
async function instanceStats(id2) {
  const instance = getInstance(id2);
  const [mods, worlds, resourcePacks, shaderPacks, screenshots, diskBytes] = await Promise.all([
    countEntries(node_path.join(instance.gameDir, "mods"), (n) => n.endsWith(".jar") || n.endsWith(".jar.disabled")),
    countEntries(node_path.join(instance.gameDir, "saves")),
    countEntries(node_path.join(instance.gameDir, "resourcepacks")),
    countEntries(node_path.join(instance.gameDir, "shaderpacks")),
    countEntries(node_path.join(instance.gameDir, "screenshots"), (n) => /\.(png|jpg|jpeg)$/i.test(n)),
    directorySize$1(instance.gameDir)
  ]);
  return { mods, worlds, resourcePacks, shaderPacks, screenshots, diskBytes };
}
async function ensureInstanceLayout(instance) {
  if (!node_fs.existsSync(instance.gameDir)) await promises.mkdir(instance.gameDir, { recursive: true });
  for (const sub of INSTANCE_SUBDIRS) {
    const dir = node_path.join(instance.gameDir, sub);
    if (!node_fs.existsSync(dir)) await promises.mkdir(dir, { recursive: true });
  }
}
function recordPlaySession(id2, durationMs) {
  const instance = findInstance(id2);
  if (!instance) return;
  saveInstance({
    ...instance,
    lastPlayedAt: Date.now(),
    totalPlaytimeMs: instance.totalPlaytimeMs + Math.max(0, durationMs)
  });
  broadcast$1();
}
const instanceService = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  INSTANCE_SUBDIRS,
  createInstance,
  deleteInstance,
  duplicateInstance,
  ensureInstanceLayout,
  findInstance,
  gameDirOf,
  getInstance,
  instanceStats,
  instanceSubdir,
  listInstances,
  recordPlaySession,
  updateInstance
}, Symbol.toStringTag, { value: "Module" }));
function launcherInView() {
  return electron.BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
  );
}
function notifyDesktop(notice) {
  if (!getSettings().desktopNotifications) return;
  if (!electron.Notification.isSupported()) return;
  if ((notice.onlyWhenAway ?? true) && launcherInView()) return;
  const notification = new electron.Notification({
    title: notice.title,
    body: notice.body ?? ""
  });
  notification.on("click", () => {
    const window = electron.BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return;
    if (!window.isVisible()) window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  notification.show();
}
const LOCK_CODES = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
const LOCK_ATTEMPTS = 7;
function isLockError(err) {
  const code = err?.code;
  return code != null && LOCK_CODES.has(code);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function removeFile(path2) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await promises.unlink(path2);
      return;
    } catch (err) {
      if (err.code === "ENOENT") return;
      if (!isLockError(err) || attempt === LOCK_ATTEMPTS - 1) return;
      await delay(40 * 2 ** attempt);
    }
  }
}
async function openForWrite(path2) {
  let last;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const handle2 = await promises.open(path2, "w");
      return handle2.createWriteStream({ autoClose: true });
    } catch (err) {
      last = err;
      if (!isLockError(err)) throw err;
      await delay(40 * 2 ** attempt);
    }
  }
  throw last;
}
async function renameWhenFree(from, to) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await promises.rename(from, to);
      return;
    } catch (err) {
      if (!isLockError(err) || attempt === LOCK_ATTEMPTS - 1) throw err;
      await delay(40 * 2 ** attempt);
    }
  }
}
const log$J = createLogger("downloads");
const MAX_ATTEMPTS = 4;
class DownloadTask {
  id = node_crypto.randomUUID();
  instanceId;
  items = [];
  queue = [];
  failed = [];
  concurrency;
  verifyMode;
  phase = "idle";
  label = "";
  currentFile = "";
  completedFiles = 0;
  totalFiles = 0;
  downloadedBytes = 0;
  totalBytes = 0;
  pausedFlag = false;
  pauseGate = Promise.resolve();
  releasePause = null;
  abort = new AbortController();
  finished = false;
  active = false;
  // Speed sampling
  lastSampleAt = Date.now();
  lastSampleBytes = 0;
  speedBps = 0;
  lastEmitAt = 0;
  constructor(opts = {}) {
    this.instanceId = opts.instanceId ?? null;
    this.concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 24));
    this.verifyMode = opts.verifyMode ?? "quick";
    this.phase = opts.phase ?? "idle";
    this.label = opts.label ?? "";
  }
  setPhase(phase, label) {
    this.phase = phase;
    this.label = label;
    this.emitProgress(true);
  }
  setVerifyMode(mode) {
    this.verifyMode = mode;
  }
  /** Adds files to this task. Safe to call between phases. */
  add(items) {
    this.items.push(...items);
    this.queue.push(...items);
    this.totalFiles += items.length;
    for (const item of items) this.totalBytes += item.size ?? 0;
    this.emitProgress();
  }
  get pendingCount() {
    return this.queue.length;
  }
  pause() {
    if (this.pausedFlag || this.finished) return;
    this.pausedFlag = true;
    this.pauseGate = new Promise((resolve) => {
      this.releasePause = resolve;
    });
    this.emitProgress(true);
  }
  resume() {
    if (!this.pausedFlag) return;
    this.pausedFlag = false;
    this.releasePause?.();
    this.releasePause = null;
    this.pauseGate = Promise.resolve();
    this.emitProgress(true);
  }
  cancel() {
    if (this.finished) return;
    this.resume();
    this.abort.abort();
    this.phase = "cancelled";
    this.emitProgress(true);
  }
  get cancelled() {
    return this.abort.signal.aborted;
  }
  /** Re-queues only the files that failed, keeping completed work. */
  retryFailed() {
    if (this.failed.length === 0) return;
    const retryable = this.failed.map((f) => f.item);
    this.failed = [];
    if (this.abort.signal.aborted) this.abort = new AbortController();
    this.queue.push(...retryable);
    this.finished = false;
    this.emitProgress(true);
  }
  /** Runs everything currently queued. Resolves when the queue drains. */
  async run() {
    if (this.queue.length === 0) {
      this.emitProgress(true);
      return;
    }
    this.active = true;
    const workerCount = Math.min(this.concurrency, this.queue.length);
    const workers = Array.from({ length: workerCount }, () => this.worker());
    try {
      await Promise.all(workers);
    } finally {
      this.active = false;
    }
    if (this.cancelled) {
      this.phase = "cancelled";
      this.emitProgress(true);
      return;
    }
    if (this.failed.length > 0) {
      this.phase = "error";
      this.emitProgress(true);
      throw new LauncherError(
        this.failed.some((f) => f.error.message.includes("checksum")) ? "CHECKSUM_MISMATCH" : "DOWNLOAD_FAILED",
        this.failed.map((f) => `${f.item.destination}: ${f.error.message}`).join("\n").slice(0, 1500)
      );
    }
    this.emitProgress(true);
  }
  async worker() {
    for (; ; ) {
      if (this.cancelled) return;
      if (this.pausedFlag) await this.pauseGate;
      const item = this.queue.shift();
      if (!item) return;
      let lastMessage = "unknown error";
      let succeeded = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (this.cancelled) return;
        try {
          await this.fetchOne(item);
          succeeded = true;
          break;
        } catch (err) {
          if (this.cancelled) return;
          lastMessage = err.message;
          if (attempt < MAX_ATTEMPTS) {
            const wait = 400 * 2 ** (attempt - 1);
            log$J.warn(`retry ${attempt}/${MAX_ATTEMPTS} for ${safeUrl(item.url)}: ${lastMessage}`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
      }
      this.completedFiles++;
      if (!succeeded) {
        this.failed.push({
          item,
          error: { file: node_path.basename(item.destination), message: lastMessage, attempts: MAX_ATTEMPTS }
        });
        log$J.error(`giving up on ${safeUrl(item.url)}: ${lastMessage}`);
      }
      this.emitProgress();
    }
  }
  async fetchOne(item) {
    this.currentFile = item.label ?? node_path.basename(item.destination);
    if (await this.alreadyValid(item)) {
      if (item.size) this.downloadedBytes += item.size;
      return;
    }
    await promises.mkdir(node_path.dirname(item.destination), { recursive: true });
    const response = await request(item.url, { signal: this.abort.signal, retries: 0, timeoutMs: 6e4 });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${safeUrl(item.url)}`);
    }
    const tempPath = `${item.destination}.part`;
    let written = 0;
    const source = node_stream.Readable.fromWeb(response.body);
    const meter = new node_stream.Transform({
      transform: (chunk, _encoding, callback) => {
        written += chunk.length;
        this.downloadedBytes += chunk.length;
        this.sampleSpeed();
        this.emitProgress();
        callback(null, chunk);
      }
    });
    try {
      await promises$1.pipeline(source, meter, await openForWrite(tempPath), { signal: this.abort.signal });
    } catch (err) {
      await removeFile(tempPath);
      this.downloadedBytes -= written;
      throw err;
    }
    try {
      const info = await promises.stat(tempPath);
      if (item.sha1) {
        const digest = await sha1OfFile(tempPath);
        if (digest.toLowerCase() !== item.sha1.toLowerCase()) {
          throw new Error(`checksum mismatch for ${node_path.basename(item.destination)}`);
        }
      } else if (item.size != null && info.size !== item.size) {
        const drift = Math.abs(info.size - item.size);
        const allowed = Math.max(16, Math.floor(item.size * 1e-3));
        if (drift > allowed) {
          throw new Error(
            `size mismatch for ${node_path.basename(item.destination)}: expected ${item.size} bytes, wrote ${info.size}`
          );
        }
      }
    } catch (err) {
      await removeFile(tempPath);
      this.downloadedBytes -= written;
      throw err;
    }
    await removeFile(item.destination);
    await renameWhenFree(tempPath, item.destination);
    if (item.executable) await promises.chmod(item.destination, 493).catch(() => void 0);
  }
  async alreadyValid(item) {
    try {
      const info = await promises.stat(item.destination);
      if (!info.isFile() || info.size === 0) return false;
      if (this.verifyMode === "full" && item.sha1) {
        return await sha1OfFile(item.destination) === item.sha1.toLowerCase();
      }
      if (item.size != null) {
        const drift = Math.abs(info.size - item.size);
        return drift <= Math.max(16, Math.floor(item.size * 1e-3));
      }
      return item.sha1 ? await sha1OfFile(item.destination) === item.sha1.toLowerCase() : true;
    } catch {
      return false;
    }
  }
  sampleSpeed() {
    const now = Date.now();
    const elapsed = now - this.lastSampleAt;
    if (elapsed < 500) return;
    const instant = (this.downloadedBytes - this.lastSampleBytes) * 1e3 / elapsed;
    this.speedBps = this.speedBps === 0 ? instant : this.speedBps * 0.7 + instant * 0.3;
    this.lastSampleAt = now;
    this.lastSampleBytes = this.downloadedBytes;
  }
  snapshot() {
    const remaining = Math.max(0, this.totalBytes - this.downloadedBytes);
    return {
      taskId: this.id,
      instanceId: this.instanceId,
      phase: this.phase,
      label: this.label,
      currentFile: this.currentFile,
      completedFiles: this.completedFiles,
      totalFiles: this.totalFiles,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      speedBps: Math.max(0, Math.round(this.speedBps)),
      etaSeconds: this.speedBps > 1024 && remaining > 0 ? Math.round(remaining / this.speedBps) : null,
      paused: this.pausedFlag,
      errors: this.failed.map((f) => f.error),
      active: this.active
    };
  }
  /** Throttled so a burst of chunk events cannot flood the renderer. */
  emitProgress(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmitAt < 200) return;
    this.lastEmitAt = now;
    emit("download:progress", this.snapshot());
  }
  markDone() {
    this.finished = true;
    this.phase = this.failed.length ? "error" : "done";
    this.emitProgress(true);
    if (this.totalFiles >= 25 || this.totalBytes >= 64 * 1024 * 1024) {
      notifyDesktop(
        this.failed.length ? { title: "Download finished with problems", body: `${this.label || "A download"} had ${this.failed.length} failed file${this.failed.length === 1 ? "" : "s"}.` } : { title: "Download complete", body: `${this.label || "Your download"} is ready.` }
      );
    }
  }
}
async function sha1OfFile(file2) {
  const { createReadStream } = await import("node:fs");
  return await new Promise((resolve, reject) => {
    const hash = node_crypto.createHash("sha1");
    const stream2 = createReadStream(file2);
    stream2.on("error", reject);
    stream2.on("data", (chunk) => hash.update(chunk));
    stream2.on("end", () => resolve(hash.digest("hex")));
  });
}
const tasks = /* @__PURE__ */ new Map();
function createTask(opts = {}) {
  const task = new DownloadTask(opts);
  tasks.set(task.id, task);
  if (tasks.size > 12) {
    const oldest = [...tasks.keys()][0];
    if (oldest && oldest !== task.id) tasks.delete(oldest);
  }
  return task;
}
function getTask(id2) {
  return tasks.get(id2);
}
function activeTasks() {
  return [...tasks.values()].map((t) => t.snapshot()).filter((s) => s.active || s.phase === "error" || s.paused);
}
function cancelAll() {
  for (const task of tasks.values()) task.cancel();
}
const WHITESPACE = /* @__PURE__ */ new Set([9, 10, 13, 32]);
function murmur2(data, seed = 1) {
  const m = 1540483477;
  const r = 24;
  const bytes = Buffer.alloc(data.length);
  let length = 0;
  for (const byte of data) {
    if (!WHITESPACE.has(byte)) bytes[length++] = byte;
  }
  let h = (seed ^ length) >>> 0;
  let index = 0;
  let remaining = length;
  while (remaining >= 4) {
    let k = (bytes[index] | bytes[index + 1] << 8 | bytes[index + 2] << 16 | bytes[index + 3] << 24) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ k >>> r) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    index += 4;
    remaining -= 4;
  }
  if (remaining === 3) h = (h ^ bytes[index + 2] << 16) >>> 0;
  if (remaining >= 2) h = (h ^ bytes[index + 1] << 8) >>> 0;
  if (remaining >= 1) {
    h = (h ^ bytes[index]) >>> 0;
    h = Math.imul(h, m) >>> 0;
  }
  h = (h ^ h >>> 13) >>> 0;
  h = Math.imul(h, m) >>> 0;
  h = (h ^ h >>> 15) >>> 0;
  return h >>> 0;
}
const log$I = createLogger("curseforge");
const API$2 = "https://api.curseforge.com/v1";
const GAME_MINECRAFT = 432;
const CLASS_MODS = 6;
const CLASS_RESOURCE_PACKS = 12;
const CLASS_SHADERS = 6552;
const CLASS_MODPACKS = 4471;
const LOADER_IDS = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
};
function loaderIdFor(loader) {
  return LOADER_IDS[loader] ?? null;
}
function classIdFor(kind) {
  switch (kind) {
    case "resourcepack":
      return CLASS_RESOURCE_PACKS;
    case "shader":
      return CLASS_SHADERS;
    case "modpack":
      return CLASS_MODPACKS;
    default:
      return CLASS_MODS;
  }
}
function subdirFor(kind) {
  switch (kind) {
    case "resourcepack":
      return "resourcepacks";
    case "shader":
      return "shaderpacks";
    default:
      return "mods";
  }
}
function isConfigured() {
  return Boolean(getSettings().curseForgeApiKey?.trim());
}
function apiKey() {
  const key = getSettings().curseForgeApiKey?.trim();
  if (!key) {
    throw new LauncherError("AUTH_NOT_CONFIGURED", "no CurseForge API key configured", {
      title: "CurseForge needs an API key",
      message: "Searching CurseForge requires a free API key. It is issued instantly from their developer console and is stored only on this PC.",
      actions: [
        "Open Settings → Content and paste your CurseForge API key",
        'Get one at console.curseforge.com — sign in, then "API Keys"',
        "Modrinth needs no key and works without this"
      ]
    });
  }
  return key;
}
async function readApiComplaint(response) {
  try {
    const text = (await response.text()).trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text);
      const said = parsed.message ?? parsed.error ?? parsed.description;
      if (said) return String(said).slice(0, 200);
    } catch {
    }
    if (/^\s*</.test(text)) return "an HTML error page rather than an API response";
    return text.slice(0, 200);
  } catch {
    return "";
  }
}
async function cfGet(path2, params) {
  const url = `${API$2}${path2}${params ? `?${params}` : ""}`;
  const response = await request(url, {
    headers: { "x-api-key": apiKey(), Accept: "application/json" },
    timeoutMs: 2e4,
    retries: 2
  });
  if (response.status === 401 || response.status === 403) {
    const explanation = await readApiComplaint(response);
    const detail = explanation ? ` — CurseForge said: ${explanation}` : "";
    if (response.status === 401) {
      throw new LauncherError("AUTH_NOT_CONFIGURED", `CurseForge rejected the API key (HTTP 401)${detail}`, {
        title: "CurseForge did not accept the key",
        message: `The key was not recognised. It may be mistyped, incomplete, or revoked.${detail}`,
        actions: [
          "Check the key in Settings → Content — paste the whole thing, it is long",
          "Generate a new one at console.curseforge.com",
          "Modrinth needs no key and works without this"
        ]
      });
    }
    throw new LauncherError("AUTH_NOT_CONFIGURED", `CurseForge refused the request (HTTP 403)${detail}`, {
      title: "CurseForge refused this request",
      message: `CurseForge answers this both for a key it does not recognise and for one that has not been approved for Minecraft, so it is worth ruling out the simple case first.${detail}`,
      actions: [
        "Re-copy the whole key — they are long and easily cut short",
        "At console.curseforge.com, check the key is approved for Minecraft",
        "Modrinth needs no key and has most of the same mods"
      ]
    });
  }
  if (!response.ok) {
    throw new LauncherError("NETWORK_ERROR", `CurseForge returned HTTP ${response.status}`);
  }
  return await response.json();
}
async function cfPost(path2, body) {
  const response = await request(`${API$2}${path2}`, {
    method: "POST",
    headers: { "x-api-key": apiKey(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 2e4,
    retries: 2
  });
  if (!response.ok) throw new LauncherError("NETWORK_ERROR", `CurseForge returned HTTP ${response.status}`);
  return await response.json();
}
async function searchCurseForge(options) {
  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(classIdFor(options.kind)),
    searchFilter: options.query.slice(0, 120),
    pageSize: String(Math.min(options.limit ?? 20, 50)),
    index: String(Math.max(options.offset ?? 0, 0)),
    sortField: options.query.trim() ? "1" : "6",
    // 1 = relevancy, 6 = total downloads
    sortOrder: "desc"
  });
  if (options.gameVersion) params.set("gameVersion", options.gameVersion);
  if (options.loader && options.kind === "mod") {
    const loaderId2 = LOADER_IDS[options.loader];
    if (loaderId2) params.set("modLoaderType", String(loaderId2));
  }
  const result = await cfGet("/mods/search", params);
  const installed = options.instance ? await installedNames(options.instance, options.kind) : /* @__PURE__ */ new Set();
  const projects = await Promise.all(
    result.data.map(async (mod) => {
      const icon = mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null;
      return {
        projectId: String(mod.id),
        slug: mod.slug,
        title: mod.name,
        description: mod.summary,
        author: mod.authors?.[0]?.name ?? "Unknown",
        downloads: mod.downloadCount ?? 0,
        follows: mod.thumbsUpCount ?? 0,
        iconDataUrl: icon ? await fetchImageAsDataUrl(icon, { timeoutMs: 8e3, retries: 0 }) : null,
        categories: (mod.categories ?? []).slice(0, 6).map((c) => c.name),
        projectType: options.kind,
        installed: [...installed].some((name) => name.includes(mod.slug.toLowerCase())),
        // Surfaced so the interface can say plainly that a mod must be fetched
        // by hand, instead of offering an Install button that cannot work.
        distributionAllowed: mod.allowModDistribution !== false,
        source: "curseforge",
        pageUrl: mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`
      };
    })
  );
  return { projects, total: result.pagination?.totalCount ?? projects.length, offset: options.offset ?? 0 };
}
async function installedNames(instance, kind) {
  try {
    const { readdir } = await import("node:fs/promises");
    return new Set((await readdir(instanceSubdir(instance, subdirFor(kind)))).map((n) => n.toLowerCase()));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
const RELEASE_TYPES$1 = { 1: "release", 2: "beta", 3: "alpha" };
function loadersOf(file2) {
  const known = {
    forge: "forge",
    neoforge: "neoforge",
    fabric: "fabric",
    quilt: "quilt"
  };
  const found = /* @__PURE__ */ new Set();
  for (const entry of file2.gameVersions ?? []) {
    const match = known[entry.trim().toLowerCase()];
    if (match) found.add(match);
  }
  return [...found];
}
async function listCurseForgeFiles(projectId, kind, gameVersion, loader) {
  const params = new URLSearchParams({ pageSize: "50" });
  if (gameVersion) params.set("gameVersion", gameVersion);
  if (loader && kind === "mod" && LOADER_IDS[loader]) params.set("modLoaderType", String(LOADER_IDS[loader]));
  const result = await cfGet(`/mods/${encodeURIComponent(projectId)}/files`, params);
  const wanted = loader?.toLowerCase();
  const usable = result.data.filter((file2) => {
    if (gameVersion && !(file2.gameVersions ?? []).includes(gameVersion)) return false;
    if (!wanted || kind !== "mod") return true;
    const declared = loadersOf(file2);
    return declared.length === 0 || declared.includes(wanted);
  });
  return usable.map((file2) => ({
    versionId: String(file2.id),
    name: file2.displayName,
    versionNumber: file2.displayName,
    gameVersions: file2.gameVersions ?? [],
    // What the file actually is, not what was asked for.
    loaders: loadersOf(file2),
    versionType: RELEASE_TYPES$1[file2.releaseType] ?? "release",
    datePublished: file2.fileDate,
    downloads: file2.downloadCount ?? 0,
    fileName: file2.fileName,
    fileSizeBytes: file2.fileLength ?? 0,
    requiredDependencies: (file2.dependencies ?? []).filter((d) => d.relationType === 3).length,
    // A null download URL is the author's opt-out, not a launcher failure.
    downloadable: Boolean(file2.downloadUrl)
  }));
}
async function getFile(projectId, fileId) {
  const result = await cfGet(
    `/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
  );
  return result.data;
}
async function installCurseForgeFile(instance, projectId, fileId, kind) {
  const file2 = await getFile(projectId, fileId);
  if (!file2.downloadUrl) {
    throw new LauncherError("INVALID_INPUT", `file ${fileId} has no download URL (author opt-out)`, {
      title: "This mod must be downloaded manually",
      message: 'Its author has turned off third-party downloads on CurseForge, so no launcher is permitted to fetch it automatically. Download the file from its CurseForge page, then add it with "Add mods".',
      actions: [
        "Open the mod page on CurseForge and download the file",
        "Return here and use Mods → Installed → Add mods",
        "Or look for the same mod on Modrinth, which has no such restriction"
      ]
    });
  }
  return await fetchFileInto(
    instanceSubdir(instance, subdirFor(kind)),
    instance.id,
    instance.name,
    file2
  );
}
async function fetchFileInto(dir, taskId, describedAs, file2) {
  const destination = node_path.join(dir, node_path.basename(file2.fileName));
  const result = { installed: [], dependencies: [], skipped: [] };
  if (node_fs.existsSync(destination)) {
    result.skipped.push(file2.fileName);
    return result;
  }
  const sha1 = file2.hashes?.find((h) => h.algo === 1)?.value ?? null;
  const task = createTask({ instanceId: taskId, label: `Downloading ${file2.displayName}`, phase: "libraries" });
  task.add([{ url: file2.downloadUrl, destination, sha1, size: file2.fileLength, label: file2.fileName }]);
  await task.run();
  task.markDone();
  result.installed.push(file2.fileName);
  log$I.info(`installed ${file2.fileName} from CurseForge into "${describedAs}"`);
  return result;
}
async function installCurseForgeFileToDir(target, projectId, fileId, describedAs = "the server") {
  const file2 = await getFile(projectId, fileId);
  if (!file2.downloadUrl) {
    throw new LauncherError("INVALID_INPUT", `file ${fileId} has no download URL (author opt-out)`, {
      title: "This mod must be downloaded manually",
      message: 'Its author has turned off third-party downloads on CurseForge, so no launcher is permitted to fetch it automatically. Download the file from its CurseForge page and add it with "Add files".',
      actions: [
        "Open the mod page on CurseForge and download the file",
        'Return here and use "Add files"',
        "Or look for the same mod on Modrinth, which has no such restriction"
      ]
    });
  }
  ensureDir(target.dir);
  return await fetchFileInto(target.dir, target.taskId, describedAs, file2);
}
async function getFiles(fileIds) {
  if (fileIds.length === 0) return [];
  const result = await cfPost("/mods/files", { fileIds });
  return result.data;
}
async function verifyApiKey(candidate) {
  const key = (candidate ?? getSettings().curseForgeApiKey ?? "").trim();
  if (!key) return { ok: false, reason: "No key has been entered." };
  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    pageSize: "1",
    sortField: "6",
    sortOrder: "desc"
  });
  try {
    const response = await request(`${API$2}/mods/search?${params}`, {
      headers: { "x-api-key": key, Accept: "application/json" },
      timeoutMs: 15e3,
      retries: 1
    });
    if (response.ok) return { ok: true, reason: "CurseForge accepted the key." };
    const said = await readApiComplaint(response);
    const complaint = said ? ` CurseForge said: ${said}` : "";
    const shape = key.length < 40 ? ` The key entered is ${key.length} characters, which is short — CurseForge keys are around 60, so check none of it was left behind.` : "";
    const detail = `${complaint}${shape}`;
    if (response.status === 401) {
      return { ok: false, reason: `CurseForge did not recognise that key.${detail}` };
    }
    if (response.status === 403) {
      return {
        ok: false,
        reason: `CurseForge refused the request. Their API answers this both for a key it does not recognise and for one that has not been approved for Minecraft, so check the key is complete first, then its approval at console.curseforge.com.${detail}`
      };
    }
    return { ok: false, reason: `CurseForge returned HTTP ${response.status}.${detail}` };
  } catch (err) {
    return { ok: false, reason: `Could not reach CurseForge: ${err.message}` };
  }
}
const log$H = createLogger("modrinth");
const API$1 = "https://api.modrinth.com/v2";
const KINDS = {
  mod: { projectType: "mod", subdir: "mods", extensions: /\.jar$/i },
  resourcepack: { projectType: "resourcepack", subdir: "resourcepacks", extensions: /\.zip$/i },
  shader: { projectType: "shader", subdir: "shaderpacks", extensions: /\.(zip|zip\.txt)$/i },
  modpack: { projectType: "modpack", subdir: "mods", extensions: /\.mrpack$/i }
};
function loaderFacet(kind, loader) {
  if (kind === "resourcepack" || kind === "modpack") return [];
  if (kind === "shader") return ["iris", "optifine", "canvas", "vanilla"];
  if (loader === "vanilla") return [];
  if (loader === "quilt") return ["quilt", "fabric"];
  return [loader];
}
async function searchProjects(options) {
  const kind = KINDS[options.kind];
  if (!kind) throw new LauncherError("INVALID_INPUT", `unknown content kind ${options.kind}`);
  const facets = [[`project_type:${kind.projectType}`]];
  if (options.gameVersion) facets.push([`versions:${options.gameVersion}`]);
  const loaders = options.loader ? loaderFacet(options.kind, options.loader) : [];
  if (loaders.length > 0) facets.push(loaders.map((l) => `categories:${l}`));
  const params = new URLSearchParams({
    query: options.query.slice(0, 120),
    facets: JSON.stringify(facets),
    limit: String(Math.min(options.limit ?? 20, 50)),
    offset: String(Math.max(options.offset ?? 0, 0)),
    index: options.query.trim() ? "relevance" : "downloads"
  });
  const response = await getJson(`${API$1}/search?${params}`, { timeoutMs: 2e4, retries: 2 });
  const installedNames2 = options.instance ? await installedFileNames(options.instance, options.kind) : /* @__PURE__ */ new Set();
  const projects = await Promise.all(
    response.hits.map(async (hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      author: hit.author,
      downloads: hit.downloads,
      follows: hit.follows,
      iconDataUrl: hit.icon_url ? await fetchImageAsDataUrl(hit.icon_url, { timeoutMs: 8e3, retries: 0 }) : null,
      categories: hit.categories.slice(0, 6),
      projectType: hit.project_type,
      installed: [...installedNames2].some((name) => name.includes(hit.slug.toLowerCase()))
    }))
  );
  return { projects, total: response.total_hits, offset: response.offset };
}
async function installedFileNames(instance, kind) {
  try {
    const dir = instanceSubdir(instance, KINDS[kind].subdir);
    return new Set((await promises.readdir(dir)).map((name) => name.toLowerCase()));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
async function listVersions(projectId, kind, gameVersion, loader) {
  const params = new URLSearchParams();
  if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
  const loaders = loader ? loaderFacet(kind, loader) : [];
  if (loaders.length > 0) params.set("loaders", JSON.stringify(loaders));
  const query = params.toString();
  const versions = await getJson(
    `${API$1}/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ""}`,
    { timeoutMs: 2e4, retries: 2 }
  );
  return versions.map((version) => {
    const file2 = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file2) return null;
    return {
      versionId: version.id,
      name: version.name,
      versionNumber: version.version_number,
      gameVersions: version.game_versions,
      loaders: version.loaders,
      versionType: ["release", "beta", "alpha"].includes(version.version_type) ? version.version_type : "release",
      datePublished: version.date_published,
      downloads: version.downloads,
      fileName: file2.filename,
      fileSizeBytes: file2.size,
      requiredDependencies: version.dependencies.filter((d) => d.dependency_type === "required").length
    };
  }).filter((v) => v !== null);
}
async function fetchVersion(versionId) {
  return await getJson(`${API$1}/version/${encodeURIComponent(versionId)}`, { timeoutMs: 2e4, retries: 2 });
}
async function resolveDependencyVersion(projectId, gameVersion, loader) {
  const params = new URLSearchParams();
  if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
  const loaders = loader ? loaderFacet("mod", loader) : [];
  if (loaders.length > 0) params.set("loaders", JSON.stringify(loaders));
  try {
    const versions = await getJson(
      `${API$1}/project/${encodeURIComponent(projectId)}/version?${params}`,
      { timeoutMs: 15e3, retries: 1 }
    );
    return versions.find((v) => v.version_type === "release") ?? versions[0] ?? null;
  } catch {
    return null;
  }
}
async function installVersionToInstance(instance, versionId, kind) {
  return await installVersionToDir(
    {
      dir: instanceSubdir(instance, KINDS[kind].subdir),
      taskId: instance.id,
      loader: instance.loader,
      minecraftVersion: instance.minecraftVersion
    },
    versionId
  );
}
async function installVersionToDir(target, versionId, kind) {
  const targetDir = target.dir;
  const result = { installed: [], dependencies: [], skipped: [] };
  const version = await fetchVersion(versionId);
  const task = createTask({ instanceId: target.taskId, label: "Downloading content", phase: "libraries" });
  const items = [];
  const queue = (raw, isDependency) => {
    const file2 = raw.files.find((f) => f.primary) ?? raw.files[0];
    if (!file2) return;
    const destination = node_path.join(targetDir, node_path.basename(file2.filename));
    if (node_fs.existsSync(destination)) {
      result.skipped.push(file2.filename);
      return;
    }
    items.push({
      url: file2.url,
      destination,
      sha1: file2.hashes?.sha1 ?? null,
      size: file2.size,
      label: file2.filename
    });
    if (isDependency) result.dependencies.push(file2.filename);
    else result.installed.push(file2.filename);
  };
  queue(version, false);
  const gameVersion = target.minecraftVersion;
  for (const dependency of version.dependencies) {
    if (dependency.dependency_type !== "required") continue;
    try {
      const raw = dependency.version_id ? await fetchVersion(dependency.version_id) : dependency.project_id ? await resolveDependencyVersion(dependency.project_id, gameVersion, target.loader) : null;
      if (raw) queue(raw, true);
    } catch (err) {
      log$H.warn(`could not resolve a required dependency: ${err.message}`);
    }
  }
  if (items.length === 0) {
    task.markDone();
    return result;
  }
  task.add(items);
  await task.run();
  task.markDone();
  log$H.info(
    `installed ${result.installed.length} file(s) and ${result.dependencies.length} dependency file(s) into ${targetDir}`
  );
  return result;
}
async function getProjectBody(projectId) {
  const project = await getJson(
    `${API$1}/project/${encodeURIComponent(projectId)}`,
    { timeoutMs: 15e3, retries: 1 }
  );
  return { body: (project.body ?? "").slice(0, 2e4), title: project.title };
}
async function postJson(url, body) {
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 25e3,
    retries: 2
  });
  if (!response.ok) {
    throw new LauncherError("NETWORK_ERROR", `POST ${url} -> HTTP ${response.status}`);
  }
  return await response.json();
}
function isMajorJump$1(current, next) {
  if (!current) return false;
  const first = (value) => {
    const match = /(\d+)/.exec(value);
    return match ? Number(match[1]) : null;
  };
  const a = first(current);
  const b = first(next);
  if (a === null || b === null) return false;
  return b > a;
}
async function checkModUpdates(instance) {
  const dir = instanceSubdir(instance, "mods");
  let entries;
  try {
    entries = (await promises.readdir(dir)).filter((name) => /\.jar(\.disabled)?$/i.test(name));
  } catch {
    return [];
  }
  if (entries.length === 0) return [];
  const byHash = /* @__PURE__ */ new Map();
  for (const fileName of entries) {
    try {
      byHash.set(await sha1OfFile(node_path.join(dir, fileName)), fileName);
    } catch {
    }
  }
  if (byHash.size === 0) return [];
  const hashes = [...byHash.keys()];
  const loaders = loaderFacet("mod", instance.loader);
  const [current, latest] = await Promise.all([
    postJson(`${API$1}/version_files`, { hashes, algorithm: "sha1" }),
    postJson(`${API$1}/version_files/update`, {
      hashes,
      algorithm: "sha1",
      loaders: loaders.length > 0 ? loaders : void 0,
      game_versions: [instance.minecraftVersion]
    })
  ]);
  const updates = [];
  for (const [hash, newest] of Object.entries(latest)) {
    const fileName = byHash.get(hash);
    if (!fileName || !newest) continue;
    const installed = current[hash];
    if (installed && installed.id === newest.id) continue;
    const file2 = newest.files.find((f) => f.primary) ?? newest.files[0];
    if (!file2) continue;
    updates.push({
      fileName,
      modName: newest.name || file2.filename,
      // The project, not the version — `newest.id` is the version id, and
      // labelling it projectId sent anything that followed the field (a
      // project page link, a changelog lookup) to a URL that does not exist.
      projectId: newest.project_id ?? installed?.project_id ?? "",
      currentVersion: installed?.version_number ?? null,
      currentVersionId: installed?.id ?? null,
      newVersionId: newest.id,
      newVersion: newest.version_number,
      newFileName: file2.filename,
      sizeBytes: file2.size,
      enabled: !fileName.endsWith(".disabled"),
      versionType: newest.version_type ?? "release",
      publishedAt: Date.parse(newest.date_published) || null,
      majorJump: isMajorJump$1(installed?.version_number ?? null, newest.version_number)
    });
  }
  log$H.info(`${updates.length} of ${byHash.size} mods in "${instance.name}" have updates`);
  return updates;
}
async function applyModUpdate(instance, update) {
  const dir = instanceSubdir(instance, "mods");
  const version = await fetchVersion(update.newVersionId);
  const file2 = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file2) throw new LauncherError("NOT_FOUND", "that version has no downloadable file");
  const targetName = update.enabled ? node_path.basename(file2.filename) : `${node_path.basename(file2.filename)}.disabled`;
  const destination = node_path.join(dir, targetName);
  const task = createTask({ instanceId: instance.id, label: `Updating ${update.modName}`, phase: "libraries" });
  task.add([
    {
      url: file2.url,
      destination,
      sha1: file2.hashes?.sha1 ?? null,
      size: file2.size,
      label: file2.filename
    }
  ]);
  await task.run();
  task.markDone();
  const old = node_path.join(dir, update.fileName);
  if (old !== destination) {
    await stashForRollback(instance, update, old);
  }
  log$H.info(`updated ${update.fileName} -> ${targetName} in "${instance.name}"`);
}
function rollbackDir(instance) {
  return node_path.join(instanceDir(instance.id), "rollback");
}
const ROLLBACK_INDEX = "rollback.json";
async function readRollbackIndex(instance) {
  try {
    const raw = await promises.readFile(node_path.join(rollbackDir(instance), ROLLBACK_INDEX), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function writeRollbackIndex(instance, entries) {
  const dir = rollbackDir(instance);
  await promises.mkdir(dir, { recursive: true });
  await promises.writeFile(node_path.join(dir, ROLLBACK_INDEX), JSON.stringify(entries, null, 2), "utf8");
}
async function stashForRollback(instance, update, oldPath) {
  const dir = rollbackDir(instance);
  await promises.mkdir(dir, { recursive: true });
  const stashed = node_path.join(dir, update.fileName);
  let sizeBytes = 0;
  try {
    sizeBytes = (await promises.stat(oldPath)).size;
    await promises.rm(stashed, { force: true });
    await promises.rename(oldPath, stashed);
  } catch (err) {
    log$H.warn(`could not keep a rollback copy of ${update.fileName}: ${err.message}`);
    await promises.rm(oldPath, { force: true }).catch(() => void 0);
    return;
  }
  const entries = (await readRollbackIndex(instance)).filter((entry) => entry.fileName !== update.fileName);
  entries.unshift({
    fileName: update.fileName,
    modName: update.modName,
    fromVersion: update.currentVersion,
    toVersion: update.newVersion,
    replacedBy: update.enabled ? node_path.basename(update.newFileName) : `${node_path.basename(update.newFileName)}.disabled`,
    updatedAt: Date.now(),
    sizeBytes
  });
  const kept = entries.slice(0, 20);
  for (const dropped of entries.slice(20)) {
    await promises.rm(node_path.join(dir, dropped.fileName), { force: true }).catch(() => void 0);
  }
  await writeRollbackIndex(instance, kept);
}
async function listRollbacks(instance) {
  const dir = rollbackDir(instance);
  const entries = await readRollbackIndex(instance);
  return entries.filter((entry) => node_fs.existsSync(node_path.join(dir, entry.fileName)));
}
async function rollbackModUpdate(instance, fileName) {
  const entries = await readRollbackIndex(instance);
  const entry = entries.find((candidate) => candidate.fileName === fileName);
  if (!entry) throw new LauncherError("NOT_FOUND", "there is no saved copy of that mod to go back to");
  const dir = rollbackDir(instance);
  const stashed = node_path.join(dir, entry.fileName);
  if (!node_fs.existsSync(stashed)) throw new LauncherError("NOT_FOUND", "the saved copy of that mod is gone");
  const mods = instanceSubdir(instance, "mods");
  await promises.rm(node_path.join(mods, entry.replacedBy), { force: true }).catch(() => void 0);
  await promises.rename(stashed, node_path.join(mods, entry.fileName));
  await writeRollbackIndex(
    instance,
    entries.filter((candidate) => candidate.fileName !== fileName)
  );
  log$H.info(`rolled ${entry.modName} back to ${entry.fromVersion ?? "the previous build"} in "${instance.name}"`);
  return entry;
}
async function modChangelog(update) {
  if (!update.projectId) {
    const single = await fetchVersion(update.newVersionId);
    return [toChangelog(single)];
  }
  let versions;
  try {
    versions = await getJson(
      `${API$1}/project/${encodeURIComponent(update.projectId)}/version`,
      { timeoutMs: 2e4, retries: 2 }
    );
  } catch {
    const single = await fetchVersion(update.newVersionId);
    return [toChangelog(single)];
  }
  const newestAt = Date.parse(versions.find((v) => v.id === update.newVersionId)?.date_published ?? "") || Date.now();
  const installedAt = update.currentVersionId ? Date.parse(versions.find((v) => v.id === update.currentVersionId)?.date_published ?? "") || 0 : 0;
  const between = versions.filter((version) => {
    const at = Date.parse(version.date_published) || 0;
    return at <= newestAt && at > installedAt;
  }).sort((a, b) => (Date.parse(b.date_published) || 0) - (Date.parse(a.date_published) || 0)).slice(0, 12);
  const list = between.length > 0 ? between : versions.filter((v) => v.id === update.newVersionId);
  return list.map(toChangelog);
}
function toChangelog(version) {
  return {
    versionId: version.id,
    versionNumber: version.version_number,
    name: version.name,
    versionType: version.version_type ?? "release",
    publishedAt: Date.parse(version.date_published) || null,
    changelog: (version.changelog ?? "").trim()
  };
}
const log$G = createLogger("curseforge-updates");
async function jarsOnDisk(instance) {
  const dir = instanceSubdir(instance, "mods");
  let entries = [];
  try {
    entries = await promises.readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(".jar") || name.endsWith(".jar.disabled")).map((name) => ({ fileName: name, path: node_path.join(dir, name) }));
}
async function identify(jars) {
  const prints = /* @__PURE__ */ new Map();
  for (const jar of jars) {
    try {
      const print = murmur2(await promises.readFile(jar.path));
      if (!prints.has(print)) prints.set(print, jar.fileName);
    } catch (err) {
      log$G.warn(`could not read ${jar.fileName}: ${err.message}`);
    }
  }
  if (prints.size === 0) return /* @__PURE__ */ new Map();
  const response = await cfPost("/fingerprints", {
    fingerprints: [...prints.keys()]
  });
  const byFileName = /* @__PURE__ */ new Map();
  for (const match of response.data?.exactMatches ?? []) {
    const fileName = prints.get(match.file?.fileFingerprint);
    if (fileName) byFileName.set(fileName, match);
  }
  return byFileName;
}
async function newestFor(instance, modId) {
  const params = new URLSearchParams({ gameVersion: instance.minecraftVersion, pageSize: "20" });
  const loader = loaderIdFor(instance.loader);
  if (loader !== null) params.set("modLoaderType", String(loader));
  const response = await cfGet(`/mods/${modId}/files`, params);
  const files = response.data ?? [];
  if (files.length === 0) return null;
  return files.sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0] ?? null;
}
const RELEASE_TYPES = { 1: "release", 2: "beta", 3: "alpha" };
function isMajorJump(from, to) {
  const lead = (value) => {
    const match = /\d+/.exec(value);
    return match ? Number(match[0]) : null;
  };
  const a = lead(from);
  const b = lead(to);
  return a !== null && b !== null && b > a;
}
async function checkCurseForgeUpdates(instance) {
  if (!isConfigured()) return [];
  const jars = await jarsOnDisk(instance);
  if (jars.length === 0) return [];
  const identified = await identify(jars);
  if (identified.size === 0) return [];
  const updates = [];
  for (const [fileName, match] of identified) {
    let newest = null;
    try {
      newest = await newestFor(instance, match.id);
    } catch (err) {
      log$G.warn(`could not list files for ${match.id}: ${err.message}`);
      continue;
    }
    if (!newest || newest.id === match.file.id) continue;
    if (!newest.downloadUrl) continue;
    const currentName = match.file.displayName ?? match.file.fileName;
    updates.push({
      fileName,
      modName: newest.displayName || node_path.basename(fileName),
      projectId: String(match.id),
      currentVersion: currentName,
      currentVersionId: String(match.file.id),
      newVersion: newest.displayName,
      newVersionId: String(newest.id),
      newFileName: newest.fileName,
      sizeBytes: newest.fileLength,
      enabled: !fileName.endsWith(".disabled"),
      versionType: RELEASE_TYPES[newest.releaseType] ?? "release",
      // ModUpdate stores this as a timestamp; CurseForge sends an ISO string.
      publishedAt: Date.parse(newest.fileDate),
      majorJump: isMajorJump(currentName, newest.displayName),
      source: "curseforge"
    });
  }
  log$G.info(`${updates.length} CurseForge update(s) for "${instance.name}"`);
  return updates;
}
async function applyCurseForgeUpdate(instance, update) {
  const dir = instanceSubdir(instance, "mods");
  const response = await cfGet(`/mods/${update.projectId}/files/${update.newVersionId}`);
  const file2 = response.data;
  if (!file2?.downloadUrl) {
    throw new LauncherError("NOT_FOUND", "CurseForge will not serve that file to a launcher", {
      title: `${update.modName} cannot be downloaded automatically`,
      message: "The author has turned off third-party downloads for this file, so it has to be fetched from the website by hand.",
      actions: ["Open the project page on CurseForge", "Download the file into this instance’s mods folder"]
    });
  }
  const targetName = update.enabled ? node_path.basename(file2.fileName) : `${node_path.basename(file2.fileName)}.disabled`;
  const destination = node_path.join(dir, targetName);
  const task = createTask({ instanceId: instance.id, label: `Updating ${update.modName}`, phase: "libraries" });
  task.add([{ url: file2.downloadUrl, destination, sha1: null, size: file2.fileLength, label: file2.fileName }]);
  await task.run();
  task.markDone();
  const old = node_path.join(dir, update.fileName);
  if (old !== destination) await stashForRollback(instance, update, old);
  log$G.info(`updated ${update.fileName} -> ${targetName} in "${instance.name}"`);
}
const log$F = createLogger("local-model");
const OLLAMA = "http://127.0.0.1:11434";
let cached = null;
const CACHE_MS = 6e4;
const PREFERRED = ["qwen2.5", "qwen3", "llama3.1", "llama3.2", "mistral", "gemma2", "phi4"];
const AVOID = [
  // Trained for an agent framework with its own command vocabulary; it answers
  // in that instead of doing as it is asked.
  "andy",
  // Reasoning models: slow, and their chain of thought leaks into the answer.
  "deepseek-r1",
  // Code models write code when asked for prose.
  "coder"
];
function score(name) {
  const lower = name.toLowerCase();
  if (AVOID.some((bad) => lower.includes(bad))) return -1;
  const rank = PREFERRED.findIndex((family) => lower.startsWith(family));
  return rank === -1 ? PREFERRED.length : rank;
}
async function findLocalModel() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.found;
  let found = null;
  try {
    const response = await fetch(`${OLLAMA}/api/tags`, {
      signal: AbortSignal.timeout(1500)
    });
    if (response.ok) {
      const body = await response.json();
      const names = (body.models ?? []).map((entry) => entry.name).filter((n) => Boolean(n));
      const usable = names.map((name) => ({ name, rank: score(name) })).filter((entry) => entry.rank >= 0).sort((a, b) => a.rank - b.rank);
      if (usable.length > 0) {
        found = { baseUrl: `${OLLAMA}/v1`, model: usable[0].name, apiKey: "" };
        log$F.info(`found a local model for diagnosis: ${usable[0].name}`);
      } else if (names.length > 0) {
        log$F.info(`Ollama is running but only has models unsuited to this: ${names.join(", ")}`);
      }
    }
  } catch {
  }
  cached = { at: Date.now(), found };
  return found;
}
const log$E = createLogger("bundled");
const BUNDLED_MODS = [
  {
    id: "hollow",
    name: "Hollow",
    jarName: "hollow.jar",
    blurb: "A companion that is genuinely useful, and stays that way for a while. It talks, it fetches you materials, and it will not give you diamonds. Over a fortnight of play it stops being helpful. Runs on a model on this machine — nothing is sent anywhere.",
    loader: "fabric",
    minecraftVersion: "1.21.11",
    icon: "ghost",
    wantsModel: true
  },
  {
    id: "ember",
    name: "Ember",
    jarName: "ember.jar",
    blurb: "A lantern keeper that hovers at your shoulder and burns the dark back — it finds the unlit spots mobs would spawn in and puts torches there, and throws its shutters open to blind anything that gets close. No face: it speaks with its flame, its shutters and its hands. Hit it and it sulks.",
    loader: "fabric",
    minecraftVersion: "1.21.11",
    icon: "flame",
    wantsModel: false
  }
];
function findBundledMod(id2) {
  const mod = BUNDLED_MODS.find((candidate) => candidate.id === id2);
  if (!mod) {
    throw new LauncherError("NOT_FOUND", `no bundled mod called ${id2}`, {
      title: "That mod is not one this launcher ships",
      message: `Nothing named "${id2}" is bundled with the launcher.`,
      actions: ["Reinstall the launcher if you expected it to be there"]
    });
  }
  return mod;
}
function bundledJar(mod) {
  return electron.app.isPackaged ? node_path.join(process.resourcesPath, mod.jarName) : node_path.join(electron.app.getAppPath(), "resources", mod.jarName);
}
async function bundledModStatus(instance, id2) {
  const mod = findBundledMod(id2);
  const mods = instanceSubdir(instance, "mods");
  let entries = [];
  try {
    entries = await promises.readdir(mods);
  } catch {
  }
  const compatible = instance.loader === mod.loader && instance.minecraftVersion === mod.minecraftVersion;
  const local = mod.wantsModel ? await findLocalModel() : null;
  const compatibleInstances = listInstances().filter(
    (other) => other.loader === mod.loader && other.minecraftVersion === mod.minecraftVersion
  ).map((other) => other.name);
  return {
    id: mod.id,
    name: mod.name,
    blurb: mod.blurb,
    icon: mod.icon,
    wantsModel: mod.wantsModel,
    requires: `Fabric ${mod.minecraftVersion}`,
    available: node_fs.existsSync(bundledJar(mod)),
    compatibleInstances,
    compatible,
    installed: entries.includes(mod.jarName),
    reason: compatible ? null : `${mod.name} is built for Fabric ${mod.minecraftVersion}, and this instance is ${instance.loader} ${instance.minecraftVersion}.`,
    // Matched loosely: the file is named for its version, which changes.
    hasFabricApi: entries.some((name) => name.toLowerCase().startsWith("fabric-api")),
    suggestedModel: local?.model ?? null
  };
}
async function allBundledModStatuses(instance) {
  return await Promise.all(BUNDLED_MODS.map((mod) => bundledModStatus(instance, mod.id)));
}
function hollowConfig(model) {
  return `# Hollow — written by NexusCraft Launcher on install.
#
# Anything speaking the OpenAI chat-completions API works here. This was
# pointed at the Ollama already running on this machine, and at a model
# measured to hold the reply format the mod needs.
#
# If the companion starts answering in prose, or narrating its own reasoning
# out loud, the model is the cause rather than the mod. Reasoning models
# (deepseek-r1, qwen3 with thinking) and agent-tuned ones (andy) all do this.

baseUrl=http://127.0.0.1:11434/v1
model=${model}
apiKey=

timeoutSeconds=30

# Seconds between the director considering whether anything happens. Lower is
# not scarier: something that speaks every twenty seconds is company.
thinkEverySeconds=90

# 0 turns the model off and leaves only the written lines.
temperature=0.9
`;
}
async function installBundledMod(instance, id2) {
  const mod = findBundledMod(id2);
  const status2 = await bundledModStatus(instance, id2);
  if (!status2.available) {
    throw new LauncherError("NOT_FOUND", `the ${mod.name} jar was not shipped with this build`, {
      title: `${mod.name} is not available in this build`,
      message: "The launcher could not find the mod file it ships with.",
      actions: ["Reinstall the launcher"]
    });
  }
  if (!status2.compatible) {
    throw new LauncherError("INVALID_INPUT", status2.reason ?? "incompatible instance", {
      title: `This instance cannot run ${mod.name}`,
      message: status2.reason ?? "",
      actions: [`Create a Fabric ${mod.minecraftVersion} instance and install it there`]
    });
  }
  const mods = instanceSubdir(instance, "mods");
  await promises.mkdir(mods, { recursive: true });
  await promises.copyFile(bundledJar(mod), node_path.join(mods, mod.jarName));
  let wroteConfig = false;
  const local = mod.wantsModel ? await findLocalModel() : null;
  if (mod.id === "hollow" && local) {
    const configDir = node_path.join(instanceDir(instance.id), "minecraft", "config");
    const configPath = node_path.join(configDir, "hollow.properties");
    if (!node_fs.existsSync(configPath)) {
      await promises.mkdir(configDir, { recursive: true });
      await promises.writeFile(configPath, hollowConfig(local.model), "utf8");
      wroteConfig = true;
    }
  }
  const warning = !status2.hasFabricApi ? `Fabric API is not installed in this instance, and ${mod.name} needs it. Install it from the Browse tab.` : mod.wantsModel && !local ? "No local model was found, so the mod will use its own defaults. Start Ollama, or edit config/hollow.properties." : null;
  log$E.info(`installed ${mod.name} into "${instance.name}"${local ? ` using ${local.model}` : ""}`);
  return {
    id: mod.id,
    name: mod.name,
    installedJar: true,
    wroteConfig,
    model: local?.model ?? null,
    warning
  };
}
const BUILDS = {
  q4: { dtype: "q4", downloadMb: 300, typicalMs: 1100 },
  q8: { dtype: "q8", downloadMb: 90, typicalMs: 4200 }
};
const DEFAULT_VOICE = "af_sky";
let status = { state: "idle" };
let loading = null;
let loadedBuild = null;
let worker = null;
const pending = /* @__PURE__ */ new Map();
let nextRequestId = 1;
function workerScriptPath() {
  return node_path.join(electron.app.getAppPath(), "out", "main", "voice.js");
}
function startWorker() {
  if (worker && !worker.killed) return worker;
  const script = workerScriptPath();
  if (!node_fs.existsSync(script)) throw new Error(`the voice worker is missing at ${script}`);
  const child = node_child_process.fork(script, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    // The model is a few hundred megabytes of tensors; the default heap is not
    // generous enough on every machine.
    execArgv: ["--max-old-space-size=2048"]
  });
  child.on("message", (message) => {
    if (message?.type === "ready") {
      status = { state: "ready", build: loadedBuild ?? "q4", voices: message.voices ?? [] };
    } else if (message?.type === "failed") {
      status = { state: "failed", message: String(message.message ?? "unknown") };
    } else if (message?.type === "spoken") {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(String(message.error)));
      else waiting.resolve(Buffer.from(String(message.wav), "base64"));
    } else if (message?.type === "transcribed") {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(String(message.error)));
      else waiting.resolve(String(message.text ?? ""));
    }
  });
  child.on("exit", (code) => {
    worker = null;
    loadedBuild = null;
    for (const [, waiting] of pending) waiting.reject(new Error("the voice worker stopped"));
    pending.clear();
    if (status.state !== "failed") status = { state: "idle" };
    if (code !== 0) status = { state: "failed", message: `the voice worker exited with code ${code}` };
  });
  worker = child;
  return child;
}
function shutdown() {
  worker?.kill();
  worker = null;
  loadedBuild = null;
  status = { state: "idle" };
}
function currentStatus() {
  return status;
}
function cacheDir() {
  const dir = node_path.join(electron.app.getPath("userData"), "voice-models");
  node_fs.mkdirSync(dir, { recursive: true });
  return dir;
}
async function ensureLoaded(build = "q4") {
  if (status.state === "ready" && loadedBuild === build) return;
  if (loading && loadedBuild === build) return loading;
  if (loadedBuild && loadedBuild !== build) shutdown();
  loadedBuild = build;
  status = { state: "loading", build };
  loading = new Promise((resolve, reject) => {
    let child;
    try {
      child = startWorker();
    } catch (error) {
      status = { state: "failed", message: error instanceof Error ? error.message : String(error) };
      reject(error);
      return;
    }
    const done = (message) => {
      if (message?.type === "ready") {
        child.off("message", done);
        resolve();
      } else if (message?.type === "failed") {
        child.off("message", done);
        reject(new Error(String(message.message ?? "the voice model failed to load")));
      }
    };
    child.on("message", done);
    child.send({ type: "load", cacheDir: cacheDir(), build });
  });
  try {
    await loading;
  } finally {
    loading = null;
  }
}
async function speak(text, voice = DEFAULT_VOICE, build = "q4") {
  const line = text.trim();
  if (!line) throw new Error("nothing to say");
  await ensureLoaded(build);
  const child = worker;
  if (!child) throw new Error("the voice model is not loaded");
  const known = status.state === "ready" ? status.voices : [];
  const chosen = known.includes(voice) ? voice : DEFAULT_VOICE;
  const id2 = nextRequestId++;
  return await new Promise((resolve, reject) => {
    pending.set(id2, { resolve, reject });
    child.send({ type: "speak", id: id2, text: line, voice: chosen });
    setTimeout(() => {
      if (!pending.has(id2)) return;
      pending.delete(id2);
      reject(new Error("the voice worker did not answer in time"));
    }, 6e4);
  });
}
async function transcribe$1(samples, language) {
  const child = startWorker();
  const id2 = nextRequestId++;
  return await new Promise((resolve, reject) => {
    pending.set(id2, { resolve, reject });
    child.send({
      type: "transcribe",
      id: id2,
      cacheDir: cacheDir(),
      // Sent as a plain array: a typed array does not survive process IPC.
      samples: Array.from(samples),
      language
    });
    setTimeout(() => {
      if (!pending.has(id2)) return;
      pending.delete(id2);
      reject(new Error("the voice worker did not transcribe in time"));
    }, 3e5);
  });
}
const SAMPLE_RATE = 16e3;
function wavToFloats(wav) {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("not a WAV file");
  }
  let rate = SAMPLE_RATE;
  let channels = 1;
  let bits = 16;
  let data = null;
  let at = 12;
  while (at + 8 <= wav.length) {
    const id2 = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id2 === "fmt ") {
      channels = wav.readUInt16LE(body + 2);
      rate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (id2 === "data") {
      data = wav.subarray(body, Math.min(body + size, wav.length));
    }
    at = body + size + size % 2;
  }
  if (!data) throw new Error("the WAV had no audio in it");
  if (bits !== 16) throw new Error(`expected 16-bit audio, got ${bits}-bit`);
  const total = Math.floor(data.length / 2);
  const frames = Math.floor(total / channels);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += data.readInt16LE((frame * channels + channel) * 2);
    }
    samples[frame] = sum / channels / 32768;
  }
  return { samples, rate };
}
function resample(samples, from, to = SAMPLE_RATE) {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start2 = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
    let sum = 0;
    for (let j = start2; j < end; j += 1) sum += samples[j];
    out[i] = end > start2 ? sum / (end - start2) : 0;
  }
  return out;
}
async function transcribe(wav, language) {
  const { samples, rate } = wavToFloats(wav);
  const audio = resample(samples, rate);
  if (audio.length < SAMPLE_RATE / 5) return "";
  return await transcribe$1(audio, language);
}
const SPEECH_PORT = 8880;
let server = null;
function readBody(request2) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request2.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64e3) {
        reject(new Error("request too large"));
        request2.destroy();
        return;
      }
      body += chunk;
    });
    request2.on("end", () => resolve(body));
    request2.on("error", reject);
  });
}
function isRunning$1() {
  return server !== null;
}
async function start(build = "q4") {
  if (server) return;
  server = node_http.createServer((request2, response) => {
    void (async () => {
      if (request2.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      if (request2.url?.endsWith("/audio/transcriptions")) {
        try {
          const { file: file2, fields } = parseMultipart(await readRawBody(request2), request2.headers["content-type"] ?? "");
          if (!file2) {
            response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "no audio file in the request" }));
            return;
          }
          const text = await transcribe(file2, fields.language || void 0);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ text }));
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "transcription failed" }));
        }
        return;
      }
      if (!request2.url?.endsWith("/audio/speech")) {
        response.writeHead(404).end();
        return;
      }
      try {
        const body = JSON.parse(await readBody(request2));
        const line = (body.input ?? "").slice(0, 400);
        if (!line.trim()) {
          response.writeHead(400).end();
          return;
        }
        const wav = await speak(line, body.voice || DEFAULT_VOICE, build);
        response.writeHead(200, {
          "Content-Type": "audio/wav",
          "Content-Length": String(wav.length)
        });
        response.end(wav);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain" }).end(error instanceof Error ? error.message : "speech failed");
      }
    })();
  });
  await new Promise((resolve, reject) => {
    server?.once("error", (error) => {
      server = null;
      if (error.code === "EADDRINUSE") {
        resolve();
        return;
      }
      reject(error);
    });
    server?.listen(SPEECH_PORT, "127.0.0.1", resolve);
  });
}
async function stop() {
  const running2 = server;
  server = null;
  if (!running2) return;
  await new Promise((resolve) => running2.close(() => resolve()));
}
async function readRawBody(request2) {
  const chunks = [];
  for await (const chunk of request2) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function parseMultipart(body, contentType) {
  const marker = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = marker?.[1] ?? marker?.[2];
  if (!boundary) return { file: null, fields: {} };
  const separator = Buffer.from(`--${boundary}`);
  const fields = {};
  let file2 = null;
  let at = body.indexOf(separator);
  while (at !== -1) {
    const start2 = at + separator.length;
    if (body.toString("ascii", start2, start2 + 2) === "--") break;
    const next = body.indexOf(separator, start2);
    if (next === -1) break;
    const part = body.subarray(start2, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.toString("utf8", 0, headerEnd);
      const content = part.subarray(headerEnd + 4, part.length - 2);
      const named = /name="([^"]+)"/i.exec(headers);
      const name = named?.[1];
      if (name) {
        if (/filename="/i.test(headers)) file2 = content;
        else fields[name] = content.toString("utf8").trim();
      }
    }
    at = next;
  }
  return { file: file2, fields };
}
const log$D = createLogger("discord-rpc");
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;
function socketPath(index) {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${index}`;
  const base = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? "/tmp";
  return `${base.replace(/\/$/, "")}/discord-ipc-${index}`;
}
class DiscordRpcClient extends node_events.EventEmitter {
  socket = null;
  buffer = Buffer.alloc(0);
  connected = false;
  clientId;
  constructor(clientId) {
    super();
    this.clientId = clientId;
  }
  get isConnected() {
    return this.connected;
  }
  /**
   * Tries each of Discord's ten possible sockets in turn. Resolves false when
   * none answered, which simply means Discord is not running.
   */
  async connect() {
    if (this.connected) return true;
    for (let index = 0; index < 10; index += 1) {
      const socket = await this.tryOne(socketPath(index));
      if (!socket) continue;
      this.socket = socket;
      socket.on("data", (chunk) => this.onData(chunk));
      socket.on("close", () => this.onClose());
      socket.on("error", () => this.onClose());
      this.write(OP_HANDSHAKE, { v: 1, client_id: this.clientId });
      this.connected = true;
      log$D.info(`connected to Discord on socket ${index}`);
      return true;
    }
    return false;
  }
  tryOne(path2) {
    return new Promise((resolve) => {
      let settled = false;
      const socket = node_net.connect(path2);
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer2);
        if (!value) socket.destroy();
        resolve(value);
      };
      const timer2 = setTimeout(() => finish(null), 1500);
      socket.once("connect", () => finish(socket));
      socket.once("error", () => finish(null));
    });
  }
  write(op, payload) {
    if (!this.socket || this.socket.destroyed) return;
    try {
      const json = Buffer.from(JSON.stringify(payload), "utf8");
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(json.length, 4);
      this.socket.write(Buffer.concat([header, json]));
    } catch (err) {
      log$D.warn(`could not write to the Discord socket: ${err.message}`);
    }
  }
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + length) break;
      const body = this.buffer.subarray(8, 8 + length).toString("utf8");
      this.buffer = this.buffer.subarray(8 + length);
      if (op === OP_PING) {
        try {
          this.write(OP_PONG, JSON.parse(body));
        } catch {
        }
        continue;
      }
      if (op === OP_CLOSE) {
        this.onClose();
        return;
      }
      if (op === OP_FRAME) {
        try {
          this.emit("message", JSON.parse(body));
        } catch {
        }
      }
    }
  }
  onClose() {
    if (!this.connected && !this.socket) return;
    this.connected = false;
    this.socket?.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.emit("disconnected");
  }
  /** Publishes an activity, or clears it when given null. */
  setActivity(activity) {
    if (!this.connected) return;
    const payload = activity ? {
      details: activity.details,
      state: activity.state,
      timestamps: activity.startTimestamp ? { start: Math.floor(activity.startTimestamp) } : void 0,
      assets: {
        large_image: activity.largeImageKey,
        large_text: activity.largeImageText,
        small_image: activity.smallImageKey,
        small_text: activity.smallImageText
      }
    } : null;
    this.write(OP_FRAME, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: payload },
      nonce: node_crypto.randomUUID()
    });
  }
  destroy() {
    if (this.socket && this.connected) {
      this.setActivity(null);
    }
    this.connected = false;
    this.socket?.destroy();
    this.socket = null;
  }
}
const log$C = createLogger("presence");
const DISCORD_APP_ID = process.env.NEXUSCRAFT_DISCORD_APP_ID?.trim() || "1315123456789012345";
let client = null;
let connecting = false;
let activeInstanceId = null;
async function ensureClient() {
  if (client?.isConnected) return client;
  if (connecting) return null;
  connecting = true;
  try {
    const next = new DiscordRpcClient(DISCORD_APP_ID);
    const ok = await next.connect();
    if (!ok) {
      log$C.info("Discord is not running; presence is off for now");
      return null;
    }
    next.on("disconnected", () => {
      log$C.info("Discord disconnected");
      client = null;
    });
    client = next;
    return client;
  } catch (err) {
    log$C.warn(`could not reach Discord: ${err.message}`);
    return null;
  } finally {
    connecting = false;
  }
}
async function showIdlePresence() {
  if (!getSettings().discordPresence) return;
  if (activeInstanceId) return;
  const rpc = await ensureClient();
  rpc?.setActivity({
    details: "In the launcher",
    state: "Browsing mods and instances",
    largeImageKey: "nexuscraft",
    largeImageText: "NexusCraft Launcher"
  });
}
async function updatePresenceFromLaunch(state) {
  if (!getSettings().discordPresence) return;
  if (state.stage === "running") {
    const instance = findInstance(state.instanceId);
    if (!instance) return;
    activeInstanceId = state.instanceId;
    const rpc = await ensureClient();
    const loader = instance.loader === "vanilla" ? "Vanilla" : instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1);
    rpc?.setActivity({
      details: instance.name,
      state: `${loader} ${instance.minecraftVersion}`,
      startTimestamp: state.startedAt ?? Date.now(),
      largeImageKey: "minecraft",
      largeImageText: `Minecraft ${instance.minecraftVersion}`,
      smallImageKey: "nexuscraft",
      smallImageText: "NexusCraft Launcher"
    });
    return;
  }
  if (state.stage === "exited" || state.stage === "error") {
    if (activeInstanceId !== state.instanceId) return;
    activeInstanceId = null;
    void showIdlePresence();
  }
}
function clearPresence() {
  activeInstanceId = null;
  client?.setActivity(null);
}
function shutdownPresence() {
  activeInstanceId = null;
  client?.destroy();
  client = null;
}
function initPresence() {
  if (!getSettings().discordPresence) return;
  setTimeout(() => void showIdlePresence(), 6e3).unref();
}
function currentOsName() {
  switch (node_os.platform()) {
    case "win32":
      return "windows";
    case "darwin":
      return "osx";
    default:
      return "linux";
  }
}
function currentArch() {
  switch (node_os.arch()) {
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    case "arm64":
      return "arm64";
    default:
      return node_os.arch();
  }
}
function matchesOs(spec) {
  if (spec.name && spec.name !== currentOsName()) return false;
  if (spec.arch && spec.arch !== currentArch() && spec.arch !== node_os.arch()) return false;
  if (spec.version) {
    try {
      if (!new RegExp(spec.version).test(node_os.release())) return false;
    } catch {
      return true;
    }
  }
  return true;
}
function evaluateRules(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) matches = matchesOs(rule.os);
    if (matches && rule.features) {
      for (const [name, required] of Object.entries(rule.features)) {
        const actual = Boolean(features[name]);
        if (actual !== required) {
          matches = false;
          break;
        }
      }
    }
    if (matches) allowed = rule.action === "allow";
  }
  return allowed;
}
function isLibraryAllowed(library, features = {}) {
  return evaluateRules(library.rules, features);
}
function nativesClassifier(library) {
  if (!library.natives) return null;
  const template = library.natives[currentOsName()];
  if (!template) return null;
  return template.replace("${arch}", node_os.arch() === "ia32" ? "32" : "64");
}
function mavenToPath(coordinate) {
  const [main, extension = "jar"] = coordinate.split("@");
  const parts = main.split(":");
  const [group, artifact, version] = parts;
  const classifier = parts[3];
  const fileName = classifier ? `${artifact}-${version}-${classifier}.${extension}` : `${artifact}-${version}.${extension}`;
  return [...group.split("."), artifact, version, fileName].join("/");
}
const log$B = createLogger("versions");
const MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES_BASE = "https://resources.download.minecraft.net";
const MANIFEST_CACHE = () => node_path.join(cacheRoot(), "version_manifest_v2.json");
const MANIFEST_TTL_MS = 15 * 60 * 1e3;
let manifestMemo = null;
async function fetchManifest(refresh = false) {
  if (!refresh && manifestMemo && Date.now() - manifestMemo.at < MANIFEST_TTL_MS) {
    return { data: manifestMemo.data, fromCache: false, fetchedAt: manifestMemo.at };
  }
  try {
    const data = await getJson(MANIFEST_URL, { timeoutMs: 2e4, retries: 2 });
    manifestMemo = { data, at: Date.now() };
    ensureDir(cacheRoot());
    await promises.writeFile(MANIFEST_CACHE(), JSON.stringify(data), "utf8").catch(() => void 0);
    return { data, fromCache: false, fetchedAt: manifestMemo.at };
  } catch (err) {
    log$B.warn("could not reach the version manifest; trying the cache");
    try {
      const cached2 = JSON.parse(await promises.readFile(MANIFEST_CACHE(), "utf8"));
      const info = await promises.stat(MANIFEST_CACHE());
      manifestMemo = { data: cached2, at: info.mtimeMs };
      return { data: cached2, fromCache: true, fetchedAt: info.mtimeMs };
    } catch {
      throw err instanceof LauncherError ? err : new LauncherError("NETWORK_ERROR", err);
    }
  }
}
async function getManifestInfo(refresh = false) {
  const { data, fromCache, fetchedAt } = await fetchManifest(refresh);
  const installed = new Set(await listInstalledVersionIds());
  const versions = data.versions.map((entry) => ({
    id: entry.id,
    type: ["release", "snapshot", "old_beta", "old_alpha"].includes(entry.type) ? entry.type : "release",
    releaseTime: entry.releaseTime,
    installed: installed.has(entry.id),
    javaMajor: null
  }));
  return {
    latestRelease: data.latest.release,
    latestSnapshot: data.latest.snapshot,
    versions,
    fetchedAt,
    fromCache
  };
}
async function listInstalledVersionIds() {
  try {
    const entries = await promises.readdir(versionsRoot(), { withFileTypes: true });
    const ids = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (node_fs.existsSync(node_path.join(versionsRoot(), entry.name, `${entry.name}.json`))) ids.push(entry.name);
    }
    return ids;
  } catch {
    return [];
  }
}
function versionDir(versionId) {
  return node_path.join(versionsRoot(), versionId);
}
function versionJsonPath(versionId) {
  return node_path.join(versionDir(versionId), `${versionId}.json`);
}
function versionJarPath(versionId) {
  return node_path.join(versionDir(versionId), `${versionId}.jar`);
}
async function ensureVersionJson(versionId) {
  const path2 = versionJsonPath(versionId);
  if (node_fs.existsSync(path2)) {
    try {
      return JSON.parse(await promises.readFile(path2, "utf8"));
    } catch {
      log$B.warn(`version json for ${versionId} was corrupt; re-downloading`);
    }
  }
  const { data } = await fetchManifest();
  const entry = data.versions.find((v) => v.id === versionId);
  if (!entry) {
    throw new LauncherError("NOT_FOUND", `version ${versionId} is not in Mojang's manifest`, {
      title: `Minecraft ${versionId} was not found`,
      message: `Mojang's version list does not contain "${versionId}". It may have been withdrawn, or the instance may refer to a modded profile that has not been installed yet.`,
      actions: ["Pick a different version for this instance", "Refresh the version list from the Versions screen"]
    });
  }
  const json = await getJson(entry.url, { timeoutMs: 3e4 });
  await promises.mkdir(node_path.dirname(path2), { recursive: true });
  await promises.writeFile(path2, JSON.stringify(json, null, 2), "utf8");
  return json;
}
async function resolveVersion(versionId, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(versionId)) {
    throw new LauncherError("INSTANCE_CORRUPT", `circular inheritance at ${versionId}`);
  }
  seen.add(versionId);
  const json = await ensureVersionJson(versionId);
  if (!json.inheritsFrom) return { ...json, resolvedBaseId: json.id };
  const parent = await resolveVersion(json.inheritsFrom, seen);
  const merged = [];
  const keyOf = (name) => {
    const parts = name.split(":");
    const artifact = parts.slice(0, 2).join(":");
    const classifier = parts.length > 3 ? parts[3] : "";
    return classifier ? `${artifact}:${classifier}` : artifact;
  };
  const takenKeys = /* @__PURE__ */ new Set();
  for (const library of [...json.libraries ?? [], ...parent.libraries ?? []]) {
    const key = keyOf(library.name);
    if (takenKeys.has(key)) continue;
    takenKeys.add(key);
    merged.push(library);
  }
  return {
    ...parent,
    ...json,
    id: json.id,
    // Loader profiles append their arguments to the parent's.
    arguments: {
      game: [...parent.arguments?.game ?? [], ...json.arguments?.game ?? []],
      jvm: [...parent.arguments?.jvm ?? [], ...json.arguments?.jvm ?? []]
    },
    minecraftArguments: json.minecraftArguments ?? parent.minecraftArguments,
    mainClass: json.mainClass ?? parent.mainClass,
    assetIndex: json.assetIndex ?? parent.assetIndex,
    assets: json.assets ?? parent.assets,
    downloads: { ...parent.downloads, ...json.downloads },
    javaVersion: json.javaVersion ?? parent.javaVersion,
    logging: json.logging ?? parent.logging,
    libraries: merged,
    // The chain is now flattened; keep the root id so callers know where the
    // vanilla client jar lives.
    resolvedBaseId: parent.resolvedBaseId ?? parent.id,
    inheritsFrom: void 0
  };
}
function resolveLibraries(version) {
  const out = [];
  for (const library of version.libraries ?? []) {
    if (!isLibraryAllowed(library)) continue;
    const classifier = nativesClassifier(library);
    if (classifier) {
      const native = library.downloads?.classifiers?.[classifier];
      if (native?.path) {
        out.push({
          name: library.name,
          path: node_path.join(librariesRoot(), ...native.path.split("/")),
          url: native.url,
          sha1: native.sha1 ?? null,
          size: native.size ?? null,
          isNative: true,
          extractExclude: library.extract?.exclude ?? []
        });
      }
    }
    const artifact = library.downloads?.artifact;
    if (artifact?.path) {
      out.push({
        name: library.name,
        path: node_path.join(librariesRoot(), ...artifact.path.split("/")),
        url: artifact.url,
        sha1: artifact.sha1 ?? null,
        size: artifact.size ?? null,
        // A rule-gated jar whose name carries a natives classifier is a native.
        isNative: /:natives-/.test(library.name) || library.name.includes(`natives-${currentOsName()}`),
        extractExclude: library.extract?.exclude ?? []
      });
      continue;
    }
    if (!classifier) {
      const relative = mavenToPath(library.name);
      const base = library.url ?? "https://libraries.minecraft.net/";
      out.push({
        name: library.name,
        path: node_path.join(librariesRoot(), ...relative.split("/")),
        url: base.endsWith("/") ? base + relative : `${base}/${relative}`,
        sha1: null,
        size: null,
        isNative: false,
        extractExclude: []
      });
    }
  }
  return out;
}
async function installVersion(versionId, options) {
  const { task } = options;
  task.setPhase("version-json", `Reading Minecraft ${versionId} metadata`);
  const version = await resolveVersion(versionId);
  const clientJar = version.downloads?.client;
  const baseId = version.resolvedBaseId ?? versionId;
  if (clientJar) {
    task.setPhase("client-jar", "Downloading the Minecraft client");
    task.add([
      {
        url: clientJar.url,
        destination: versionJarPath(baseId),
        sha1: clientJar.sha1,
        size: clientJar.size,
        label: `${baseId}.jar`
      }
    ]);
    await task.run();
  }
  task.setPhase("libraries", "Downloading game libraries");
  const libraries = resolveLibraries(version);
  const libraryItems = libraries.filter((library) => library.url).map((library) => ({
    url: library.url,
    destination: library.path,
    sha1: library.sha1,
    size: library.size,
    label: library.name
  }));
  task.add(libraryItems);
  await task.run();
  const logging = version.logging?.client;
  if (logging?.file?.url) {
    task.add([
      {
        url: logging.file.url,
        destination: node_path.join(assetsRoot(), "log_configs", logging.file.id),
        sha1: logging.file.sha1,
        size: logging.file.size,
        label: logging.file.id
      }
    ]);
    await task.run();
  }
  if (!options.skipAssets && version.assetIndex) {
    task.setPhase("assets", "Downloading game assets");
    await installAssets(version, task);
  }
  task.setPhase("natives", "Unpacking native libraries");
  await extractNatives(nativesLibraryPath(versionId, version), libraries);
  return version;
}
async function installAssets(version, task) {
  const index = version.assetIndex;
  if (!index?.url || !index.id) return;
  const indexPath = node_path.join(assetsRoot(), "indexes", `${index.id}.json`);
  task.add([{ url: index.url, destination: indexPath, sha1: index.sha1, size: index.size, label: `${index.id}.json` }]);
  await task.run();
  const assetIndex = JSON.parse(await promises.readFile(indexPath, "utf8"));
  const objectsDir = node_path.join(assetsRoot(), "objects");
  const items = [];
  for (const [name, object] of Object.entries(assetIndex.objects)) {
    const prefix = object.hash.slice(0, 2);
    items.push({
      url: `${RESOURCES_BASE}/${prefix}/${object.hash}`,
      destination: node_path.join(objectsDir, prefix, object.hash),
      sha1: object.hash,
      size: object.size,
      label: name
    });
  }
  task.add(items);
  await task.run();
  if (assetIndex.virtual || assetIndex.map_to_resources) {
    const virtualRoot = node_path.join(assetsRoot(), "virtual", index.id);
    for (const [name, object] of Object.entries(assetIndex.objects)) {
      const target = node_path.join(virtualRoot, ...name.split("/"));
      if (node_fs.existsSync(target)) continue;
      await promises.mkdir(node_path.dirname(target), { recursive: true });
      await promises.copyFile(node_path.join(objectsDir, object.hash.slice(0, 2), object.hash), target).catch(() => void 0);
    }
  }
}
function nativesLibraryPath(versionId, version) {
  const base = nativesDir(versionId);
  const PREFIX2 = "-Djava.library.path=";
  for (const entry of version.arguments?.jvm ?? []) {
    const values = typeof entry === "string" ? [entry] : Array.isArray(entry.value) ? entry.value : [entry.value];
    for (const value of values) {
      if (typeof value !== "string" || !value.startsWith(PREFIX2)) continue;
      const template = value.slice(PREFIX2.length);
      return node_path.normalize(template.split("${natives_directory}").join(base));
    }
  }
  return base;
}
async function extractNatives(target, libraries) {
  ensureDir(target);
  for (const library of libraries) {
    if (!library.isNative || !node_fs.existsSync(library.path)) continue;
    try {
      const zip = new AdmZip(library.path);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        if (name.startsWith("META-INF/")) continue;
        if (library.extractExclude.some((prefix) => name.startsWith(prefix))) continue;
        if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue;
        const outPath = node_path.join(target, name.split("/").pop());
        if (node_fs.existsSync(outPath)) continue;
        await promises.writeFile(outPath, entry.getData());
      }
    } catch (err) {
      log$B.warn(`could not unpack natives from ${library.name}: ${err.message}`);
    }
  }
  return target;
}
function nativesDir(versionId) {
  return node_path.join(nativesRoot(), versionId);
}
async function ensureNativesExtracted(versionId, version) {
  return await extractNatives(nativesLibraryPath(versionId, version), resolveLibraries(version));
}
async function verifyInstallation(versionId) {
  const version = await resolveVersion(versionId);
  const missing = [];
  const jarId = version.resolvedBaseId ?? versionId;
  if (version.downloads?.client && !node_fs.existsSync(versionJarPath(jarId))) missing.push(`${jarId}.jar`);
  for (const library of resolveLibraries(version)) {
    if (!node_fs.existsSync(library.path)) missing.push(library.name);
  }
  if (version.assetIndex?.id && !node_fs.existsSync(node_path.join(assetsRoot(), "indexes", `${version.assetIndex.id}.json`))) {
    missing.push(`asset index ${version.assetIndex.id}`);
  }
  return { missing, version };
}
function buildClasspath(versionId, version) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const library of resolveLibraries(version)) {
    if (library.isNative) continue;
    if (seen.has(library.path)) continue;
    seen.add(library.path);
    entries.push(library.path);
  }
  const jar = versionJarPath(version.resolvedBaseId ?? version.inheritsFrom ?? versionId);
  if (!node_fs.existsSync(jar)) {
    throw new LauncherError(
      "MISSING_LIBRARIES",
      `the Minecraft client jar is missing: ${jar}. Reinstall this version.`
    );
  }
  entries.push(jar);
  return entries;
}
async function deleteVersion(versionId) {
  await promises.rm(versionDir(versionId), { recursive: true, force: true });
  await promises.rm(nativesDir(versionId), { recursive: true, force: true });
}
const log$A = createLogger("java");
const execFileAsync = node_util.promisify(node_child_process.execFile);
const RUNTIME_MANIFEST_URL = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const isWindows = node_os.platform() === "win32";
const JAVA_EXE = isWindows ? "java.exe" : "java";
const JAVAW_EXE = isWindows ? "javaw.exe" : "java";
async function probeJava(javaPath) {
  if (!node_fs.existsSync(javaPath)) return null;
  try {
    const { stderr, stdout } = await execFileAsync(javaPath, ["-version"], { timeout: 1e4, windowsHide: true });
    const output = `${stderr}
${stdout}`;
    const versionMatch = output.match(/version "([^"]+)"/);
    if (!versionMatch) return null;
    const version = versionMatch[1];
    const major = version.startsWith("1.") ? Number.parseInt(version.split(".")[1] ?? "0", 10) : Number.parseInt(version.split(/[.\-+]/)[0] ?? "0", 10);
    if (!Number.isFinite(major) || major <= 0) return null;
    let vendor = "Unknown";
    if (/temurin|adoptium/i.test(output)) vendor = "Eclipse Temurin";
    else if (/zulu/i.test(output)) vendor = "Azul Zulu";
    else if (/graalvm/i.test(output)) vendor = "GraalVM";
    else if (/microsoft/i.test(output)) vendor = "Microsoft";
    else if (/openjdk/i.test(output)) vendor = "OpenJDK";
    else if (/java\(tm\)|hotspot/i.test(output)) vendor = "Oracle";
    const is64 = /64-bit/i.test(output);
    return {
      path: javaPath,
      version,
      majorVersion: major,
      vendor,
      arch: is64 ? "x64" : "x86",
      source: "manual",
      managed: false
    };
  } catch {
    return null;
  }
}
function candidateRoots$1() {
  const roots = [];
  if (isWindows) {
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    for (const base of [programFiles, programFilesX86]) {
      roots.push(
        node_path.join(base, "Java"),
        node_path.join(base, "Eclipse Adoptium"),
        node_path.join(base, "Eclipse Foundation"),
        node_path.join(base, "AdoptOpenJDK"),
        node_path.join(base, "Zulu"),
        node_path.join(base, "Microsoft"),
        node_path.join(base, "Amazon Corretto"),
        node_path.join(base, "BellSoft"),
        node_path.join(base, "Semeru")
      );
    }
    if (localAppData) {
      roots.push(node_path.join(localAppData, "Packages"), node_path.join(localAppData, "Programs", "Eclipse Adoptium"));
      roots.push(node_path.join(process.env.APPDATA ?? "", ".minecraft", "runtime"));
    }
  } else {
    roots.push("/usr/lib/jvm", "/usr/java", "/Library/Java/JavaVirtualMachines", "/opt/java");
  }
  return roots.filter((r) => r && node_fs.existsSync(r));
}
async function findUnderRoot(root, depth = 2) {
  const found = [];
  if (depth <= 0) return found;
  let entries;
  try {
    entries = (await promises.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return found;
  }
  for (const name of entries) {
    const dir = node_path.join(root, name);
    const direct = node_path.join(dir, "bin", JAVA_EXE);
    if (node_fs.existsSync(direct)) {
      found.push(direct);
      continue;
    }
    const macHome = node_path.join(dir, "Contents", "Home", "bin", JAVA_EXE);
    if (node_fs.existsSync(macHome)) {
      found.push(macHome);
      continue;
    }
    found.push(...await findUnderRoot(dir, depth - 1));
  }
  return found;
}
async function fromPath() {
  try {
    const command = isWindows ? "where" : "which";
    const { stdout } = await execFileAsync(command, [JAVA_EXE], { timeout: 8e3, windowsHide: true });
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && node_fs.existsSync(line));
  } catch {
    return [];
  }
}
let detectionCache = null;
async function detectJavaInstallations(refresh = false) {
  if (!refresh && detectionCache && Date.now() - detectionCache.at < 6e4) {
    return detectionCache.installations;
  }
  const candidates = /* @__PURE__ */ new Map();
  for (const managed of await listManagedRuntimes()) candidates.set(managed, "managed");
  if (process.env.JAVA_HOME) {
    const home = node_path.join(process.env.JAVA_HOME, "bin", JAVA_EXE);
    if (node_fs.existsSync(home)) candidates.set(home, "java-home");
  }
  for (const path2 of await fromPath()) if (!candidates.has(path2)) candidates.set(path2, "path");
  for (const root of candidateRoots$1()) {
    for (const path2 of await findUnderRoot(root)) {
      if (!candidates.has(path2)) candidates.set(path2, "common-dir");
    }
  }
  const results = [];
  const seenVersions = /* @__PURE__ */ new Set();
  for (const [path2, source] of candidates) {
    const probed = await probeJava(path2);
    if (!probed) continue;
    const key = `${probed.version}|${probed.arch}|${node_path.dirname(node_path.dirname(path2))}`;
    if (seenVersions.has(key)) continue;
    seenVersions.add(key);
    results.push({ ...probed, source, managed: source === "managed" });
  }
  results.sort((a, b) => Number(b.managed) - Number(a.managed) || b.majorVersion - a.majorVersion);
  detectionCache = { installations: results, at: Date.now() };
  log$A.info(`found ${results.length} Java runtime(s)`);
  return results;
}
function runtimePlatform() {
  if (isWindows) {
    if (node_os.arch() === "arm64") return "windows-arm64";
    return node_os.arch() === "ia32" ? "windows-x86" : "windows-x64";
  }
  if (node_os.platform() === "darwin") return node_os.arch() === "arm64" ? "mac-os-arm64" : "mac-os";
  return node_os.arch() === "ia32" ? "linux-i386" : "linux";
}
function componentForMajor(major) {
  if (major <= 8) return "jre-legacy";
  if (major <= 16) return "java-runtime-alpha";
  if (major <= 17) return "java-runtime-gamma";
  if (major <= 21) return "java-runtime-delta";
  return "java-runtime-delta";
}
function managedRuntimeDir(component) {
  return node_path.join(runtimesRoot(), component, runtimePlatform());
}
function managedJavaExe(component, preferWindowless2 = false) {
  const base = managedRuntimeDir(component);
  const exe = preferWindowless2 ? JAVAW_EXE : JAVA_EXE;
  const macPath = node_path.join(base, "jre.bundle", "Contents", "Home", "bin", exe);
  if (node_os.platform() === "darwin" && node_fs.existsSync(macPath)) return macPath;
  return node_path.join(base, "bin", exe);
}
async function listManagedRuntimes() {
  const found = [];
  try {
    for (const component of await promises.readdir(runtimesRoot())) {
      const exe = managedJavaExe(component);
      if (node_fs.existsSync(exe)) found.push(exe);
    }
  } catch {
  }
  return found;
}
function managedRuntimeInstalled(component) {
  const exe = managedJavaExe(component);
  return node_fs.existsSync(exe) ? exe : null;
}
async function installManagedRuntime(component, task) {
  const existing = managedRuntimeInstalled(component);
  if (existing) return existing;
  task.setPhase("java-runtime", `Downloading Java runtime (${component})`);
  const all = await getJson(RUNTIME_MANIFEST_URL, { timeoutMs: 2e4 });
  const forPlatform = all[runtimePlatform()];
  const entries = forPlatform?.[component];
  if (!entries || entries.length === 0) {
    throw new LauncherError("JAVA_NOT_FOUND", `Mojang publishes no "${component}" runtime for ${runtimePlatform()}`, {
      title: "No matching Java runtime is available",
      message: `Mojang does not publish the Java runtime this version needs (${component}) for your platform (${runtimePlatform()}).`,
      actions: [
        "Install a Java runtime yourself, for example Eclipse Temurin",
        "Then point NexusCraft at it in Settings → Java"
      ]
    });
  }
  const files = await getJson(entries[0].manifest.url, { timeoutMs: 2e4 });
  const targetDir = ensureDir(managedRuntimeDir(component));
  const items = [];
  const links = [];
  for (const [relative, entry] of Object.entries(files.files)) {
    const destination = node_path.join(targetDir, ...relative.split("/"));
    if (entry.type === "directory") {
      await promises.mkdir(destination, { recursive: true });
      continue;
    }
    if (entry.type === "link" && entry.target) {
      links.push({ path: destination, target: entry.target });
      continue;
    }
    if (entry.type === "file" && entry.downloads?.raw) {
      items.push({
        url: entry.downloads.raw.url,
        destination,
        sha1: entry.downloads.raw.sha1,
        size: entry.downloads.raw.size,
        executable: entry.executable,
        label: relative
      });
    }
  }
  task.add(items);
  await task.run();
  for (const link of links) {
    try {
      await promises.mkdir(node_path.dirname(link.path), { recursive: true });
      if (!node_fs.existsSync(link.path)) await promises.symlink(link.target, link.path);
    } catch {
    }
  }
  const versionFile = node_path.join(targetDir, ".nexuscraft-version");
  await promises.writeFile(versionFile, entries[0].version.name, "utf8").catch(() => void 0);
  const exe = managedJavaExe(component);
  if (!node_fs.existsSync(exe)) {
    throw new LauncherError("JAVA_NOT_FOUND", `runtime unpacked but ${exe} is missing`);
  }
  detectionCache = null;
  log$A.info(`installed managed runtime ${component} (${entries[0].version.name})`);
  return exe;
}
async function resolveJavaForVersion(version, overridePath, globalPath, installTask) {
  const required = version.javaVersion?.majorVersion ?? inferJavaMajor(version);
  const component = version.javaVersion?.component ?? componentForMajor(required);
  for (const candidate of [overridePath, globalPath]) {
    if (!candidate) continue;
    const probed = await probeJava(candidate);
    if (!probed) {
      throw new LauncherError("JAVA_NOT_FOUND", `configured java path is not usable: ${candidate}`, {
        title: "The configured Java path does not work",
        message: `NexusCraft could not run "${candidate}". The file may have been moved, or it may not be a Java runtime.`,
        actions: ["Clear the Java path in Settings → Java to use automatic selection", "Or pick a different runtime"]
      });
    }
    if (probed.majorVersion < required) {
      throw new LauncherError(
        "JAVA_VERSION_MISMATCH",
        `configured java ${probed.version} is older than the required Java ${required}`,
        {
          title: `This version needs Java ${required}`,
          message: `Minecraft ${version.id} requires Java ${required} or newer, but the runtime you selected is Java ${probed.majorVersion} (${probed.version}).`,
          actions: [
            `Let NexusCraft install Java ${required} automatically`,
            "Or select a newer runtime in Settings → Java"
          ]
        }
      );
    }
    return { path: candidate, majorVersion: probed.majorVersion, installed: false };
  }
  const managed = managedRuntimeInstalled(component);
  if (managed) return { path: managed, majorVersion: required, installed: false };
  const detected = await detectJavaInstallations();
  const exact = detected.find((j) => j.majorVersion === required);
  if (exact) return { path: exact.path, majorVersion: exact.majorVersion, installed: false };
  if (installTask) {
    const path2 = await installManagedRuntime(component, installTask);
    return { path: path2, majorVersion: required, installed: true };
  }
  const newer = detected.find((j) => j.majorVersion > required);
  if (newer && required >= 17) {
    log$A.warn(
      `using Java ${newer.majorVersion} for a version that asks for Java ${required}; the matching runtime is not installed and no download was possible`
    );
    return { path: newer.path, majorVersion: newer.majorVersion, installed: false };
  }
  throw new LauncherError("JAVA_NOT_FOUND", `no Java ${required} runtime available and no install task provided`);
}
function inferJavaMajor(version) {
  const released = version.releaseTime ? Date.parse(version.releaseTime) : NaN;
  if (Number.isFinite(released) && released < Date.parse("2021-06-08")) return 8;
  return 17;
}
function preferWindowless(javaPath) {
  if (!isWindows) return javaPath;
  const candidate = javaPath.replace(/java\.exe$/i, "javaw.exe");
  return node_fs.existsSync(candidate) ? candidate : javaPath;
}
const log$z = createLogger("loaders");
const FABRIC_META$1 = "https://meta.fabricmc.net/v2";
const QUILT_META = "https://meta.quiltmc.org/v3";
const NEOFORGE_MAVEN$1 = "https://maven.neoforged.net/releases";
const NEOFORGE_API$1 = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const FORGE_MAVEN$1 = "https://maven.minecraftforge.net";
const FORGE_PROMOS$1 = "https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
async function fabricVersions(base, minecraftVersion) {
  const entries = await getJson(
    `${base}/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    { timeoutMs: 15e3 }
  );
  return entries.map((entry, index) => ({
    version: entry.loader.version,
    stable: entry.loader.stable,
    // The first stable entry is what the loader's own installer defaults to.
    recommended: index === entries.findIndex((e) => e.loader.stable)
  }));
}
async function neoforgeVersions(minecraftVersion) {
  const data = await getJson(NEOFORGE_API$1, { timeoutMs: 15e3 });
  const parts = minecraftVersion.split(".");
  if (parts[0] !== "1" || parts.length < 2) return [];
  const prefix = `${parts[1]}.${parts[2] ?? "0"}.`;
  const matching = data.versions.filter((v) => v.startsWith(prefix)).reverse();
  return matching.map((version, index) => ({
    version,
    stable: !version.includes("beta"),
    recommended: index === matching.findIndex((v) => !v.includes("beta"))
  }));
}
async function forgeVersions(minecraftVersion) {
  const [xml, promos] = await Promise.all([
    getText(`${FORGE_MAVEN$1}/net/minecraftforge/forge/maven-metadata.xml`, { timeoutMs: 15e3 }),
    getJson(FORGE_PROMOS$1, { timeoutMs: 15e3 }).catch(
      // The promotions file is advisory: losing it costs the "recommended"
      // marker, not the version list itself.
      () => ({ promos: {} })
    )
  ]);
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  const recommended = promos.promos[`${minecraftVersion}-recommended`];
  const latest = promos.promos[`${minecraftVersion}-latest`];
  const matching = all.filter((v) => v.startsWith(`${minecraftVersion}-`)).reverse();
  return matching.map((full) => {
    const build = full.slice(minecraftVersion.length + 1);
    return {
      version: full,
      stable: build === recommended,
      recommended: build === (recommended ?? latest)
    };
  });
}
async function listLoaderVersions(loader, minecraftVersion) {
  try {
    switch (loader) {
      case "fabric":
        return await fabricVersions(FABRIC_META$1, minecraftVersion);
      case "quilt":
        return await fabricVersions(QUILT_META, minecraftVersion);
      case "neoforge":
        return await neoforgeVersions(minecraftVersion);
      case "forge":
        return await forgeVersions(minecraftVersion);
      default:
        return [];
    }
  } catch (err) {
    log$z.warn(`could not list ${loader} versions for ${minecraftVersion}: ${err.message}`);
    return [];
  }
}
async function installFabricLike(base, minecraftVersion, loaderVersion) {
  const profile = await getJson(
    `${base}/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    { timeoutMs: 2e4 }
  );
  if (!profile.id) throw new LauncherError("LOADER_INSTALL_FAILED", "loader profile had no id");
  const dir = ensureDir(versionDir(profile.id));
  await promises.writeFile(node_path.join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2), "utf8");
  log$z.info(`installed loader profile ${profile.id}`);
  return profile.id;
}
async function runInstallerJar(installerUrl, label, task, minecraftVersion) {
  const before = new Set(await listInstalledVersionIds());
  task.setPhase("libraries", `Preparing Minecraft ${minecraftVersion} for ${label}`);
  const vanilla = await installVersion(minecraftVersion, { task, skipAssets: true });
  task.setPhase("loader", `Downloading the ${label} installer`);
  const jarBytes = await getBuffer(installerUrl, { timeoutMs: 12e4, retries: 2 });
  const workDir = node_path.join(node_os.tmpdir(), `nexuscraft-${label.toLowerCase()}-${Date.now()}`);
  await promises.mkdir(workDir, { recursive: true });
  const jarPath = node_path.join(workDir, "installer.jar");
  await promises.writeFile(jarPath, jarBytes);
  const profilesFile = node_path.join(dataRoot(), "launcher_profiles.json");
  if (!node_fs.existsSync(profilesFile)) {
    await promises.writeFile(profilesFile, JSON.stringify({ profiles: {}, version: 3 }, null, 2), "utf8");
  }
  const microsoftStoreFile = node_path.join(dataRoot(), "launcher_profiles_microsoft_store.json");
  if (!node_fs.existsSync(microsoftStoreFile)) {
    await promises.writeFile(microsoftStoreFile, JSON.stringify({ profiles: {}, version: 3 }, null, 2), "utf8");
  }
  const requiredMajor = vanilla.javaVersion?.majorVersion ?? 17;
  const installerMajor = Math.min(requiredMajor, 17);
  const resolveRuntime = async (major) => {
    const component = componentForMajor(major);
    return managedRuntimeInstalled(component) ?? await installManagedRuntime(component, task);
  };
  const runInstaller = async (javaPath) => await new Promise((resolve) => {
    const child = node_child_process.execFile(
      javaPath,
      ["-jar", jarPath, "--installClient", dataRoot()],
      { cwd: workDir, timeout: 9e5, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ ok: !error, output: `${stdout}
${stderr}` });
      }
    );
    child.on("error", (err) => resolve({ ok: false, output: String(err) }));
  });
  try {
    const installerJava = await resolveRuntime(installerMajor);
    task.setPhase("loader", `Running the ${label} installer`);
    log$z.info(`running the ${label} installer on Java ${installerMajor} (${installerJava})`);
    let result = await runInstaller(installerJava);
    if (!result.ok && /UnsupportedClassVersionError|class file version/i.test(result.output)) {
      const fallback = await resolveRuntime(requiredMajor);
      log$z.warn(`${label} installer needs a newer JVM than ${installerMajor}; retrying on Java ${requiredMajor}`);
      result = await runInstaller(fallback);
    }
    if (!result.ok) {
      const detail = explainInstallerFailure(result.output);
      if (/FileAlreadyExistsException/i.test(result.output)) {
        throw new LauncherError("LOADER_INSTALL_FAILED", `${label} installer exited with an error:
${detail}`, {
          title: `The ${label} installer found files already there`,
          message: `${label} ${minecraftVersion} could not be written because some of its files already exist. That usually means two installs ran at once, or an earlier one was interrupted part way through. The loader version is not the problem.`,
          actions: [
            "Try again — if another install was running, it may already have finished the job",
            "If it keeps happening, delete the instance and create it again",
            "Make sure antivirus is not holding files open in the data folder"
          ]
        });
      }
      throw new LauncherError("LOADER_INSTALL_FAILED", `${label} installer exited with an error:
${detail}`, {
        title: `The ${label} installer failed`,
        message: `${label} could not be installed for Minecraft ${minecraftVersion}. This usually means the loader build does not match the Minecraft version, or the installer could not write to the data folder.`,
        actions: [
          `Pick a different ${label} version`,
          "Check that the Minecraft version and loader version go together",
          "Make sure antivirus is not blocking Java from writing files"
        ]
      });
    }
  } finally {
    await promises.rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
  const after = await listInstalledVersionIds();
  const added = after.filter((id2) => !before.has(id2));
  const fresh = added.find((id2) => id2.toLowerCase().includes(label.toLowerCase())) ?? added[0];
  if (fresh) {
    log$z.info(`installed loader profile ${fresh}`);
    return fresh;
  }
  const wanted = after.filter((id2) => id2.toLowerCase().includes(label.toLowerCase())).filter((id2) => id2.includes(minecraftVersion)).sort();
  const existing = wanted[wanted.length - 1];
  if (existing) {
    log$z.info(`${label} was already installed as ${existing}; using it`);
    return existing;
  }
  throw new LauncherError(
    "LOADER_INSTALL_FAILED",
    `${label} installer wrote no version profile for ${minecraftVersion}`,
    {
      title: `The ${label} installer finished without installing anything`,
      message: `The installer ran and reported success, but no ${label} profile for Minecraft ${minecraftVersion} appeared in the versions folder. That usually means it could not write there.`,
      actions: [
        "Check the data folder is writable and not full",
        "Make sure antivirus is not quarantining files as they are written",
        `Try a different ${label} build`
      ]
    }
  );
}
function explainInstallerFailure(output) {
  const lines = output.trim().split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).filter((line) => !/Can.t Find Class/i.test(line)).filter((line) => !/^\s*\S+\.(class|jar|json|txt)\s*$/i.test(line));
  const damning = [
    /^\s*(Caused by|Exception in thread)\b/i,
    /\b[A-Za-z.]*(Exception|Error)\b\s*:/,
    /\b(BUILD FAILED|FAILURE|could not|cannot|unable to|denied|no such file|not found)\b/i,
    /\b(error|failed)\b/i
  ];
  for (const pattern of damning) {
    const hits = lines.filter((line) => pattern.test(line));
    if (hits.length > 0) return hits.slice(-8).join("\n");
  }
  return lines.slice(-12).join("\n");
}
async function installLoader(loader, minecraftVersion, loaderVersion, task) {
  if (loader === "vanilla") return minecraftVersion;
  if (!loaderVersion) {
    const available = await listLoaderVersions(loader, minecraftVersion);
    const chosen = available.find((v) => v.recommended) ?? available.find((v) => v.stable) ?? available[0];
    if (!chosen) {
      throw new LauncherError("LOADER_INSTALL_FAILED", `no ${loader} builds for ${minecraftVersion}`, {
        title: `${loaderLabel$1(loader)} is not available for Minecraft ${minecraftVersion}`,
        message: `No ${loaderLabel$1(loader)} build has been published for Minecraft ${minecraftVersion}.`,
        actions: [
          "Choose a different Minecraft version",
          `Or choose a different mod loader for this instance`
        ]
      });
    }
    loaderVersion = chosen.version;
  }
  task.setPhase("loader", `Installing ${loaderLabel$1(loader)} ${loaderVersion}`);
  switch (loader) {
    case "fabric":
      return await installFabricLike(FABRIC_META$1, minecraftVersion, loaderVersion);
    case "quilt":
      return await installFabricLike(QUILT_META, minecraftVersion, loaderVersion);
    case "neoforge": {
      const url = `${NEOFORGE_MAVEN$1}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
      return await runInstallerJar(url, "NeoForge", task, minecraftVersion);
    }
    case "forge": {
      const full = loaderVersion.startsWith(`${minecraftVersion}-`) ? loaderVersion : `${minecraftVersion}-${loaderVersion}`;
      const url = `${FORGE_MAVEN$1}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
      return await runInstallerJar(url, "Forge", task, minecraftVersion);
    }
    default:
      return minecraftVersion;
  }
}
function loaderLabel$1(loader) {
  switch (loader) {
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "neoforge":
      return "NeoForge";
    case "quilt":
      return "Quilt";
    default:
      return "Vanilla";
  }
}
async function loaderProfileInstalled(versionId) {
  if (!versionId) return false;
  return node_fs.existsSync(node_path.join(versionsRoot(), versionId, `${versionId}.json`));
}
const LAUNCHER_NAME = "NexusCraft";
const LAUNCHER_VERSION = "1.0.0";
const IGNORE_LIST_PREFIX = "-DignoreList=";
function placeholders(context) {
  const { version, instance } = context;
  const assetIndexId = version.assetIndex?.id ?? version.assets ?? "legacy";
  const isLegacyAssets = version.assets === "legacy" || version.assets === "pre-1.6";
  return {
    auth_player_name: context.username,
    version_name: context.versionId,
    game_directory: instance.gameDir,
    assets_root: assetsRoot(),
    game_assets: isLegacyAssets ? node_path.join(assetsRoot(), "virtual", assetIndexId) : assetsRoot(),
    assets_index_name: assetIndexId,
    auth_uuid: context.uuid,
    auth_access_token: context.accessToken,
    auth_session: `token:${context.accessToken}:${context.uuid}`,
    auth_xuid: context.xuid,
    clientid: context.clientId,
    user_type: "msa",
    version_type: version.type ?? "release",
    natives_directory: context.nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: context.classpath.join(node_path.delimiter),
    classpath_separator: node_path.delimiter,
    library_directory: node_path.join(assetsRoot(), "..", "libraries"),
    user_properties: "{}",
    resolution_width: String(instance.window.width),
    resolution_height: String(instance.window.height),
    quickPlayPath: "",
    quickPlaySingleplayer: "",
    quickPlayMultiplayer: context.quickPlayServer ?? "",
    quickPlayRealms: ""
  };
}
function substitute(value, table) {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, key) => table[key] ?? match);
}
function expandArguments(entries, features, table) {
  const out = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      out.push(substitute(entry, table));
      continue;
    }
    if (!evaluateRules(entry.rules, features)) continue;
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    for (const value of values) out.push(substitute(value, table));
  }
  return out;
}
function splitJvmArgs(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
const BLOCKED_USER_JVM_ARGS = [/^-Xmx/i, /^-Xms/i, /^-cp$/i, /^-classpath$/i, /^-jar$/i];
const BLOCKED_WITH_OPERAND = [/^-cp$/i, /^-classpath$/i, /^-jar$/i];
function filterUserJvmArgs(tokens) {
  const kept = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!BLOCKED_USER_JVM_ARGS.some((pattern) => pattern.test(token))) {
      kept.push(token);
      continue;
    }
    if (BLOCKED_WITH_OPERAND.some((pattern) => pattern.test(token))) i++;
  }
  return kept;
}
function keepClientJarOffTheModulePath(jvm, version, versionId) {
  const index = jvm.findIndex((arg) => arg.startsWith(IGNORE_LIST_PREFIX));
  if (index === -1) return;
  const clientJar = `${version.resolvedBaseId ?? version.inheritsFrom ?? versionId}.jar`;
  const entries = jvm[index].slice(IGNORE_LIST_PREFIX.length).split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.includes(clientJar)) return;
  entries.push(clientJar);
  jvm[index] = `${IGNORE_LIST_PREFIX}${entries.join(",")}`;
}
function buildLaunchArguments(context) {
  const { version, instance } = context;
  const table = placeholders(context);
  const features = {
    is_demo_user: false,
    has_custom_resolution: !instance.window.fullscreen,
    has_quick_plays_support: Boolean(context.quickPlayServer),
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: Boolean(context.quickPlayServer),
    is_quick_play_realms: false
  };
  const jvm = [];
  jvm.push(`-Xms${instance.java.minRamMb}M`, `-Xmx${instance.java.maxRamMb}M`);
  if (node_os.platform() === "darwin") jvm.push("-XstartOnFirstThread");
  if (node_os.platform() === "win32") {
    jvm.push("-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump");
  }
  jvm.push(...filterUserJvmArgs(splitJvmArgs(instance.java.jvmArgs)));
  jvm.push(`-Dminecraft.launcher.brand=${LAUNCHER_NAME.toLowerCase()}`);
  jvm.push(`-Dminecraft.launcher.version=${LAUNCHER_VERSION}`);
  const logging = version.logging?.client;
  if (logging?.argument && logging.file?.id) {
    const configPath = node_path.join(assetsRoot(), "log_configs", logging.file.id);
    jvm.push(substitute(logging.argument.replace("${path}", configPath), table));
  }
  if (version.arguments?.jvm && version.arguments.jvm.length > 0) {
    jvm.push(...expandArguments(version.arguments.jvm, features, table));
    keepClientJarOffTheModulePath(jvm, version, context.versionId);
  } else {
    jvm.push(`-Djava.library.path=${context.nativesDir}`);
    jvm.push("-cp", context.classpath.join(node_path.delimiter));
  }
  const game = [];
  if (version.arguments?.game && version.arguments.game.length > 0) {
    game.push(...expandArguments(version.arguments.game, features, table));
  } else if (version.minecraftArguments) {
    game.push(...version.minecraftArguments.split(/\s+/).map((token) => substitute(token, table)));
  }
  if (!instance.window.fullscreen) {
    if (!game.includes("--width")) game.push("--width", String(instance.window.width));
    if (!game.includes("--height")) game.push("--height", String(instance.window.height));
  } else if (!game.includes("--fullscreen")) {
    game.push("--fullscreen");
  }
  if (context.quickPlayServer && !game.includes("--quickPlayMultiplayer")) {
    const supportsQuickPlay = (version.arguments?.game ?? []).some(
      (entry) => typeof entry !== "string" && JSON.stringify(entry.value).includes("quickPlayMultiplayer")
    );
    if (supportsQuickPlay) {
      game.push("--quickPlayMultiplayer", context.quickPlayServer);
    } else {
      const [host, port] = splitAddress(context.quickPlayServer);
      game.push("--server", host, "--port", String(port));
    }
  }
  const args = [...jvm, version.mainClass, ...game];
  const safeArgs = args.map(
    (arg) => context.accessToken && arg.includes(context.accessToken) ? arg.replace(context.accessToken, "[redacted]") : arg
  );
  return { args, safeArgs, mainClass: version.mainClass };
}
function splitAddress(address) {
  const trimmed = address.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) return [bracketed[1], bracketed[2] ? Number(bracketed[2]) : 25565];
  const index = trimmed.lastIndexOf(":");
  if (index > 0 && !trimmed.slice(0, index).includes(":")) {
    const port = Number(trimmed.slice(index + 1));
    if (Number.isInteger(port) && port > 0 && port <= 65535) return [trimmed.slice(0, index), port];
  }
  return [trimmed, 25565];
}
const LOADER_NAMES = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt"
};
function readTomlValue(toml, key) {
  const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)')`, "m"));
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim() || null;
}
function parseFabricJson(text) {
  try {
    const json = JSON.parse(text);
    const minecraft = json.depends?.minecraft;
    const declared = (json.environment ?? "").toLowerCase();
    const environment = declared === "client" ? "client" : declared === "server" ? "server" : "both";
    return {
      modId: json.id ?? null,
      environment,
      name: json.name ?? json.id ?? "Unknown mod",
      version: json.version ?? null,
      description: json.description ?? null,
      authors: (json.authors ?? []).map((a) => typeof a === "string" ? a : a.name ?? "").filter(Boolean),
      loaders: ["fabric"],
      mcVersionRange: Array.isArray(minecraft) ? minecraft.join(", ") : minecraft ?? null,
      loaderVersionRange: null,
      iconPath: typeof json.icon === "string" ? json.icon : Object.values(json.icon ?? {})[0] ?? null
    };
  } catch {
    return null;
  }
}
function parseQuiltJson(text) {
  try {
    const json = JSON.parse(text);
    const loader = json.quilt_loader;
    if (!loader) return null;
    const minecraft = loader.depends?.find((d) => d.id === "minecraft");
    const quiltEnv = (json.minecraft?.environment ?? "").toLowerCase();
    return {
      modId: loader.id ?? null,
      environment: quiltEnv === "client" ? "client" : quiltEnv === "dedicated_server" ? "server" : "both",
      name: loader.metadata?.name ?? loader.id ?? "Unknown mod",
      version: loader.version ?? null,
      description: loader.metadata?.description ?? null,
      authors: Object.keys(loader.metadata?.contributors ?? {}),
      // Quilt can load Fabric mods, and most Quilt mods ship a Fabric entry too.
      loaders: ["quilt", "fabric"],
      mcVersionRange: minecraft?.versions ?? null,
      loaderVersionRange: null,
      iconPath: loader.metadata?.icon ?? null
    };
  } catch {
    return null;
  }
}
function parseModsToml(text, loader) {
  const modsBlock = text.split(/\[\[mods\]\]/)[1] ?? text;
  const modId = readTomlValue(modsBlock, "modId");
  const mcRange = text.match(/modId\s*=\s*"minecraft"[\s\S]{0,300}?versionRange\s*=\s*"([^"]*)"/)?.[1] ?? null;
  const side = (readTomlValue(modsBlock, "side") ?? "").toUpperCase();
  return {
    modId,
    environment: side === "CLIENT" ? "client" : side === "SERVER" ? "server" : "both",
    name: readTomlValue(modsBlock, "displayName") ?? modId ?? "Unknown mod",
    version: readTomlValue(modsBlock, "version"),
    description: readTomlValue(modsBlock, "description"),
    authors: (readTomlValue(modsBlock, "authors") ?? "").split(/,\s*/).map((a) => a.trim()).filter(Boolean),
    loaders: [loader],
    mcVersionRange: mcRange,
    // What the mod asks of the loader itself, e.g. "[65,)".
    loaderVersionRange: text.match(/loaderVersion\s*=\s*"([^"]*)"/)?.[1] ?? null,
    iconPath: readTomlValue(modsBlock, "logoFile")
  };
}
function parseLegacyMcmod(text) {
  try {
    const parsed = JSON.parse(text);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed.modList?.[0] ?? null;
    if (!entry) return null;
    return {
      modId: entry.modid ?? null,
      name: entry.name ?? entry.modid ?? "Unknown mod",
      version: entry.version ?? null,
      description: entry.description ?? null,
      authors: (entry.authorList ?? []).filter(Boolean),
      loaders: ["forge"],
      environment: "both",
      mcVersionRange: entry.mcversion ?? null,
      loaderVersionRange: null,
      iconPath: entry.logoFile ?? null
    };
  } catch {
    return null;
  }
}
function parseModManifest(manifests) {
  const found = [];
  if (manifests.fabric) {
    const parsed = parseFabricJson(manifests.fabric);
    if (parsed) found.push(parsed);
  }
  if (manifests.quilt) {
    const parsed = parseQuiltJson(manifests.quilt);
    if (parsed) found.push(parsed);
  }
  if (manifests.neoforge) found.push(parseModsToml(manifests.neoforge, "neoforge"));
  if (manifests.forge) {
    const parsed = parseModsToml(manifests.forge, "forge");
    parsed.loaders = ["forge", "neoforge"];
    found.push(parsed);
  }
  if (manifests.legacy) {
    const parsed = parseLegacyMcmod(manifests.legacy);
    if (parsed) found.push(parsed);
  }
  if (found.length === 0) return null;
  const best = found[0];
  const loaders = [...new Set(found.flatMap((entry) => entry.loaders))];
  const sides = found.map((entry) => entry.environment);
  const environment = sides.every((side) => side === "client") ? "client" : sides.every((side) => side === "server") ? "server" : "both";
  return { ...best, loaders, environment };
}
function loaderAccepts(instanceLoader, modLoaders, hasConnector = false) {
  if (modLoaders.length === 0) return "maybe";
  if (modLoaders.includes(instanceLoader)) return "yes";
  if (instanceLoader === "quilt" && modLoaders.includes("fabric")) return "yes";
  if (hasConnector && instanceLoader === "forge" && modLoaders.includes("fabric")) return "yes";
  if (instanceLoader === "neoforge" && modLoaders.includes("forge") || instanceLoader === "forge" && modLoaders.includes("neoforge")) {
    return "maybe";
  }
  return "no";
}
function versionSatisfies(version, range) {
  const trimmed = range.trim();
  if (!trimmed || trimmed === "*") return true;
  const isMaven = /^[[(]/.test(trimmed);
  if (!isMaven && /[\s,]/.test(trimmed)) {
    const clauses = trimmed.split(/[\s,]+/).filter(Boolean);
    if (clauses.length > 1) return clauses.every((clause) => versionSatisfies(version, clause));
  }
  if (/^[><=~^]/.test(trimmed)) {
    const operator = trimmed.match(/^[><=~^]+/)?.[0] ?? "";
    const target = trimmed.slice(operator.length).trim();
    const comparison = compareVersions(version, target);
    switch (operator) {
      case ">=":
        return comparison >= 0;
      case ">":
        return comparison > 0;
      case "<=":
        return comparison <= 0;
      case "<":
        return comparison < 0;
      case "=":
      case "==":
        return comparison === 0;
      case "~":
      case "^":
        return version.split(".").slice(0, 2).join(".") === target.split(".").slice(0, 2).join(".");
      default:
        return true;
    }
  }
  const maven = trimmed.match(/^([[(])\s*([^,\])]*)\s*,\s*([^,\])]*)\s*([\])])$/);
  if (maven) {
    const [, openBracket, lower, upper, closeBracket] = maven;
    if (lower) {
      const cmp = compareVersions(version, lower);
      if (openBracket === "[" ? cmp < 0 : cmp <= 0) return false;
    }
    if (upper) {
      const cmp = compareVersions(version, upper);
      if (closeBracket === "]" ? cmp > 0 : cmp >= 0) return false;
    }
    return true;
  }
  if (trimmed.includes("x") || trimmed.includes("*")) {
    const prefix = trimmed.replace(/[.*x]+$/, "");
    return version.startsWith(prefix);
  }
  return trimmed === version || true;
}
function compareVersions(a, b) {
  const parse = (v) => v.split(/[.\-+]/).map((part) => Number.parseInt(part, 10)).map((n) => Number.isFinite(n) ? n : 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
const log$y = createLogger("mods");
const DISABLED_SUFFIX$1 = ".disabled";
function modsDir(instance) {
  return instanceSubdir(instance, "mods");
}
function lowestVersionIn(range) {
  if (!range) return null;
  const found = range.match(/(\d+)/);
  return found ? Number(found[1]) : null;
}
function majorVersionOf(version) {
  if (!version) return null;
  const ownPart = version.includes("-") ? version.slice(version.lastIndexOf("-") + 1) : version;
  const found = ownPart.match(/(\d+)/);
  return found ? Number(found[1]) : null;
}
function instanceTarget(instance) {
  return {
    dir: modsDir(instance),
    loader: instance.loader,
    minecraftVersion: instance.minecraftVersion,
    loaderVersion: instance.loaderVersion,
    description: "this instance"
  };
}
const jarCache = /* @__PURE__ */ new Map();
const JAR_CACHE_LIMIT = 2e3;
function readModJarCached(jarPath) {
  let key;
  try {
    const info = node_fs.statSync(jarPath);
    key = { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return readModJar(jarPath);
  }
  const seen = jarCache.get(jarPath);
  if (seen && seen.size === key.size && seen.mtimeMs === key.mtimeMs) return seen.result;
  const result = readModJar(jarPath);
  if (jarCache.size >= JAR_CACHE_LIMIT) {
    const oldest = jarCache.keys().next().value;
    if (oldest !== void 0) jarCache.delete(oldest);
  }
  jarCache.set(jarPath, { ...key, result });
  return result;
}
function readModJar(jarPath) {
  try {
    const zip = new AdmZip(jarPath);
    const read = (name) => {
      const entry = zip.getEntry(name);
      return entry ? entry.getData().toString("utf8") : null;
    };
    const metadata = parseModManifest({
      fabric: read("fabric.mod.json"),
      quilt: read("quilt.mod.json"),
      neoforge: read("META-INF/neoforge.mods.toml"),
      forge: read("META-INF/mods.toml"),
      legacy: read("mcmod.info")
    });
    let iconDataUrl = null;
    if (metadata?.iconPath) {
      const entry = zip.getEntry(metadata.iconPath);
      const data = entry?.getData();
      if (data && data.byteLength > 0 && data.byteLength < 512 * 1024) {
        const ext = node_path.extname(metadata.iconPath).toLowerCase();
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
        iconDataUrl = `data:${mime};base64,${data.toString("base64")}`;
      }
    }
    return { metadata, iconDataUrl, unreadable: false };
  } catch (err) {
    log$y.warn(`could not read ${node_path.basename(jarPath)}: ${err.message}`);
    return { metadata: null, iconDataUrl: null, unreadable: true };
  }
}
async function analyseMods(instance) {
  return await analyseModsIn(instanceTarget(instance));
}
async function analyseModsIn(target) {
  const dir = target.dir;
  let entries;
  try {
    entries = (await promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
  const mods = [];
  const hasConnector = target.loader === "forge" && entries.some((name) => /^connector[-_]|^sinytra/i.test(name) && name.endsWith(".jar"));
  for (const fileName of entries) {
    const enabled = !fileName.endsWith(DISABLED_SUFFIX$1);
    const bare = enabled ? fileName : fileName.slice(0, -DISABLED_SUFFIX$1.length);
    if (!bare.toLowerCase().endsWith(".jar")) {
      if (/\.(zip|litemod|txt)$/i.test(bare)) {
        const full2 = node_path.join(dir, fileName);
        mods.push({
          path: full2,
          fileName,
          modId: null,
          name: bare,
          version: null,
          description: null,
          authors: [],
          loaders: [],
          environment: null,
          mcVersionRange: null,
          enabled,
          sizeBytes: await promises.stat(full2).then((s) => s.size).catch(() => 0),
          iconDataUrl: null,
          issues: [
            {
              severity: "warning",
              code: "not-a-jar",
              message: "This file is not a .jar, so Minecraft will ignore it."
            }
          ]
        });
      }
      continue;
    }
    const full = node_path.join(dir, fileName);
    const { metadata, iconDataUrl, unreadable } = readModJarCached(full);
    const issues = [];
    if (unreadable) {
      issues.push({
        severity: "warning",
        code: "unreadable",
        message: "This jar could not be opened. It may be corrupt or still downloading."
      });
    } else if (!metadata) {
      issues.push({
        severity: "warning",
        code: "unreadable",
        message: "No mod metadata was found in this jar. It may be a library rather than a mod."
      });
    }
    if (metadata && enabled) {
      const verdict = loaderAccepts(target.loader, metadata.loaders, hasConnector);
      if (verdict === "no") {
        issues.push({
          severity: "error",
          code: "loader-mismatch",
          message: `This is a ${metadata.loaders.map((l) => LOADER_NAMES[l]).join("/")} mod, but ${target.description} runs ${LOADER_NAMES[target.loader]}.`
        });
      } else if (verdict === "maybe" && metadata.loaders.length > 0) {
        issues.push({
          severity: "warning",
          code: "loader-mismatch",
          message: `Built for ${metadata.loaders.map((l) => LOADER_NAMES[l]).join("/")}; it may or may not run on ${LOADER_NAMES[target.loader]}.`
        });
      }
      if (metadata.mcVersionRange && !versionSatisfies(target.minecraftVersion, metadata.mcVersionRange)) {
        issues.push({
          severity: "warning",
          code: "mc-version-mismatch",
          message: `Declares support for ${metadata.mcVersionRange}, but ${target.description} is Minecraft ${target.minecraftVersion}.`
        });
      }
      const needsLoader = lowestVersionIn(metadata.loaderVersionRange);
      const haveLoader = majorVersionOf(target.loaderVersion);
      if (needsLoader !== null && haveLoader !== null && haveLoader < needsLoader) {
        issues.push({
          severity: "error",
          code: "loader-version-too-old",
          message: `Needs ${target.loader} ${needsLoader} or newer, but ${target.description} runs ${target.loaderVersion}. This is usually a jar built for a later Minecraft version — look for the build that matches.`
        });
      }
    }
    mods.push({
      path: full,
      fileName,
      modId: metadata?.modId ?? null,
      name: metadata?.name ?? bare.replace(/\.jar$/i, ""),
      version: metadata?.version ?? null,
      description: metadata?.description ?? null,
      authors: metadata?.authors ?? [],
      loaders: metadata?.loaders ?? [],
      environment: metadata?.environment ?? null,
      mcVersionRange: metadata?.mcVersionRange ?? null,
      enabled,
      sizeBytes: await promises.stat(full).then((s) => s.size).catch(() => 0),
      iconDataUrl,
      issues
    });
  }
  const byModId = /* @__PURE__ */ new Map();
  for (const mod of mods) {
    if (!mod.modId || !mod.enabled) continue;
    const list = byModId.get(mod.modId) ?? [];
    list.push(mod);
    byModId.set(mod.modId, list);
  }
  for (const [modId, duplicates] of byModId) {
    if (duplicates.length < 2) continue;
    for (const mod of duplicates) {
      mod.issues.push({
        severity: "error",
        code: "duplicate-mod-id",
        message: `Another enabled mod also provides "${modId}" (${duplicates.filter((d) => d !== mod).map((d) => d.fileName).join(", ")}). Keep only one.`
      });
    }
  }
  mods.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  return mods;
}
async function setModEnabled(instance, fileName, enabled) {
  await setModEnabledIn(modsDir(instance), fileName, enabled);
}
async function setModEnabledIn(dir, fileName, enabled) {
  const current = assertInside(dir, node_path.join(dir, fileName));
  if (!node_fs.existsSync(current)) throw new LauncherError("NOT_FOUND", "that mod file no longer exists");
  const isDisabled = fileName.endsWith(DISABLED_SUFFIX$1);
  if (enabled === !isDisabled) return;
  const nextName = enabled ? fileName.slice(0, -DISABLED_SUFFIX$1.length) : fileName + DISABLED_SUFFIX$1;
  const next = assertInside(dir, node_path.join(dir, nextName));
  await renameWhenFree(current, next);
  log$y.info(`${enabled ? "enabled" : "disabled"} ${nextName}`);
}
async function deleteMod(instance, fileName) {
  await deleteModIn(modsDir(instance), fileName);
}
async function deleteModIn(dir, fileName) {
  const target = assertInside(dir, node_path.join(dir, fileName));
  await promises.rm(target, { force: true });
  log$y.info(`removed mod ${fileName}`);
}
async function importMods(instance, files) {
  return await importModsIn(modsDir(instance), files);
}
async function importModsIn(dir, files) {
  await promises.mkdir(dir, { recursive: true });
  let imported = 0;
  for (const file2 of files) {
    if (!/\.(jar)$/i.test(file2)) continue;
    const target = node_path.join(dir, node_path.basename(file2));
    let final = target;
    let counter = 1;
    while (node_fs.existsSync(final)) {
      final = node_path.join(dir, `${node_path.basename(file2, ".jar")} (${counter}).jar`);
      counter++;
    }
    try {
      await promises.copyFile(file2, final);
      imported++;
    } catch (err) {
      log$y.warn(`could not import ${file2}: ${err.message}`);
    }
  }
  return imported;
}
const run$1 = node_util.promisify(node_child_process.execFile);
const log$x = createLogger("vram");
function estimateGameMb(hasShaders, renderDistance) {
  const base = hasShaders ? 2600 : 900;
  return Math.round(base + Math.max(0, renderDistance - 8) * 60);
}
async function readNvidia() {
  try {
    const { stdout } = await run$1(
      "nvidia-smi",
      ["--query-gpu=memory.total,memory.used", "--format=csv,noheader,nounits"],
      { timeout: 4e3, windowsHide: true }
    );
    const line = stdout.trim().split(/\r?\n/)[0];
    if (!line) return null;
    const [total, used] = line.split(",").map((value) => Number(value.trim()));
    if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
    return { totalMb: total, usedMb: used };
  } catch {
    return null;
  }
}
async function readLoadedModel() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/ps", {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    const body = await response.json();
    const loaded = (body.models ?? [])[0];
    if (!loaded?.name) return null;
    const bytes = loaded.size_vram ?? loaded.size ?? 0;
    return { name: loaded.name, mb: Math.round(bytes / (1024 * 1024)) };
  } catch {
    return null;
  }
}
async function checkVramBudget(options) {
  const gameMb = estimateGameMb(options.hasShaders, options.renderDistance);
  const [gpu, model] = await Promise.all([readNvidia(), readLoadedModel()]);
  const report = {
    totalMb: gpu?.totalMb ?? null,
    usedMb: gpu?.usedMb ?? null,
    modelMb: model?.mb ?? null,
    modelName: model?.name ?? null,
    gameMb,
    tight: false,
    advice: null
  };
  if (gpu === null) return report;
  const freeMb = gpu.totalMb - gpu.usedMb;
  const headroomMb = 400;
  if (gameMb + headroomMb <= freeMb) return report;
  report.tight = true;
  if (model) {
    const wouldFit = gameMb + headroomMb <= freeMb + model.mb;
    report.advice = wouldFit ? `${model.name} is holding ${model.mb} MB of your ${gpu.totalMb} MB card. This instance wants about ${gameMb} MB and there is ${freeMb} MB free. A smaller model, or letting this one unload, would clear it.` : `${model.name} is holding ${model.mb} MB and this instance wants about ${gameMb} MB, which is more than the ${gpu.totalMb} MB card has either way. Turning shaders down is the bigger saving of the two.`;
  } else {
    report.advice = `This instance wants about ${gameMb} MB and only ${freeMb} MB of the ${gpu.totalMb} MB card is free. Something else is using it.`;
  }
  log$x.info(`vram tight: free=${freeMb}MB game≈${gameMb}MB model=${model?.mb ?? 0}MB`);
  return report;
}
const log$w = createLogger("crash");
const KNOWN = [
  {
    test: /UnsatisfiedLinkError|Failed to locate library|Failed to load a library|LWJGL/i,
    explanation: "Minecraft could not load its native graphics libraries. The files it needs were missing from the folder this version expects them in.",
    actions: [
      'Press "Repair instance" — this re-extracts the native libraries',
      "If it persists, check that antivirus is not quarantining .dll files"
    ]
  },
  {
    test: /OutOfMemoryError|Could not reserve enough space|unable to create native thread/i,
    explanation: "The game ran out of memory. Either the heap is too small for what is loaded, or too much was allocated for the system to provide.",
    actions: [
      "Edit the instance and raise the maximum memory a step",
      "If it is already high, lower it — over-allocating starves Windows and makes this worse",
      "Modpacks with large worlds need more than vanilla"
    ]
  },
  {
    /*
     * Leaving a server takes the client down with it.
     *
     * On logout Forge unloads mod configs, and a config that was synced from
     * the server is held in memory rather than backed by a file. `ModConfig.save`
     * casts it to the file-backed type without checking, so the disconnect that
     * should have returned you to the menu ends in a crash report instead. The
     * world is already saved by then, which is why this looks alarming and costs
     * nothing.
     */
    test: /SimpleCommentedConfig cannot be cast|nightconfig.*ClassCastException|ClassCastException.*nightconfig/i,
    explanation: "The game crashed while disconnecting, not while playing. Forge tried to save a config that the server had sent it, which is held in memory and has no file to be saved to. Your world and everything in it were already saved before this happened.",
    actions: [
      "Nothing is lost — this happens after the world is saved",
      "It comes from Forge Config API Port, which is installed because another mod asks for it",
      "Find the mod that needs it on the Mods screen; removing both stops the crash",
      "Or leave it: the only symptom is the crash report on the way out"
    ]
  },
  {
    test: /Mixin apply failed|MixinApplyError|Mixin transformation of/i,
    explanation: "A mod tried to patch game code that did not look the way it expected. This nearly always means a mod does not match this Minecraft version, or two mods are patching the same thing.",
    actions: [
      "Open the Mods screen and check for version warnings",
      "Disable the mod named in the report and launch again",
      "Update the mod to a build made for this Minecraft version"
    ]
  },
  {
    test: /java\.lang\.UnsupportedClassVersionError|has been compiled by a more recent version/i,
    explanation: "A mod or library was built for a newer Java version than the runtime being used to launch.",
    actions: [
      "Let NexusCraft pick the Java runtime automatically (clear any override in Settings → Java)",
      "Or install the Java version this Minecraft release expects"
    ]
  },
  {
    test: /Pixel format not accelerated|Couldn't set pixel format|WGL|GLFW error|Failed to create window|OpenGL/i,
    explanation: "The graphics driver refused to give Minecraft the display mode it asked for. This is a driver problem rather than a launcher one.",
    actions: [
      "Update your graphics drivers",
      "If you have both integrated and discrete graphics, force Minecraft onto the discrete card",
      "Close any overlay software (recording, FPS counters) and retry"
    ]
  },
  {
    test: /Duplicate mods|ModResolutionException|Incompatible mod set|missing dependenc/i,
    explanation: "The mod loader refused to start because the installed mods do not fit together.",
    actions: [
      "Open the Mods screen — conflicts and duplicates are flagged there",
      "Remove one of each duplicated mod",
      "Install any dependency the report names"
    ]
  },
  {
    test: /Access is denied|java\.io\.FileNotFoundException|AccessDeniedException/i,
    explanation: "Minecraft could not read or write a file it needed, usually because another program has it locked.",
    actions: [
      "Make sure the game is not already running",
      "Add the NexusCraft data folder to your antivirus exclusions",
      'Press "Repair instance" to restore anything damaged'
    ]
  }
];
async function diagnoseCrash(instance, since) {
  const empty = {
    reportPath: null,
    cause: null,
    description: null,
    explanation: null,
    actions: [],
    excerpt: null
  };
  const dir = node_path.join(instance.gameDir, "crash-reports");
  let newest = null;
  try {
    for (const name of await promises.readdir(dir)) {
      if (!name.endsWith(".txt")) continue;
      const full = node_path.join(dir, name);
      const info = await promises.stat(full);
      if (info.mtimeMs + 5e3 < since) continue;
      if (!newest || info.mtimeMs > newest.at) newest = { path: full, at: info.mtimeMs };
    }
  } catch {
    return empty;
  }
  if (!newest) return empty;
  let text;
  try {
    text = await promises.readFile(newest.path, "utf8");
  } catch {
    return empty;
  }
  const description = text.match(/^Description:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const cause = text.match(/^(?:[a-z][\w.]*\.)+[A-Z]\w*(?:Error|Exception)[^\n]*/m)?.[0]?.trim() ?? text.match(/^Caused by:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const haystack = `${description ?? ""}
${cause ?? ""}
${text.slice(0, 4e3)}`;
  const known = KNOWN.find((entry) => entry.test.test(haystack));
  const excerpt = text.split(/\r?\n/).slice(0, 40).join("\n").slice(0, 1800);
  log$w.info(`crash report parsed: ${description ?? "no description"} / ${cause ?? "no cause"}`);
  return {
    reportPath: newest.path,
    cause,
    description,
    explanation: known?.explanation ?? null,
    actions: known?.actions ?? [],
    excerpt
  };
}
const log$v = createLogger("launch");
const running$3 = /* @__PURE__ */ new Map();
const states = /* @__PURE__ */ new Map();
const MAX_LOG_LINES = 2e3;
function setState$2(instanceId, stage, message, extra = {}) {
  const state = {
    instanceId,
    stage,
    message,
    pid: null,
    startedAt: null,
    exitCode: null,
    crashReport: null,
    crash: null,
    ...states.get(instanceId),
    ...extra
  };
  state.stage = stage;
  state.message = message;
  states.set(instanceId, state);
  emit("launch:state", state);
  void updatePresenceFromLaunch(state);
}
function launchStates() {
  return [...states.values()];
}
function isRunning(instanceId) {
  return running$3.has(instanceId);
}
function recentLogs(instanceId, limit = 500) {
  const game = running$3.get(instanceId);
  if (game) return game.logs.slice(-limit);
  return (lastLogs.get(instanceId) ?? []).slice(-limit);
}
const lastLogs = /* @__PURE__ */ new Map();
function pushLog(game, stream2, text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const entry = { instanceId: game.instanceId, stream: stream2, line: redact(line), at: Date.now() };
    game.logs.push(entry);
    if (game.logs.length > MAX_LOG_LINES) game.logs.shift();
    if (/Exception|Error|Caused by:|FATAL|Mixin apply failed|incompatible/i.test(line) && game.crashHints.length < 40) {
      game.crashHints.push(line);
    }
    emit("launch:log", entry);
  }
}
async function launchInstance(options) {
  const { instanceId } = options;
  if (running$3.has(instanceId)) {
    throw new LauncherError("ALREADY_RUNNING", `instance ${instanceId} already has a running process`);
  }
  const settings = getSettings();
  const instance = getInstance(instanceId);
  setState$2(instanceId, "preparing", "Preparing your instance", { exitCode: null, crashReport: null });
  await ensureInstanceLayout(instance);
  const account = getActiveAccount();
  if (!account) {
    throw new LauncherError("TOKEN_EXPIRED", "no active account", {
      title: "Sign in to play",
      message: "Minecraft: Java Edition needs a signed-in Microsoft account that owns the game.",
      actions: ['Press "Sign in with Microsoft" on the Account screen']
    });
  }
  if (!account.ownsMinecraft) {
    throw new LauncherError("NO_MINECRAFT_ENTITLEMENT", "active account has no entitlement");
  }
  const task = createTask({ instanceId, concurrency: settings.maxConcurrentDownloads, label: "Preparing" });
  try {
    let versionId = instance.resolvedVersionId;
    if (!versionId || !await loaderProfileInstalled(versionId)) {
      if (instance.loader === "vanilla") {
        versionId = instance.minecraftVersion;
      } else {
        setState$2(instanceId, "downloading", "Installing the mod loader");
        versionId = await installLoader(instance.loader, instance.minecraftVersion, instance.loaderVersion, task);
      }
      updateInstance(instanceId, { resolvedVersionId: versionId });
    }
    setState$2(instanceId, "verifying", "Checking game files");
    let version = await resolveVersion(versionId);
    const check = await verifyInstallation(versionId).catch(() => ({ missing: ["everything"], version }));
    if (check.missing.length > 0 || !instance.installed) {
      setState$2(instanceId, "downloading", "Downloading game files");
      version = await installVersion(versionId, { task });
      updateInstance(instanceId, { installed: true });
    }
    if (instance.loader !== "vanilla") {
      const analysis = await analyseMods(instance);
      const blocking = analysis.filter(
        (mod) => mod.enabled && mod.issues.some((issue) => issue.severity === "error" && issue.code !== "unreadable")
      );
      if (blocking.length > 0) {
        const names = blocking.slice(0, 5).map((m) => m.fileName).join(", ");
        throw new LauncherError(
          "MOD_CONFLICT",
          blocking.map((m) => `${m.fileName}: ${m.issues.map((i) => i.message).join("; ")}`).join("\n"),
          {
            title: `${blocking.length} mod${blocking.length === 1 ? "" : "s"} would crash this instance`,
            message: `These mods do not match this instance and Minecraft would fail on startup: ${names}${blocking.length > 5 ? ", …" : ""}`,
            actions: [
              "Open the Mods screen to see what is wrong with each one",
              "Disable or remove the flagged mods",
              "Then press Play again"
            ]
          }
        );
      }
    }
    try {
      const shaderDir = instanceSubdir(instance, "shaderpacks");
      const hasShaders = node_fs.existsSync(shaderDir) && (await promises.readdir(shaderDir)).some((f) => f.endsWith(".zip"));
      const vram = await checkVramBudget({ hasShaders, renderDistance: 16 });
      if (vram.tight && vram.advice) {
        toast("warning", "Your graphics card may be short on memory", vram.advice);
      }
    } catch (err) {
      log$v.debug(`vram check skipped: ${err.message}`);
    }
    setState$2(instanceId, "resolving-java", "Selecting a Java runtime");
    const java = await resolveJavaForVersion(version, instance.java.javaPath, settings.javaPath, task);
    setState$2(instanceId, "building-args", "Building launch options");
    await ensureNativesExtracted(versionId, version);
    const classpath = buildClasspath(versionId, version);
    if (classpath.length === 0) {
      throw new LauncherError("MISSING_LIBRARIES", "classpath resolved to nothing");
    }
    const missingLibraries = classpath.filter((entry) => !node_fs.existsSync(entry));
    if (missingLibraries.length > 0) {
      throw new LauncherError("MISSING_LIBRARIES", `missing: ${missingLibraries.slice(0, 8).join(", ")}`);
    }
    const accessToken = await getValidMinecraftToken(account.id);
    const built = buildLaunchArguments({
      instance,
      version,
      versionId,
      classpath,
      nativesDir: nativesDir(versionId),
      accessToken,
      username: account.username,
      uuid: account.id,
      xuid: account.xuid ?? "",
      clientId: settings.clientId,
      quickPlayServer: options.serverAddress ?? null
    });
    await promises.writeFile(
      node_path.join(instance.gameDir, "logs", "nexuscraft-last-launch.txt"),
      [`java: ${java.path}`, `version: ${versionId}`, "", ...built.safeArgs].join("\n"),
      "utf8"
    ).catch(() => void 0);
    setState$2(instanceId, "starting", "Starting Minecraft");
    const executable = preferWindowless(java.path);
    log$v.info(`launching ${instance.name} (${versionId}) with ${executable}`);
    const child = node_child_process.spawn(executable, built.args, {
      cwd: instance.gameDir,
      // Its own process group, so quitting the launcher — or a Ctrl+C aimed at
      // it — never takes a running game down with it.
      detached: true,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, APPDATA: process.env.APPDATA }
    });
    const game = {
      instanceId,
      gameDir: instance.gameDir,
      child,
      startedAt: Date.now(),
      logs: [],
      crashHints: []
    };
    running$3.set(instanceId, game);
    child.stdout?.on("data", (chunk) => pushLog(game, "stdout", chunk.toString("utf8")));
    child.stderr?.on("data", (chunk) => pushLog(game, "stderr", chunk.toString("utf8")));
    child.on("error", (err) => {
      running$3.delete(instanceId);
      log$v.error("failed to start the game process", err);
      setState$2(instanceId, "error", "Minecraft could not be started", { pid: null });
      toast("error", "Minecraft could not be started", err.message);
    });
    child.on("exit", (code, signal) => handleExit(game, code, signal));
    pushLog(game, "launcher", `Started ${instance.name} (${versionId}) — pid ${child.pid}`);
    setState$2(instanceId, "running", "Minecraft is running", { pid: child.pid ?? null, startedAt: game.startedAt });
    task.markDone();
    if (settings.closeLauncherOnLaunch) {
      for (const window of electron.BrowserWindow.getAllWindows()) window.minimize();
    }
    return states.get(instanceId);
  } catch (err) {
    task.cancel();
    const message = err instanceof LauncherError ? err.message : "Launch failed";
    setState$2(instanceId, "error", message);
    throw err;
  }
}
async function redactCrashDumps(gameDir) {
  let entries;
  try {
    entries = await promises.readdir(gameDir);
  } catch {
    return;
  }
  const dumps = entries.filter((name) => /^(hs_err_pid|replay_pid).*\.log$/i.test(name));
  for (const name of dumps) {
    const file2 = node_path.join(gameDir, name);
    try {
      const text = await promises.readFile(file2, "utf8");
      const cleaned = text.replace(/(--accessToken\s+)\S+/g, "$1[redacted]").replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted token]");
      if (cleaned !== text) {
        await promises.writeFile(file2, cleaned, "utf8");
        log$v.info(`removed the access token from ${name}`);
      }
    } catch (err) {
      log$v.warn(`could not scrub ${name}: ${err.message}`);
    }
  }
}
function handleExit(game, code, signal) {
  const { instanceId } = game;
  running$3.delete(instanceId);
  lastLogs.set(instanceId, game.logs);
  const duration = Date.now() - game.startedAt;
  recordPlaySession(instanceId, duration);
  const clean = code === 0 || signal === "SIGTERM" || signal === "SIGKILL";
  const crashReport = clean ? null : game.crashHints.slice(0, 12).join("\n") || null;
  const looksLikeACrash = !clean && game.crashHints.length > 0;
  void redactCrashDumps(game.gameDir);
  log$v.info(`instance ${instanceId} exited with code ${code ?? "null"} signal ${signal ?? "none"}`);
  pushLog(game, "launcher", `Minecraft exited with code ${code ?? "unknown"}`);
  setState$2(instanceId, "exited", looksLikeACrash ? "Minecraft closed unexpectedly" : "Minecraft closed", {
    pid: null,
    exitCode: code,
    crashReport
  });
  const announce2 = (crash) => {
    if (!looksLikeACrash) return;
    const detail = crash?.explanation ?? `Exit code ${code ?? "unknown"}. Open the log for details.`;
    toast("error", crash?.description ?? "Minecraft closed unexpectedly", detail);
    notifyDesktop({
      title: "Minecraft crashed",
      body: crash?.explanation ?? "The game closed unexpectedly. Open NexusCraft to see what went wrong."
    });
  };
  const instance = !clean ? findInstance(instanceId) : null;
  if (instance) {
    void diagnoseCrash(instance, game.startedAt).then((crash) => {
      if (!crash.reportPath) {
        announce2(null);
        return;
      }
      pushLog(game, "launcher", `Crash report: ${crash.description ?? crash.cause ?? "see crash-reports"}`);
      setState$2(instanceId, "exited", "Minecraft closed unexpectedly", {
        pid: null,
        exitCode: code,
        crashReport,
        crash
      });
      announce2(crash);
    }).catch((err) => {
      log$v.warn("could not read the crash report:", err.message);
      announce2(null);
    });
  } else {
    announce2(null);
  }
  const settings = getSettings();
  if (settings.restoreOnGameExit) {
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      if (window.isMinimized()) window.restore();
      window.show();
      window.moveTop();
      window.focus();
    }
  }
}
function stopInstance(instanceId) {
  const game = running$3.get(instanceId);
  if (!game) return;
  log$v.info(`stopping instance ${instanceId}`);
  game.child.kill("SIGTERM");
  setTimeout(() => {
    if (running$3.has(instanceId)) {
      log$v.warn(`instance ${instanceId} ignored SIGTERM; killing`);
      game.child.kill("SIGKILL");
    }
  }, 5e3);
}
function stopAll() {
  for (const instanceId of [...running$3.keys()]) stopInstance(instanceId);
}
function runningInstanceIds() {
  return [...running$3.keys()];
}
const log$u = createLogger("mod-updates");
const SETTINGS_KEY$3 = "mod-update-settings";
const DEFAULTS$3 = {
  mode: "notify",
  everyHours: 12,
  reviewRisky: true,
  lastCheck: null
};
function modUpdateSettings() {
  const raw = db().kvGet(SETTINGS_KEY$3);
  if (!raw) return { ...DEFAULTS$3 };
  try {
    return { ...DEFAULTS$3, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS$3 };
  }
}
function setModUpdateSettings(patch) {
  const next = { ...modUpdateSettings(), ...patch };
  next.everyHours = Math.min(Math.max(Math.round(next.everyHours), 1), 168);
  db().kvSet(SETTINGS_KEY$3, JSON.stringify(next));
  reschedule$2();
  return next;
}
function isRisky(update) {
  return Boolean(update.majorJump) || Boolean(update.versionType) && update.versionType !== "release";
}
let checking = false;
async function sweepForModUpdates(reason) {
  const settings = modUpdateSettings();
  const sweep = { checked: 0, skipped: 0, found: 0, installed: 0, heldBack: 0 };
  if (checking) {
    log$u.info("a check is already running; skipping this one");
    return sweep;
  }
  checking = true;
  try {
    for (const instance of listInstances()) {
      if (isRunning(instance.id)) {
        sweep.skipped += 1;
        continue;
      }
      let updates = [];
      try {
        updates = await checkModUpdates(instance);
      } catch (err) {
        log$u.warn(`could not check ${instance.name}: ${err.message}`);
        continue;
      }
      sweep.checked += 1;
      if (updates.length === 0) continue;
      sweep.found += updates.length;
      if (settings.mode !== "install") continue;
      const safe = settings.reviewRisky ? updates.filter((update) => !isRisky(update)) : updates;
      sweep.heldBack += updates.length - safe.length;
      for (const update of safe) {
        try {
          await applyModUpdate(instance, update);
          sweep.installed += 1;
        } catch (err) {
          log$u.warn(`could not update ${update.fileName}: ${err.message}`);
        }
      }
    }
    setModUpdateSettings({ lastCheck: Date.now() });
    log$u.info(
      `${reason}: checked ${sweep.checked} instance(s), ${sweep.found} update(s), ${sweep.installed} installed, ${sweep.heldBack} held for review`
    );
    return sweep;
  } finally {
    checking = false;
  }
}
function announce(sweep) {
  if (sweep.found === 0) return;
  const mods = `${sweep.found} mod${sweep.found === 1 ? "" : "s"}`;
  if (sweep.installed > 0) {
    const held = sweep.heldBack > 0 ? ` ${sweep.heldBack} held back for review.` : "";
    toast(
      "success",
      `Updated ${sweep.installed} mod${sweep.installed === 1 ? "" : "s"}`,
      `Every update can be undone from Mods & Packs.${held}`
    );
    notifyDesktop({
      title: "Mods updated",
      body: `${sweep.installed} updated automatically.${held}`
    });
    return;
  }
  toast("info", `${mods} have updates`, "Open Mods & Packs to review and install them.");
  notifyDesktop({ title: "Mod updates available", body: `${mods} have a newer version.` });
}
let timer = null;
function clearTimer$2() {
  if (timer) clearInterval(timer);
  timer = null;
}
async function run(reason) {
  try {
    const sweep = await sweepForModUpdates(reason);
    emit("mods:updateSweep", sweep);
    announce(sweep);
  } catch (err) {
    log$u.warn(`sweep failed: ${err.message}`);
  }
}
function reschedule$2() {
  clearTimer$2();
  const settings = modUpdateSettings();
  if (settings.mode === "off") {
    log$u.info("automatic mod update checks are off");
    return;
  }
  const every = settings.everyHours * 36e5;
  const next = setInterval(() => void run("scheduled check"), every);
  next.unref();
  timer = next;
  log$u.info(`checking for mod updates every ${settings.everyHours}h (${settings.mode})`);
}
function initModUpdateScheduler() {
  reschedule$2();
  const settings = modUpdateSettings();
  if (settings.mode === "off") return;
  const due = settings.lastCheck === null || Date.now() - settings.lastCheck >= settings.everyHours * 36e5;
  if (!due) {
    log$u.info("last check was recent; waiting for the next interval");
    return;
  }
  const first = setTimeout(() => void run("startup check"), 2 * 6e4);
  first.unref();
}
const log$t = createLogger("upnp");
const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const DISCOVERY_MS = 4e3;
const WAN_SERVICES = [
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1"
];
function likelyRouters() {
  const found = /* @__PURE__ */ new Set();
  for (const entry of Object.values(node_os.networkInterfaces()).flat()) {
    if (!entry || entry.family !== "IPv4" || entry.internal) continue;
    const address = entry.address.split(".").map(Number);
    const mask = entry.netmask.split(".").map(Number);
    if (address.length !== 4 || mask.length !== 4) continue;
    const network = address.map((octet, index) => octet & mask[index]);
    network[3] += 1;
    found.add(network.join("."));
  }
  return [...found];
}
async function findGatewayLocation() {
  const interfaces = Object.values(node_os.networkInterfaces()).flat().filter((entry) => Boolean(entry) && entry.family === "IPv4" && !entry.internal).map((entry) => entry.address);
  const sources = [void 0, ...interfaces];
  const routers = likelyRouters();
  return await new Promise((resolve) => {
    const sockets = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
        }
      }
      resolve(value);
    };
    const search = (target) => Buffer.from(
      `M-SEARCH * HTTP/1.1\r
HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r
MAN: "ssdp:discover"\r
MX: 2\r
ST: ${target}\r
\r
`
    );
    for (const address of sources) {
      const socket = node_dgram.createSocket({ type: "udp4", reuseAddr: true });
      sockets.push(socket);
      socket.on("error", () => {
        try {
          socket.close();
        } catch {
        }
      });
      socket.on("message", (message) => {
        const text = message.toString();
        const location = /LOCATION:\s*(\S+)/i.exec(text);
        if (!location) return;
        const server2 = /SERVER:\s*(.+)/i.exec(text);
        finish({ location: location[1], server: (server2?.[1] ?? "").trim() });
      });
      try {
        socket.bind(address ? { address, port: 0 } : { port: 0 }, () => {
          const targets = [
            "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
            ...WAN_SERVICES
          ];
          for (const target of targets) {
            try {
              socket.send(search(target), SSDP_PORT, SSDP_ADDRESS);
            } catch {
            }
            for (const router of routers) {
              try {
                socket.send(search(target), SSDP_PORT, router);
              } catch {
              }
            }
          }
        });
      } catch {
      }
    }
    setTimeout(() => finish(null), DISCOVERY_MS);
  });
}
async function fetchText(url, timeoutMs = 5e3) {
  return await new Promise((resolve, reject) => {
    const req = node_http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("the router did not answer in time"));
    });
  });
}
async function discoverGateway() {
  const found = await findGatewayLocation();
  if (!found) return null;
  let description;
  try {
    description = await fetchText(found.location);
  } catch (err) {
    log$t.warn(`found a UPnP gateway but could not read its description: ${err.message}`);
    return null;
  }
  for (const serviceType of WAN_SERVICES) {
    for (const block of description.split(/<service>/i).slice(1)) {
      if (!block.includes(serviceType)) continue;
      const control = /<controlURL>([^<]+)<\/controlURL>/i.exec(block);
      if (!control) continue;
      return {
        controlUrl: new node_url.URL(control[1].trim(), found.location).toString(),
        serviceType,
        routerAddress: new node_url.URL(found.location).hostname,
        description: found.server || "UPnP router"
      };
    }
  }
  return null;
}
function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function callService(gateway, action, args = []) {
  const payload = args.map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join("");
  const envelope = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gateway.serviceType}">${payload}</u:${action}></s:Body></s:Envelope>`;
  const url = new node_url.URL(gateway.controlUrl);
  return await new Promise((resolve, reject) => {
    const req = node_http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPAction: `"${gateway.serviceType}#${action}"`,
          "Content-Length": Buffer.byteLength(envelope)
        }
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => body += chunk);
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.setTimeout(8e3, () => {
      req.destroy();
      reject(new Error("the router did not answer in time"));
    });
    req.end(envelope);
  });
}
function faultReason(body) {
  const described = /<errorDescription>([^<]+)</i.exec(body);
  if (described) return described[1];
  const code = /<errorCode>([^<]+)</i.exec(body);
  return code ? `the router refused it (UPnP error ${code[1]})` : "the router refused it";
}
async function externalAddress(gateway) {
  try {
    const { body } = await callService(gateway, "GetExternalIPAddress");
    const found = /<NewExternalIPAddress>([^<]*)</i.exec(body);
    const address = found?.[1]?.trim();
    return address ? address : null;
  } catch {
    return null;
  }
}
async function existingMapping(gateway, port) {
  try {
    const { status: status2, body } = await callService(gateway, "GetSpecificPortMappingEntry", [
      ["NewRemoteHost", ""],
      ["NewExternalPort", String(port)],
      ["NewProtocol", "TCP"]
    ]);
    if (status2 !== 200) return null;
    const client2 = /<NewInternalClient>([^<]*)</i.exec(body);
    return client2?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
async function openPort(gateway, port, internalAddress, label) {
  const { status: status2, body } = await callService(gateway, "AddPortMapping", [
    ["NewRemoteHost", ""],
    ["NewExternalPort", String(port)],
    ["NewProtocol", "TCP"],
    ["NewInternalPort", String(port)],
    ["NewInternalClient", internalAddress],
    ["NewEnabled", "1"],
    ["NewPortMappingDescription", label.slice(0, 60)],
    ["NewLeaseDuration", String(PORT_LEASE_SECONDS)]
  ]);
  if (status2 === 200) return;
  const retry = await callService(gateway, "AddPortMapping", [
    ["NewRemoteHost", ""],
    ["NewExternalPort", String(port)],
    ["NewProtocol", "TCP"],
    ["NewInternalPort", String(port)],
    ["NewInternalClient", internalAddress],
    ["NewEnabled", "1"],
    ["NewPortMappingDescription", label.slice(0, 60)],
    ["NewLeaseDuration", "0"]
  ]);
  if (retry.status === 200) return;
  throw new LauncherError("NETWORK_ERROR", `could not open port ${port}: ${faultReason(body)}`, {
    title: "The router would not open the port",
    message: `Your router answered, but refused to forward port ${port}. ${faultReason(body)}.`,
    actions: [
      "Check UPnP is enabled in the router settings",
      "Another device may already be using that port — try a different one",
      "Forward the port by hand in the router if it will not do it automatically"
    ]
  });
}
async function closePort(gateway, port) {
  try {
    const { status: status2 } = await callService(gateway, "DeletePortMapping", [
      ["NewRemoteHost", ""],
      ["NewExternalPort", String(port)],
      ["NewProtocol", "TCP"]
    ]);
    return status2 === 200;
  } catch (err) {
    log$t.warn(`could not close port ${port}: ${err.message}`);
    return false;
  }
}
const PORT_LEASE_SECONDS = 43200;
const renewals = /* @__PURE__ */ new Map();
function keepPortOpen(port, internalAddress, label) {
  stopKeepingPortOpen(port);
  const timer2 = setInterval(
    () => {
      void (async () => {
        const gateway = await discoverGateway();
        if (!gateway) {
          log$t.warn(`could not renew the mapping for port ${port}: no gateway answered`);
          return;
        }
        try {
          await openPort(gateway, port, internalAddress, label);
          log$t.info(`renewed the port ${port} mapping`);
        } catch (err) {
          log$t.warn(`could not renew the mapping for port ${port}: ${err.message}`);
        }
      })();
    },
    PORT_LEASE_SECONDS / 3 * 1e3
  );
  timer2.unref();
  renewals.set(port, timer2);
}
function stopKeepingPortOpen(port) {
  const timer2 = renewals.get(port);
  if (timer2) clearInterval(timer2);
  renewals.delete(port);
}
async function forwardingStatus(port, internalAddress) {
  const gateway = await discoverGateway();
  if (!gateway) {
    return {
      available: false,
      open: false,
      externalAddress: null,
      router: null,
      reason: "No router on this network offered to forward ports. UPnP is often switched off by default — it can usually be turned on in the router settings."
    };
  }
  const [external, mappedTo] = await Promise.all([
    externalAddress(gateway),
    existingMapping(gateway, port)
  ]);
  return {
    available: true,
    open: mappedTo === internalAddress,
    externalAddress: external,
    router: gateway.description,
    reason: null
  };
}
function writeVarInt(value) {
  const bytes = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 127;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 128;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}
function writeString(value) {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([writeVarInt(data.length), data]);
}
function readVarInt(buffer, offset = 0) {
  let value = 0;
  let size = 0;
  for (; ; ) {
    if (offset + size >= buffer.length) return null;
    const byte = buffer[offset + size];
    value |= (byte & 127) << 7 * size;
    size++;
    if ((byte & 128) === 0) break;
    if (size > 5) return null;
  }
  return { value: value >>> 0, size };
}
function packet(id2, ...payload) {
  const body = Buffer.concat([writeVarInt(id2), ...payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
function flattenDescription(value, depth = 0) {
  if (depth > 12) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => flattenDescription(v, depth + 1)).join("");
  if (value && typeof value === "object") {
    const node = value;
    const own = node.text ?? node.translate ?? "";
    const extra = (node.extra ?? []).map((v) => flattenDescription(v, depth + 1)).join("");
    return `${own}${extra}`;
  }
  return "";
}
function stripFormatting(text) {
  return text.replace(/§[0-9a-fk-orA-FK-OR]/g, "");
}
async function resolveServerAddress(host, port) {
  if (port !== 25565) return { host, port };
  try {
    const records = await promises$2.resolveSrv(`_minecraft._tcp.${host}`);
    if (records.length > 0) {
      const best = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
      return { host: best.name, port: best.port };
    }
  } catch {
  }
  return { host, port };
}
async function pingServer(rawHost, rawPort, timeoutMs = 5e3) {
  const { host, port } = await resolveServerAddress(rawHost, rawPort);
  return await new Promise((resolve) => {
    const socket = new node_net.Socket();
    let buffer = Buffer.alloc(0);
    let statusReceived = false;
    let pingSentAt = 0;
    let settled = false;
    let result = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const fail = (message) => finish({ online: false, error: message });
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => fail("The server did not respond in time."));
    socket.on("error", (err) => {
      const code = err.code;
      switch (code) {
        case "ENOTFOUND":
          fail("That address could not be found.");
          break;
        case "ECONNREFUSED":
          fail("The server refused the connection.");
          break;
        case "ETIMEDOUT":
          fail("The server did not respond in time.");
          break;
        case "ECONNRESET":
          fail("The server closed the connection.");
          break;
        default:
          fail("Could not reach the server.");
      }
    });
    socket.on("close", () => {
      if (!settled && result) finish(result);
      else if (!settled) fail("The connection closed before a reply arrived.");
    });
    socket.connect(port, host, () => {
      const handshake = packet(
        0,
        // -1 asks the server to reply without caring about our version.
        writeVarInt(4294967295),
        writeString(host),
        (() => {
          const portBuffer = Buffer.alloc(2);
          portBuffer.writeUInt16BE(port);
          return portBuffer;
        })(),
        writeVarInt(1)
        // next state: status
      );
      socket.write(handshake);
      socket.write(packet(0));
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (; ; ) {
        const length = readVarInt(buffer);
        if (!length) return;
        if (buffer.length < length.size + length.value) return;
        const body = buffer.subarray(length.size, length.size + length.value);
        buffer = buffer.subarray(length.size + length.value);
        const packetId = readVarInt(body);
        if (!packetId) return;
        const payload = body.subarray(packetId.size);
        if (packetId.value === 0 && !statusReceived) {
          statusReceived = true;
          const stringLength = readVarInt(payload);
          if (!stringLength) return fail("The server sent a malformed status reply.");
          const json = payload.subarray(stringLength.size, stringLength.size + stringLength.value).toString("utf8");
          let status2;
          try {
            status2 = JSON.parse(json);
          } catch {
            return fail("The server sent a status reply that could not be read.");
          }
          const motd = stripFormatting(flattenDescription(status2.description)).trim();
          const favicon = typeof status2.favicon === "string" && status2.favicon.startsWith("data:image/png;base64,") ? status2.favicon.slice(0, 2e5) : null;
          result = {
            online: true,
            latencyMs: null,
            versionName: status2.version?.name ?? null,
            protocol: status2.version?.protocol ?? null,
            playersOnline: typeof status2.players?.online === "number" ? status2.players.online : null,
            playersMax: typeof status2.players?.max === "number" ? status2.players.max : null,
            motd: motd.length > 0 ? motd.slice(0, 300) : null,
            faviconDataUrl: favicon
          };
          pingSentAt = Date.now();
          const payloadBuffer = Buffer.alloc(8);
          payloadBuffer.writeBigInt64BE(BigInt(pingSentAt));
          socket.write(packet(1, payloadBuffer));
          continue;
        }
        if (packetId.value === 1 && result) {
          result.latencyMs = Date.now() - pingSentAt;
          return finish(result);
        }
      }
    });
  });
}
const log$s = createLogger("server-software");
const PAPER_API = "https://fill.papermc.io/v3/projects";
const PURPUR_API = "https://api.purpurmc.org/v2/purpur";
const FABRIC_META = "https://meta.fabricmc.net/v2";
const FORGE_MAVEN = "https://maven.minecraftforge.net";
const FORGE_PROMOS = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases";
const NEOFORGE_API = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const SOFTWARE = [
  {
    id: "vanilla",
    label: "Vanilla",
    blurb: "Mojang's own server. No plugins or mods, exactly the game as shipped.",
    plugins: false,
    mods: false
  },
  {
    id: "paper",
    label: "Paper",
    blurb: "The usual choice. Much faster than vanilla and runs Bukkit and Spigot plugins.",
    plugins: true,
    mods: false
  },
  {
    id: "purpur",
    label: "Purpur",
    blurb: "Paper with a large set of extra gameplay toggles. Runs the same plugins.",
    plugins: true,
    mods: false
  },
  {
    id: "fabric",
    label: "Fabric",
    blurb: "Lightweight mod loader. Players need the same mods installed to join.",
    plugins: false,
    mods: true
  },
  {
    id: "forge",
    label: "Forge",
    blurb: "The long-established mod loader, used by most big modpacks.",
    plugins: false,
    mods: true
  },
  {
    id: "neoforge",
    label: "NeoForge",
    blurb: "The actively developed fork of Forge. Covers 1.20.2 onwards.",
    plugins: false,
    mods: true
  }
];
function softwareLabel(id2) {
  return SOFTWARE.find((s) => s.id === id2)?.label ?? id2;
}
function unsupported(software, minecraftVersion, detail) {
  return new LauncherError("NOT_FOUND", `${software} has no build for ${minecraftVersion}: ${detail}`, {
    title: `${softwareLabel(software)} does not support Minecraft ${minecraftVersion}`,
    message: `The ${softwareLabel(software)} project has not published a server build for that Minecraft version.`,
    actions: ["Pick a different Minecraft version", "Or choose different server software"]
  });
}
async function provision(software, minecraftVersion, vanillaServerUrl) {
  switch (software) {
    case "vanilla": {
      if (!vanillaServerUrl) throw unsupported("vanilla", minecraftVersion, "Mojang publishes no server jar");
      return { url: vanillaServerUrl, fileName: "server.jar", softwareVersion: minecraftVersion, isInstaller: false };
    }
    case "paper":
      return await provisionPaper(minecraftVersion);
    case "purpur":
      return await provisionPurpur(minecraftVersion);
    case "fabric":
      return await provisionFabric(minecraftVersion);
    case "forge":
      return await provisionForge(minecraftVersion);
    case "neoforge":
      return await provisionNeoForge(minecraftVersion);
    default:
      throw new LauncherError("INVALID_INPUT", `unknown server software "${software}"`);
  }
}
async function provisionPaper(minecraftVersion) {
  let builds;
  try {
    builds = await getJson(`${PAPER_API}/paper/versions/${minecraftVersion}/builds`, {
      timeoutMs: 3e4
    });
  } catch (err) {
    throw unsupported("paper", minecraftVersion, err.message);
  }
  const chosen = builds.find((b) => b.channel === "STABLE") ?? builds[0];
  const download = chosen?.downloads?.["server:default"];
  if (!download?.url) throw unsupported("paper", minecraftVersion, "no server download in the build list");
  return {
    url: download.url,
    fileName: "server.jar",
    softwareVersion: `build ${chosen.id}`,
    isInstaller: false,
    size: download.size ?? null
  };
}
async function provisionPurpur(minecraftVersion) {
  let data;
  try {
    data = await getJson(`${PURPUR_API}/${minecraftVersion}`, { timeoutMs: 3e4 });
  } catch (err) {
    throw unsupported("purpur", minecraftVersion, err.message);
  }
  const build = data.builds?.latest;
  if (!build) throw unsupported("purpur", minecraftVersion, "no builds listed");
  return {
    url: `${PURPUR_API}/${minecraftVersion}/${build}/download`,
    fileName: "server.jar",
    softwareVersion: `build ${build}`,
    isInstaller: false
  };
}
async function provisionFabric(minecraftVersion) {
  const [loaders, installers] = await Promise.all([
    getJson(
      `${FABRIC_META}/versions/loader/${minecraftVersion}`,
      { timeoutMs: 3e4 }
    ).catch(() => []),
    getJson(`${FABRIC_META}/versions/installer`, { timeoutMs: 3e4 })
  ]);
  const loader = loaders.find((l) => l.loader.stable)?.loader.version ?? loaders[0]?.loader.version;
  if (!loader) throw unsupported("fabric", minecraftVersion, "no loader versions for this Minecraft version");
  const installer = installers.find((i) => i.stable)?.version ?? installers[0]?.version;
  if (!installer) throw unsupported("fabric", minecraftVersion, "no installer versions published");
  return {
    url: `${FABRIC_META}/versions/loader/${minecraftVersion}/${loader}/${installer}/server/jar`,
    fileName: "server.jar",
    softwareVersion: `loader ${loader}`,
    isInstaller: false
  };
}
async function provisionForge(minecraftVersion) {
  const promos = await getJson(FORGE_PROMOS, { timeoutMs: 3e4 });
  const build = promos.promos[`${minecraftVersion}-recommended`] ?? promos.promos[`${minecraftVersion}-latest`] ?? null;
  if (!build) throw unsupported("forge", minecraftVersion, "not in the Forge promotions list");
  const full = `${minecraftVersion}-${build}`;
  return {
    url: `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
    fileName: "installer.jar",
    softwareVersion: build,
    isInstaller: true
  };
}
async function provisionNeoForge(minecraftVersion) {
  const data = await getJson(NEOFORGE_API, { timeoutMs: 3e4 });
  const parts = minecraftVersion.split(".");
  const prefix = parts[0] === "1" && parts.length >= 2 ? `${parts[1]}.${parts[2] ?? "0"}.` : `${parts.slice(0, 2).join(".")}.`;
  const matching = data.versions.filter((v) => v.startsWith(prefix) && !v.includes("beta"));
  const chosen = matching[matching.length - 1] ?? data.versions.filter((v) => v.startsWith(prefix)).pop();
  if (!chosen) throw unsupported("neoforge", minecraftVersion, "no matching version line");
  return {
    url: `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${chosen}/neoforge-${chosen}-installer.jar`,
    fileName: "installer.jar",
    softwareVersion: chosen,
    isInstaller: true
  };
}
async function runServerInstaller(dir, installerJar, requiredMajor, task) {
  const resolveRuntime = async (major) => {
    const component = componentForMajor(major);
    return managedRuntimeInstalled(component) ?? await installManagedRuntime(component, task);
  };
  const run2 = async (javaPath) => await new Promise((resolve) => {
    node_child_process.execFile(
      javaPath,
      ["-jar", installerJar, "--installServer"],
      { cwd: dir, timeout: 9e5, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}
${stderr}` })
    );
  });
  const installerMajor = Math.min(requiredMajor, 17);
  task.setPhase("loader", "Running the server installer");
  let result = await run2(await resolveRuntime(installerMajor));
  if (!result.ok && /UnsupportedClassVersionError|class file version/i.test(result.output)) {
    log$s.warn(`server installer needs a newer JVM than ${installerMajor}; retrying on Java ${requiredMajor}`);
    result = await run2(await resolveRuntime(requiredMajor));
  }
  if (!result.ok) {
    const tail = result.output.trim().split("\n").slice(-6).join("\n");
    throw new LauncherError("LOADER_INSTALL_FAILED", `server installer failed: ${tail}`, {
      title: "The mod loader installer did not finish",
      message: "The official installer ran but reported a failure.",
      actions: ["Try a different Minecraft version", "Or use Paper if you only need plugins"]
    });
  }
  log$s.info("server installer finished");
}
async function launchPlan(dir, software) {
  if (software !== "forge" && software !== "neoforge") {
    return { args: ["-jar", "server.jar", "--nogui"] };
  }
  const argsFile = await findArgsFile(dir, software);
  if (argsFile) {
    const userArgs = node_path.join(dir, "user_jvm_args.txt");
    if (!node_fs.existsSync(userArgs)) {
      await promises.writeFile(userArgs, "# JVM arguments are set by the launcher.\n", "utf8");
    }
    return { args: [`@${argsFile}`, "--nogui"] };
  }
  const jar = (await promises.readdir(dir)).find((f) => /^(forge|neoforge).*\.jar$/i.test(f) && !/installer/i.test(f));
  if (jar) return { args: ["-jar", jar, "--nogui"] };
  throw new LauncherError("NOT_FOUND", "the installer left nothing runnable behind", {
    title: "Could not work out how to start this server",
    message: "The mod loader installer finished but produced neither an argument file nor a server jar.",
    actions: ["Try a different Minecraft version", "Or use Paper if you only need plugins"]
  });
}
async function findArgsFile(dir, software) {
  const vendor = software === "forge" ? "net/minecraftforge/forge" : "net/neoforged/neoforge";
  const base = node_path.join(dir, "libraries", ...vendor.split("/"));
  if (!node_fs.existsSync(base)) return null;
  for (const version of await promises.readdir(base)) {
    for (const candidate of ["win_args.txt", "unix_args.txt"]) {
      const relative = `libraries/${vendor}/${version}/${candidate}`;
      if (node_fs.existsSync(node_path.join(dir, ...relative.split("/")))) return relative;
    }
  }
  return null;
}
const log$r = createLogger("host");
const MAX_CONSOLE_LINES = 500;
const STOP_GRACE_MS = 2e4;
const MINECRAFT_EULA_URL = "https://aka.ms/MinecraftEULA";
function hostedServersRoot() {
  return node_path.join(dataRoot(), "servers");
}
function hostedServerDir(id2) {
  return node_path.join(hostedServersRoot(), id2);
}
function needsInstall(server2) {
  if (server2.installedVersion !== server2.minecraftVersion) return true;
  const dir = hostedServerDir(server2.id);
  if (server2.software === "forge" || server2.software === "neoforge") {
    return !node_fs.existsSync(node_path.join(dir, "libraries"));
  }
  return !node_fs.existsSync(node_path.join(dir, "server.jar"));
}
function listServerSoftware() {
  return SOFTWARE;
}
const running$2 = /* @__PURE__ */ new Map();
function blankState$2(id2) {
  return { id: id2, status: "stopped", detail: "", players: [], pid: null, startedAt: null, address: "" };
}
function getHostedServerState(id2) {
  const base = running$2.get(id2)?.state ?? blankState$2(id2);
  const server2 = listHostedServers().find((entry) => entry.id === id2);
  return { ...base, address: server2 ? connectAddress(server2) : base.address };
}
function allHostedServerStates() {
  return listHostedServers().map((server2) => getHostedServerState(server2.id));
}
function getHostedServerConsole(id2) {
  return [...running$2.get(id2)?.console ?? []];
}
function isHostedServerRunning(id2) {
  return running$2.has(id2);
}
const lifecycleListeners = /* @__PURE__ */ new Set();
function onHostedServerEvent(listener) {
  lifecycleListeners.add(listener);
  return () => lifecycleListeners.delete(listener);
}
function notifyLifecycle(event, serverId, player) {
  for (const listener of lifecycleListeners) {
    try {
      listener(event, serverId, player);
    } catch (err) {
      log$r.warn(`a hosted-server listener threw: ${err.message}`);
    }
  }
}
function setState$1(id2, patch) {
  const entry = running$2.get(id2);
  const next = { ...entry?.state ?? blankState$2(id2), ...patch };
  if (entry) entry.state = next;
  emit("host:state", next);
}
function pushConsole(id2, text, stream2) {
  const entry = running$2.get(id2);
  if (!entry) return;
  const line = { id: ++entry.lineId, serverId: id2, at: Date.now(), text, stream: stream2 };
  entry.console.push(line);
  if (entry.console.length > MAX_CONSOLE_LINES) entry.console.shift();
  emit("host:console", line);
}
function listHostedServers() {
  return db().all(Collections.hostedServers).sort((a, b) => (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0) || a.name.localeCompare(b.name));
}
function getHostedServer(id2) {
  const server2 = db().get(Collections.hostedServers, id2);
  if (!server2) throw new LauncherError("NOT_FOUND", `hosted server ${id2} does not exist`);
  return server2;
}
function clampMemory(mb) {
  if (!Number.isFinite(mb)) return 2048;
  return Math.max(512, Math.min(16384, Math.round(mb)));
}
function clampPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new LauncherError("INVALID_INPUT", `port ${port} is out of range`, {
      title: "That port will not work",
      message: "Pick a port between 1024 and 65535. The Minecraft default is 25565.",
      actions: ["Use 25565 unless something else already has it"]
    });
  }
  return port;
}
function saveHostedServer(input) {
  const name = input.name.trim();
  if (!name) {
    throw new LauncherError("INVALID_INPUT", "a server needs a name", {
      title: "Give the server a name",
      message: "It is only used to tell your servers apart in the launcher."
    });
  }
  const port = clampPort(input.port);
  const clash = listHostedServers().find((s) => s.id !== input.id && s.port === port);
  if (clash) {
    throw new LauncherError("INVALID_INPUT", `port ${port} is already used by ${clash.name}`, {
      title: "That port is already taken",
      message: `Your server "${clash.name}" is set to port ${port}.`,
      actions: ["Pick a different port, for example 25566"]
    });
  }
  const existing = input.id ? getHostedServer(input.id) : null;
  if (existing && isHostedServerRunning(existing.id)) {
    throw new LauncherError("ALREADY_RUNNING", "cannot reconfigure a running server", {
      title: "Stop the server first",
      message: "Settings are written when the server starts, so they cannot change while it is running.",
      actions: ["Press Stop, change the settings, then Start again"]
    });
  }
  const record = {
    id: existing?.id ?? node_crypto.randomUUID(),
    name,
    minecraftVersion: input.minecraftVersion,
    software: input.software,
    // Cleared when the software or version changes, so a stale build is never claimed.
    softwareVersion: existing && existing.software === input.software && existing.minecraftVersion === input.minecraftVersion ? existing.softwareVersion : null,
    port,
    onlineMode: input.onlineMode,
    reachability: input.reachability,
    memoryMb: clampMemory(input.memoryMb),
    motd: input.motd.slice(0, 59),
    difficulty: input.difficulty,
    gameMode: input.gameMode,
    maxPlayers: Math.max(1, Math.min(100, Math.round(input.maxPlayers))),
    allowCheats: input.allowCheats,
    operators: [...new Set(input.operators.map((name2) => name2.trim()).filter(Boolean))],
    /*
     * World and gameplay settings, each falling back to what a fresh Minecraft
     * server would use so a server saved before these existed is unchanged by
     * being opened and saved again.
     */
    levelSeed: (input.levelSeed ?? existing?.levelSeed ?? "").trim().slice(0, 120),
    pvp: input.pvp ?? existing?.pvp ?? true,
    hardcore: input.hardcore ?? existing?.hardcore ?? false,
    allowFlight: input.allowFlight ?? existing?.allowFlight ?? false,
    spawnProtection: clampWhole(input.spawnProtection ?? existing?.spawnProtection ?? 16, 0, 256),
    viewDistance: clampWhole(input.viewDistance ?? existing?.viewDistance ?? 10, 3, 32),
    simulationDistance: clampWhole(input.simulationDistance ?? existing?.simulationDistance ?? 10, 3, 32),
    spawnMonsters: input.spawnMonsters ?? existing?.spawnMonsters ?? true,
    spawnAnimals: input.spawnAnimals ?? existing?.spawnAnimals ?? true,
    whitelist: input.whitelist ?? existing?.whitelist ?? false,
    // Accepting the EULA is a separate, explicit act — never carried in on a save.
    eulaAcceptedAt: existing?.eulaAcceptedAt ?? null,
    installedVersion: existing && existing.software === input.software && existing.minecraftVersion === input.minecraftVersion ? existing.installedVersion : null,
    createdAt: existing?.createdAt ?? Date.now(),
    lastStartedAt: existing?.lastStartedAt ?? null
  };
  db().put(Collections.hostedServers, record.id, record);
  emit("host:changed", listHostedServers());
  log$r.info(`${existing ? "updated" : "created"} hosted server ${record.name} (${record.minecraftVersion})`);
  return record;
}
async function deleteHostedServer(id2, deleteWorld2) {
  if (isHostedServerRunning(id2)) await stopHostedServer(id2);
  const server2 = getHostedServer(id2);
  db().remove(Collections.hostedServers, id2);
  if (deleteWorld2) await promises.rm(hostedServerDir(id2), { recursive: true, force: true });
  emit("host:changed", listHostedServers());
  log$r.info(`deleted hosted server ${server2.name}${deleteWorld2 ? " and its files" : ""}`);
}
async function acceptEula(id2) {
  const server2 = getHostedServer(id2);
  const dir = ensureDir(hostedServerDir(id2));
  const accepted = Date.now();
  await promises.writeFile(
    node_path.join(dir, "eula.txt"),
    [
      "# Accepted through the NexusCraft Launcher.",
      `# ${MINECRAFT_EULA_URL}`,
      `# Accepted at ${new Date(accepted).toISOString()}`,
      "eula=true",
      ""
    ].join("\n"),
    "utf8"
  );
  const next = { ...server2, eulaAcceptedAt: accepted };
  db().put(Collections.hostedServers, next.id, next);
  emit("host:changed", listHostedServers());
  log$r.info(`EULA accepted for ${server2.name}`);
  return next;
}
async function installHostedServer(id2) {
  const server2 = getHostedServer(id2);
  const dir = ensureDir(hostedServerDir(id2));
  setState$1(id2, { status: "installing", detail: `Fetching Minecraft ${server2.minecraftVersion}…` });
  const version = await ensureVersionJson(server2.minecraftVersion);
  const label = softwareLabel(server2.software);
  setState$1(id2, { status: "installing", detail: `Working out which ${label} build to use…` });
  const plan = await provision(server2.software, server2.minecraftVersion, version.downloads?.server?.url ?? null);
  const task = createTask({ label: `Installing ${server2.name}`, phase: "libraries" });
  task.add([
    {
      url: plan.url,
      destination: node_path.join(dir, plan.fileName),
      // Only Mojang publishes a hash for its jar; the other projects do not
      // expose one on the download endpoint, so size is the only check there.
      // Mojang publishes a sha1; the other projects publish sha256 or nothing,
      // and the download manager verifies sha1, so size is the check there.
      sha1: server2.software === "vanilla" ? version.downloads?.server?.sha1 ?? null : null,
      size: server2.software === "vanilla" ? version.downloads?.server?.size ?? null : plan.size ?? null,
      label: `${label} ${plan.softwareVersion}`
    }
  ]);
  await task.run();
  const settings = getSettings();
  const javaTask = createTask({ label: "Java runtime", phase: "java-runtime" });
  await resolveJavaForVersion(version, null, settings.javaPath ?? null, javaTask);
  if (plan.isInstaller) {
    setState$1(id2, { status: "installing", detail: `Running the ${label} installer…` });
    await runServerInstaller(dir, plan.fileName, version.javaVersion?.majorVersion ?? 17, javaTask);
  }
  const next = { ...server2, installedVersion: server2.minecraftVersion, softwareVersion: plan.softwareVersion };
  db().put(Collections.hostedServers, next.id, next);
  emit("host:changed", listHostedServers());
  setState$1(id2, { status: "stopped", detail: `${label} ${plan.softwareVersion} installed and ready to start.` });
  log$r.info(`installed ${label} ${plan.softwareVersion} for ${server2.name} (${server2.minecraftVersion}) into ${dir}`);
  return next;
}
function clampWhole(value, low, high) {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.round(value)));
}
async function writeServerProperties(server2) {
  const file2 = node_path.join(hostedServerDir(server2.id), "server.properties");
  const properties = /* @__PURE__ */ new Map();
  if (node_fs.existsSync(file2)) {
    const text = await promises.readFile(file2, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq > 0) properties.set(line.slice(0, eq), line.slice(eq + 1));
    }
  }
  const managed = {
    "server-port": String(server2.port),
    "online-mode": String(server2.onlineMode),
    motd: server2.motd,
    difficulty: server2.difficulty,
    gamemode: server2.gameMode,
    "max-players": String(server2.maxPlayers),
    // There is no server-wide "cheats" switch — a dedicated server grants that
    // through operator status, which is handled separately. This key is the
    // only real one behind the setting.
    "enable-command-block": String(server2.allowCheats),
    // Which interface to listen on. Empty means every one of them.
    "server-ip": bindAddress(server2.reachability),
    /*
     * World and gameplay. Written every time so the file matches what the
     * settings screen shows — editing server.properties by hand and then saving
     * from the launcher should not leave the two disagreeing.
     *
     * `simulation-distance` is held at or under the view distance because the
     * server quietly ignores a larger one, which would make the setting look
     * broken.
     */
    pvp: String(server2.pvp ?? true),
    hardcore: String(server2.hardcore ?? false),
    "allow-flight": String(server2.allowFlight ?? false),
    "spawn-protection": String(server2.spawnProtection ?? 16),
    "view-distance": String(server2.viewDistance ?? 10),
    "simulation-distance": String(Math.min(server2.simulationDistance ?? 10, server2.viewDistance ?? 10)),
    "spawn-monsters": String(server2.spawnMonsters ?? true),
    "spawn-animals": String(server2.spawnAnimals ?? true),
    "white-list": String(server2.whitelist ?? false),
    "level-seed": server2.levelSeed ?? ""
  };
  for (const [key, value] of Object.entries(managed)) properties.set(key, value);
  const body = [...properties.entries()].map(([key, value]) => `${key}=${value}`).sort();
  await promises.writeFile(
    file2,
    ["#Minecraft server properties", "#Managed by the NexusCraft Launcher", ...body, ""].join("\n"),
    "utf8"
  );
}
function bindAddress(reachability) {
  if (reachability === "anyone") return "";
  if (reachability === "local") return "127.0.0.1";
  const lan = localNetworkAddress();
  if (lan) return lan;
  log$r.warn("no local network address found; binding to loopback instead");
  return "127.0.0.1";
}
function localNetworkAddress() {
  const VIRTUAL = /vethernet|hyper-?v|wsl|virtualbox|vmware|docker|loopback|tap-|tunnel|bluetooth/i;
  const rank = (name, address) => {
    if (VIRTUAL.test(name)) return -1;
    if (/^192\.168\./.test(address)) return 3;
    if (/^10\./.test(address)) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
    return -1;
  };
  let best = null;
  let bestRank = 0;
  for (const [name, entries] of Object.entries(node_os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const score2 = rank(name, entry.address);
      if (score2 > bestRank) {
        bestRank = score2;
        best = entry.address;
      }
    }
  }
  return best;
}
function connectAddress(server2) {
  if (server2.reachability === "local") return `127.0.0.1:${server2.port}`;
  const lan = localNetworkAddress();
  return lan ? `${lan}:${server2.port}` : `127.0.0.1:${server2.port}`;
}
async function assertPortFree(port, reachability) {
  await new Promise((resolve, reject) => {
    const probe = node_net.createServer();
    probe.once("error", (err) => {
      probe.close();
      if (err.code === "EADDRINUSE") {
        reject(
          new LauncherError("ALREADY_RUNNING", `port ${port} is in use`, {
            title: `Something is already using port ${port}`,
            message: "Another Minecraft server, or a world you opened to LAN, is holding that port.",
            actions: ["Close the other server", "Or give this one a different port in its settings"]
          })
        );
      } else {
        resolve();
      }
    });
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(port, bindAddress(reachability) || "0.0.0.0");
  });
}
async function startHostedServer(id2) {
  if (running$2.has(id2)) return getHostedServerState(id2);
  const server2 = getHostedServer(id2);
  if (!server2.eulaAcceptedAt) {
    throw new LauncherError("INVALID_INPUT", "the Minecraft EULA has not been accepted", {
      title: "Accept the Minecraft EULA first",
      message: "Mojang requires every server operator to agree to the End User Licence Agreement before the server will run.",
      actions: [`Read it at ${MINECRAFT_EULA_URL}`, "Then tick the box on the server to accept"]
    });
  }
  if (needsInstall(server2)) {
    await installHostedServer(id2);
  }
  await assertPortFree(server2.port, server2.reachability);
  await writeServerProperties(server2);
  const version = await ensureVersionJson(server2.minecraftVersion);
  const settings = getSettings();
  const java = await resolveJavaForVersion(version, null, settings.javaPath ?? null, null);
  const dir = hostedServerDir(id2);
  await promises.mkdir(dir, { recursive: true });
  const plan = await launchPlan(dir, server2.software);
  const args = [`-Xmx${server2.memoryMb}M`, `-Xms${Math.min(server2.memoryMb, 1024)}M`, ...plan.args];
  log$r.info(`starting ${server2.name} on port ${server2.port} with ${java.path} (Java ${java.majorVersion})`);
  const child = node_child_process.spawn(java.path, args, {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let resolveExit = () => void 0;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const entry = {
    child,
    state: {
      id: id2,
      status: "starting",
      detail: `Starting Minecraft ${server2.minecraftVersion}…`,
      players: [],
      pid: child.pid ?? null,
      startedAt: Date.now(),
      address: connectAddress(server2)
    },
    console: [],
    lineId: 0,
    exited
  };
  running$2.set(id2, entry);
  emit("host:state", entry.state);
  const consume = (chunk, stream2) => {
    for (const raw of chunk.toString("utf8").split(/\r?\n/)) {
      const text = raw.trimEnd();
      if (!text) continue;
      pushConsole(id2, text, stream2);
      interpret(id2, text);
    }
  };
  child.stdout?.on("data", (chunk) => consume(chunk, "out"));
  child.stderr?.on("data", (chunk) => consume(chunk, "err"));
  child.on("error", (err) => {
    setState$1(id2, { status: "error", detail: `could not start Java: ${err.message}` });
    running$2.delete(id2);
    resolveExit();
    emit("host:state", blankState$2(id2));
  });
  child.on("exit", (code, signal) => {
    const wasStopping = running$2.get(id2)?.state.status === "stopping";
    running$2.delete(id2);
    resolveExit();
    const detail = wasStopping ? "Stopped." : code === 0 ? "The server shut down." : `The server exited unexpectedly (code ${code ?? signal}).`;
    emit("host:state", { ...blankState$2(id2), status: wasStopping || code === 0 ? "stopped" : "error", detail });
    notifyLifecycle("stopped", id2);
    log$r.info(`${server2.name} exited with code ${code ?? signal}`);
  });
  db().put(Collections.hostedServers, server2.id, { ...server2, lastStartedAt: Date.now() });
  emit("host:changed", listHostedServers());
  return entry.state;
}
function interpret(id2, text) {
  const entry = running$2.get(id2);
  if (!entry) return;
  if (/Done \([\d.]+s\)! For help/.test(text)) {
    setState$1(id2, { status: "running", detail: "Ready for players." });
    grantOperators(id2);
    notifyLifecycle("ready", id2);
    return;
  }
  if (/FAILED TO BIND TO PORT/i.test(text)) {
    setState$1(id2, { status: "error", detail: "Could not claim the port — something else is using it." });
    return;
  }
  if (/You need to agree to the EULA/i.test(text)) {
    setState$1(id2, { status: "error", detail: "The server refused to start until the EULA is accepted." });
    return;
  }
  const joined = /\]: ([A-Za-z0-9_]{3,16}) joined the game/.exec(text);
  if (joined) {
    const players = [.../* @__PURE__ */ new Set([...entry.state.players, joined[1]])];
    setState$1(id2, { players });
    notifyLifecycle("player-joined", id2, joined[1]);
    return;
  }
  const left = /\]: ([A-Za-z0-9_]{3,16}) left the game/.exec(text);
  if (left) {
    setState$1(id2, { players: entry.state.players.filter((p) => p !== left[1]) });
    notifyLifecycle("player-left", id2, left[1]);
  }
}
function grantOperators(id2) {
  const server2 = db().get(Collections.hostedServers, id2);
  const names = server2?.operators ?? [];
  if (names.length === 0) return;
  for (const name of names) {
    try {
      sendHostedServerCommand(id2, `op ${name}`);
    } catch (err) {
      log$r.warn(`could not op ${name}: ${err.message}`);
    }
  }
}
async function stopHostedServer(id2) {
  const entry = running$2.get(id2);
  if (!entry) return blankState$2(id2);
  setState$1(id2, { status: "stopping", detail: "Saving the world and shutting down…" });
  void (async () => {
    try {
      const server2 = getHostedServer(id2);
      const gateway = await discoverGateway();
      if (!gateway) return;
      if (await closePort(gateway, server2.port)) {
        log$r.info(`closed the forwarded port ${server2.port} now "${server2.name}" has stopped`);
      }
    } catch (err) {
      log$r.warn(`could not close the forwarded port: ${err.message}`);
    }
  })();
  try {
    entry.child.stdin?.write("stop\n");
  } catch {
  }
  const killer = setTimeout(() => {
    if (!entry.child.killed) {
      log$r.warn(`server ${id2} ignored stop for ${STOP_GRACE_MS}ms; terminating`);
      entry.child.kill();
    }
  }, STOP_GRACE_MS);
  await entry.exited;
  clearTimeout(killer);
  return getHostedServerState(id2);
}
function sendHostedServerCommand(id2, command) {
  const entry = running$2.get(id2);
  if (!entry) {
    throw new LauncherError("NOT_FOUND", "that server is not running", {
      title: "The server is not running",
      message: "Start it before sending commands."
    });
  }
  const text = command.trim().replace(/^\//, "");
  if (!text) return;
  pushConsole(id2, `> ${text}`, "in");
  entry.child.stdin?.write(`${text}
`);
}
function serverJarLoader(software) {
  switch (software) {
    case "fabric":
      return "fabric";
    case "forge":
      return "forge";
    case "neoforge":
      return "neoforge";
    default:
      return "vanilla";
  }
}
function serverModTarget(server2) {
  const usesPlugins = server2.software === "paper" || server2.software === "purpur";
  return {
    dir: node_path.join(hostedServerDir(server2.id), usesPlugins ? "plugins" : "mods"),
    loader: serverJarLoader(server2.software),
    minecraftVersion: server2.minecraftVersion,
    description: "this server"
  };
}
function serverUsesPlugins(server2) {
  return server2.software === "paper" || server2.software === "purpur";
}
async function listServerMods(id2) {
  const server2 = getHostedServer(id2);
  const target = serverModTarget(server2);
  await promises.mkdir(target.dir, { recursive: true });
  return await analyseModsIn(target);
}
async function importServerMods(id2, files) {
  const server2 = getHostedServer(id2);
  const target = serverModTarget(server2);
  const added = await importModsIn(target.dir, files);
  if (added > 0) log$r.info(`added ${added} file(s) to ${server2.name}`);
  return added;
}
async function setServerModEnabled(id2, fileName, enabled) {
  await setModEnabledIn(serverModTarget(getHostedServer(id2)).dir, fileName, enabled);
}
async function deleteServerMod(id2, fileName) {
  await deleteModIn(serverModTarget(getHostedServer(id2)).dir, fileName);
}
async function installServerModFromModrinth(id2, versionId) {
  const server2 = getHostedServer(id2);
  const target = serverModTarget(server2);
  await promises.mkdir(target.dir, { recursive: true });
  return await installVersionToDir(
    { dir: target.dir, taskId: server2.id, loader: target.loader, minecraftVersion: server2.minecraftVersion },
    versionId
  );
}
function instancesThatCanJoin(server2, instances) {
  const needed = server2.software === "fabric" ? "fabric" : server2.software === "forge" ? "forge" : server2.software === "neoforge" ? "neoforge" : null;
  return instances.filter((instance) => {
    if (instance.minecraftVersion !== server2.minecraftVersion) return false;
    return needed ? instance.loader === needed : true;
  });
}
function serverAddress(server2) {
  if (server2.reachability === "anyone" || server2.reachability === "local") {
    return `127.0.0.1:${server2.port}`;
  }
  return connectAddress(server2);
}
async function syncServerModsToInstance(id2, instance) {
  const server2 = getHostedServer(id2);
  if (serverUsesPlugins(server2)) {
    throw new LauncherError("INVALID_INPUT", "plugins are server-side only", {
      title: "Plugins do not go on the client",
      message: `${softwareLabel(server2.software)} plugins run entirely on the server. Players join with an ordinary client and need nothing installed.`,
      actions: ["Nothing to copy — just press Join"]
    });
  }
  const target = serverModTarget(server2);
  const mods = await analyseModsIn(target);
  const enabled = mods.filter((mod) => mod.enabled && mod.fileName.toLowerCase().endsWith(".jar"));
  const destination = instanceSubdir(instance, "mods");
  await promises.mkdir(destination, { recursive: true });
  const existing = new Set((await analyseModsIn({ ...target, dir: destination })).map((m) => m.fileName));
  const copied = [];
  const alreadyPresent = [];
  for (const mod of enabled) {
    if (existing.has(mod.fileName)) {
      alreadyPresent.push(mod.fileName);
      continue;
    }
    await promises.copyFile(node_path.join(target.dir, mod.fileName), node_path.join(destination, mod.fileName));
    copied.push(mod.fileName);
  }
  log$r.info(`copied ${copied.length} mod(s) from ${server2.name} to ${instance.name}`);
  return { copied, alreadyPresent, instanceName: instance.name };
}
async function shutdownHostedServers() {
  await Promise.all([...running$2.keys()].map((id2) => stopHostedServer(id2).catch(() => void 0)));
}
async function shareDetails(id2) {
  const server2 = getHostedServer(id2);
  const localAddress = connectAddress(server2);
  const gateway = await discoverGateway();
  const external = gateway ? await externalAddress(gateway) : null;
  const publicAddress = external ? `${external}:${server2.port}` : null;
  let reachable = null;
  let note = null;
  if (!publicAddress) {
    note = 'No public address yet. Open the port with "Play with friends online", or forward it in the router, and the address will appear here.';
  } else {
    const result = await pingServer(external, server2.port, 6e3);
    if (result.online) {
      reachable = true;
    } else {
      reachable = false;
      note = "Your public address did not answer from this machine. That often means nothing is wrong: many routers refuse to let a device inside the network reach its own public address. Ask someone outside the house to try it before changing anything — and check the server is actually running.";
    }
  }
  return {
    publicAddress,
    localAddress,
    reachable,
    note,
    motd: server2.motd,
    minecraftVersion: server2.minecraftVersion,
    software: softwareLabel(server2.software),
    maxPlayers: server2.maxPlayers
  };
}
const hostService = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  MINECRAFT_EULA_URL,
  acceptEula,
  allHostedServerStates,
  connectAddress,
  deleteHostedServer,
  deleteServerMod,
  getHostedServer,
  getHostedServerConsole,
  getHostedServerState,
  hostedServerDir,
  hostedServersRoot,
  importServerMods,
  installHostedServer,
  installServerModFromModrinth,
  instancesThatCanJoin,
  isHostedServerRunning,
  listHostedServers,
  listServerMods,
  listServerSoftware,
  localNetworkAddress,
  onHostedServerEvent,
  saveHostedServer,
  sendHostedServerCommand,
  serverAddress,
  serverModTarget,
  serverUsesPlugins,
  setServerModEnabled,
  shareDetails,
  shutdownHostedServers,
  startHostedServer,
  stopHostedServer,
  syncServerModsToInstance
}, Symbol.toStringTag, { value: "Module" }));
const deflate = node_util.promisify(node_zlib.deflateRaw);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 4294967295;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
function toDosTime(date) {
  const time = (date.getHours() & 31) << 11 | (date.getMinutes() & 63) << 5 | date.getSeconds() / 2 & 31;
  const dosDate = (date.getFullYear() - 1980 & 127) << 9 | (date.getMonth() + 1 & 15) << 5 | date.getDate() & 31;
  return { time, date: dosDate };
}
async function collectFiles(root, dir = root) {
  const out = [];
  const entries = await promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = node_path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(root, full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
const MAX_ENTRIES = 65534;
const MAX_TOTAL_BYTES = 4294967294;
async function zipDirectory(sourceDir, outputFile, onProgress, options = {}) {
  const all = await collectFiles(sourceDir);
  const files = options.filter ? all.filter((file2) => options.filter(node_path.relative(sourceDir, file2).split("\\").join("/"))) : all;
  if (files.length > MAX_ENTRIES) {
    throw new LauncherError("UNKNOWN", `${files.length} files exceeds the archive limit`, {
      title: "This world is too large to back up automatically",
      message: `The folder holds ${files.length.toLocaleString()} files, more than the standard ZIP format supports without extensions.`,
      actions: ["Copy the world folder manually instead", "Or remove old region files first"]
    });
  }
  const output = node_fs.createWriteStream(outputFile);
  const central = [];
  let offset = 0;
  let completed = 0;
  const write2 = async (chunk) => {
    if (!output.write(chunk)) await node_events.once(output, "drain");
    offset += chunk.length;
  };
  const addEntry = async (name, input, mtime) => {
    const raw = Buffer.from(input);
    const nameBuffer = Buffer.from(name, "utf8");
    const { time, date } = toDosTime(mtime);
    const crc = crc32(raw);
    let payload = Buffer.from(await deflate(raw, { level: 6 }));
    let method = 8;
    if (payload.length >= raw.length) {
      payload = raw;
      method = 0;
    }
    if (offset + payload.length > MAX_TOTAL_BYTES) {
      throw new LauncherError("UNKNOWN", "archive would exceed 4 GB", {
        title: "This is too large to archive automatically",
        message: "The archive would be larger than 4 GB, which the standard ZIP format cannot hold.",
        actions: ["Exclude worlds from the export, or copy the folder manually"]
      });
    }
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(67324752, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(2048, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    central.push({
      name: nameBuffer,
      crc,
      compressedSize: payload.length,
      uncompressedSize: raw.length,
      offset,
      time,
      date,
      method
    });
    await write2(localHeader);
    await write2(nameBuffer);
    await write2(payload);
  };
  try {
    for (const extra of options.extraEntries ?? []) {
      await addEntry(extra.name, extra.data, /* @__PURE__ */ new Date());
    }
    for (const file2 of files) {
      const name = node_path.relative(sourceDir, file2).split("\\").join("/");
      const info = await promises.stat(file2);
      await addEntry(name, await promises.readFile(file2), info.mtime);
      completed++;
      onProgress?.({ file: name, completed, total: files.length });
    }
    const centralStart = offset;
    for (const entry of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(33639248, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(2048, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.uncompressedSize, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(entry.offset, 42);
      await write2(header);
      await write2(entry.name);
    }
    const centralSize = offset - centralStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(101010256, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    await write2(eocd);
    await new Promise((resolve, reject) => {
      output.end((err) => err ? reject(err) : resolve());
    });
    return { bytes: offset, entries: central.length };
  } catch (err) {
    output.destroy();
    throw err;
  }
}
const log$q = createLogger("diagnostics");
const LOG_TAIL_BYTES = 512 * 1024;
function heading(title) {
  return `
${"=".repeat(72)}
${title}
${"=".repeat(72)}
`;
}
async function systemReport(options) {
  const settings = getSettings();
  const lines = [];
  lines.push(heading("NexusCraft diagnostics"));
  lines.push(`generated       ${(/* @__PURE__ */ new Date()).toISOString()}`);
  if (options.note) lines.push(`what happened   ${options.note.slice(0, 500)}`);
  lines.push(heading("Build"));
  lines.push(`launcher        ${electron.app.getVersion()}`);
  lines.push(`packaged        ${electron.app.isPackaged}`);
  lines.push(`electron        ${process.versions.electron}`);
  lines.push(`chrome          ${process.versions.chrome}`);
  lines.push(`node            ${process.versions.node}`);
  lines.push(`module ABI      ${process.versions.modules}`);
  lines.push(heading("System"));
  lines.push(`os              ${node_os.type()} ${node_os.release()} (${process.platform} ${process.arch})`);
  lines.push(`cpu             ${node_os.cpus()[0]?.model ?? "unknown"} x${node_os.cpus().length}`);
  lines.push(`memory          ${Math.round(node_os.totalmem() / 1024 / 1024 / 1024)} GB`);
  lines.push(`data directory  ${dataRoot()}`);
  lines.push(heading("Settings"));
  lines.push(`max memory      ${settings.defaultMaxRamMb} MB`);
  lines.push(`min memory      ${settings.defaultMinRamMb} MB`);
  lines.push(`jvm args        ${settings.defaultJvmArgs}`);
  lines.push(`java override   ${settings.javaPath ?? "(auto)"}`);
  lines.push(`downloads       ${settings.maxConcurrentDownloads} at once`);
  lines.push(`close to tray   ${settings.closeToTray}`);
  lines.push(`notifications   ${settings.desktopNotifications}`);
  lines.push(`curseforge key  ${settings.curseForgeApiKey ? "set (not included)" : "not set"}`);
  try {
    const javas = await detectJavaInstallations(false);
    lines.push(heading("Java runtimes"));
    for (const java of javas) {
      lines.push(`${String(java.majorVersion).padStart(3)}  ${java.vendor.padEnd(18)} ${java.path}`);
    }
    if (javas.length === 0) lines.push("(none found)");
  } catch (err) {
    lines.push(`
(could not list Java: ${err.message})`);
  }
  return lines.join("\n");
}
function inventoryReport() {
  const lines = [];
  const instances = listInstances();
  lines.push(heading(`Instances (${instances.length})`));
  for (const instance of instances) {
    lines.push(
      `${instance.name}
    version     ${instance.minecraftVersion} ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}
    resolved    ${instance.resolvedVersionId ?? "(not installed)"}
    memory      ${instance.java.minRamMb}-${instance.java.maxRamMb} MB
    java        ${instance.java.javaPath ?? "(auto)"}
    playtime    ${Math.round(instance.totalPlaytimeMs / 6e4)} min
    installed   ${instance.installed}`
    );
  }
  try {
    const servers = listHostedServers();
    lines.push(heading(`Hosted servers (${servers.length})`));
    for (const server2 of servers) {
      lines.push(
        `${server2.name}
    version     ${server2.minecraftVersion} ${server2.software}${server2.softwareVersion ? ` ${server2.softwareVersion}` : ""}
    port        ${server2.port}  reachability ${server2.reachability}
    online mode ${server2.onlineMode}  memory ${server2.memoryMb} MB`
      );
    }
  } catch (err) {
    lines.push(`
(could not list servers: ${err.message})`);
  }
  return lines.join("\n");
}
async function modReport(instanceId) {
  const instance = listInstances().find((entry) => entry.id === instanceId);
  if (!instance) return "";
  const lines = [heading(`Mods in ${instance.name}`)];
  try {
    const mods = await analyseMods(instance);
    if (mods.length === 0) lines.push("(no mods)");
    for (const mod of mods) {
      lines.push(
        `${mod.enabled ? "[on ]" : "[off]"} ${mod.fileName}${mod.version ? `  (${mod.version})` : ""}${mod.loaders.length > 0 ? `  ${mod.loaders.join("/")}` : ""}`
      );
      for (const issue of mod.issues) lines.push(`        ${issue.severity.toUpperCase()}: ${issue.message}`);
    }
  } catch (err) {
    lines.push(`(could not read mods: ${err.message})`);
  }
  return lines.join("\n");
}
async function logTail() {
  const file2 = node_path.join(logsRoot(), "launcher.log");
  try {
    const info = await promises.stat(file2);
    const handle2 = await promises.readFile(file2);
    const slice = info.size > LOG_TAIL_BYTES ? handle2.subarray(info.size - LOG_TAIL_BYTES) : handle2;
    return redact(slice.toString("utf8"));
  } catch (err) {
    return `(could not read the log: ${err.message})`;
  }
}
async function newestCrash() {
  let newest = null;
  for (const instance of listInstances()) {
    const dir = node_path.join(instance.gameDir, "crash-reports");
    let names;
    try {
      names = await promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith(".txt"))) {
      try {
        const path2 = node_path.join(dir, name);
        const info = await promises.stat(path2);
        if (newest && info.mtimeMs <= newest.at) continue;
        const body = redact(await promises.readFile(path2, "utf8"));
        newest = { name: `${instance.name} — ${name}`, body, at: info.mtimeMs };
      } catch {
      }
    }
  }
  return newest ? { name: newest.name, body: newest.body } : null;
}
async function writeDiagnostics(outputPath, options = {}) {
  const staging = await promises.mkdtemp(node_path.join(node_os.tmpdir(), "nexuscraft-diag-"));
  try {
    let files = 0;
    await promises.writeFile(node_path.join(staging, "report.txt"), await systemReport(options), "utf8");
    files += 1;
    await promises.writeFile(node_path.join(staging, "inventory.txt"), inventoryReport(), "utf8");
    files += 1;
    await promises.writeFile(node_path.join(staging, "launcher.log"), await logTail(), "utf8");
    files += 1;
    if (options.instanceId) {
      const mods = await modReport(options.instanceId);
      if (mods) {
        await promises.writeFile(node_path.join(staging, "mods.txt"), mods, "utf8");
        files += 1;
      }
    }
    const crash = await newestCrash();
    if (crash) {
      await promises.writeFile(node_path.join(staging, "crash-report.txt"), `${crash.name}

${crash.body}`, "utf8");
      files += 1;
    }
    const zipped = await zipDirectory(staging, outputPath);
    log$q.info(`wrote a diagnostics bundle to ${outputPath}`);
    return { path: outputPath, bytes: zipped.bytes, files };
  } finally {
    await promises.rm(staging, { recursive: true, force: true }).catch(() => void 0);
  }
}
const log$p = createLogger("install");
async function prepare(instance, verifyMode) {
  const settings = getSettings();
  await ensureInstanceLayout(instance);
  const task = createTask({
    instanceId: instance.id,
    concurrency: settings.maxConcurrentDownloads,
    verifyMode,
    label: verifyMode === "full" ? "Repairing" : "Installing"
  });
  try {
    let versionId = instance.resolvedVersionId;
    if (!versionId || !await loaderProfileInstalled(versionId) || verifyMode === "full") {
      if (instance.loader === "vanilla") {
        versionId = instance.minecraftVersion;
      } else if (!versionId || !await loaderProfileInstalled(versionId)) {
        versionId = await installLoader(instance.loader, instance.minecraftVersion, instance.loaderVersion, task);
      }
      updateInstance(instance.id, { resolvedVersionId: versionId });
    }
    const version = await installVersion(versionId, { task });
    task.setPhase("java-runtime", "Checking the Java runtime");
    const java = await resolveJavaForVersion(version, instance.java.javaPath, settings.javaPath, task);
    task.setPhase("verifying", "Verifying game files");
    const check = await verifyInstallation(versionId);
    if (check.missing.length > 0) {
      log$p.warn(`${check.missing.length} file(s) still missing after install; downloading again`);
      await installVersion(versionId, { task });
    }
    updateInstance(instance.id, { installed: true });
    task.setPhase("done", "Ready to play");
    task.markDone();
    log$p.info(`instance "${instance.name}" is ready (${versionId})`);
    return {
      instanceId: instance.id,
      versionId,
      javaPath: java.path,
      javaInstalled: java.installed,
      filesVerified: task.snapshot().completedFiles
    };
  } catch (err) {
    task.cancel();
    throw err;
  }
}
const installsInFlight = /* @__PURE__ */ new Map();
async function installInstance(instanceId) {
  const already = installsInFlight.get(instanceId);
  if (already) {
    log$p.info(`install of ${instanceId} is already running; waiting for it rather than starting a second`);
    return await already;
  }
  const instance = getInstance(instanceId);
  const running2 = (async () => {
    const result = await prepare(instance, "quick");
    toast("success", "Instance ready", `${instance.name} is installed and ready to play.`);
    return result;
  })();
  installsInFlight.set(instanceId, running2);
  try {
    return await running2;
  } finally {
    installsInFlight.delete(instanceId);
  }
}
async function repairInstance(instanceId) {
  const instance = getInstance(instanceId);
  log$p.info(`repairing instance "${instance.name}"`);
  const result = await prepare(instance, "full");
  toast("success", "Repair complete", `${instance.name} was verified and any damaged files were replaced.`);
  return result;
}
const log$o = createLogger("transfer");
const MANIFEST_NAME = "nexuscraft-instance.json";
async function exportInstance(instanceId, outputFile, options) {
  const instance = getInstance(instanceId);
  const skipDirs = /* @__PURE__ */ new Set(["logs", "crash-reports"]);
  if (!options.includeWorlds) skipDirs.add("saves");
  if (!options.includeScreenshots) skipDirs.add("screenshots");
  log$o.info(`exporting "${instance.name}"${options.includeWorlds ? " with worlds" : ""}`);
  const result = await zipDirectory(instance.gameDir, outputFile, void 0, {
    // Paths arrive relative to the game directory, using forward slashes.
    filter: (relative) => {
      const top = relative.split("/")[0];
      return !skipDirs.has(top);
    },
    extraEntries: [
      {
        name: MANIFEST_NAME,
        data: Buffer.from(
          JSON.stringify(
            {
              format: "nexuscraft-instance",
              formatVersion: 1,
              exportedAt: Date.now(),
              name: instance.name,
              minecraftVersion: instance.minecraftVersion,
              loader: instance.loader,
              loaderVersion: instance.loaderVersion,
              iconColor: instance.iconColor,
              notes: instance.notes,
              java: instance.java,
              window: instance.window,
              includesWorlds: options.includeWorlds
            },
            null,
            2
          ),
          "utf8"
        )
      }
    ]
  });
  log$o.info(`exported "${instance.name}": ${result.entries} entries, ${result.bytes} bytes`);
  return { path: outputFile, ...result };
}
function readManifest(zip) {
  const entry = zip.getEntry(MANIFEST_NAME);
  if (!entry) {
    throw new LauncherError("INVALID_INPUT", "no instance manifest in the archive", {
      title: "That is not an exported instance",
      message: `The archive does not contain a ${MANIFEST_NAME}, so it was not produced by NexusCraft's export.`,
      actions: [
        "Check you selected a file exported from Instances → Export",
        "To import a modpack instead, use Import modpack"
      ]
    });
  }
  try {
    const manifest = JSON.parse(entry.getData().toString("utf8"));
    if (manifest.format !== "nexuscraft-instance" || !manifest.minecraftVersion) {
      throw new Error("wrong format");
    }
    return manifest;
  } catch {
    throw new LauncherError("INVALID_INPUT", "the instance manifest could not be read");
  }
}
async function inspectInstanceArchive(filePath) {
  if (!node_fs.existsSync(filePath)) throw new LauncherError("NOT_FOUND", "that file no longer exists");
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch {
    throw new LauncherError("INVALID_INPUT", "the archive could not be opened", {
      title: "That file could not be read",
      message: "The archive appears to be damaged or is not a zip file.",
      actions: ["Export the instance again"]
    });
  }
  const manifest = readManifest(zip);
  const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName !== MANIFEST_NAME);
  return {
    name: manifest.name,
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
    exportedAt: manifest.exportedAt,
    includesWorlds: manifest.includesWorlds,
    fileCount: entries.length,
    modCount: entries.filter((e) => e.entryName.startsWith("mods/") && e.entryName.endsWith(".jar")).length,
    sizeBytes: entries.reduce((sum, e) => sum + (e.header?.size ?? 0), 0)
  };
}
function safeTarget$1(gameDir, relative) {
  const cleaned = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || node_path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    throw new LauncherError("INVALID_INPUT", `archive entry escapes the instance: ${relative.slice(0, 120)}`);
  }
  return assertInside(gameDir, node_path.join(gameDir, ...cleaned.split("/")));
}
async function importInstance(filePath, nameOverride) {
  const zip = new AdmZip(filePath);
  const manifest = readManifest(zip);
  const instance = await createInstance({
    name: (nameOverride?.trim() || manifest.name || "Imported instance").slice(0, 64),
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
    iconColor: manifest.iconColor
  });
  try {
    let written = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || entry.entryName === MANIFEST_NAME) continue;
      const target = safeTarget$1(instance.gameDir, entry.entryName);
      await promises.mkdir(node_path.dirname(target), { recursive: true });
      await promises.writeFile(target, entry.getData());
      written++;
    }
    const { updateInstance: updateInstance2 } = await Promise.resolve().then(() => instanceService);
    const restored = updateInstance2(instance.id, {
      notes: manifest.notes,
      java: manifest.java,
      window: manifest.window
    });
    log$o.info(`imported "${restored.name}": ${written} files`);
    emit("toast", {
      kind: "success",
      title: `${restored.name} imported`,
      message: `${written} files restored.`
    });
    return restored;
  } catch (err) {
    await deleteInstance(instance.id, true).catch(() => void 0);
    throw err;
  }
}
const DEFAULT_PERSONALITY = "You are a cheerful, competent Minecraft companion. You enjoy exploring and building, you speak briefly and naturally in chat, and you get on with things without asking for permission on every small step.";
const log$n = createLogger("companion");
const PROFILES_KEY = "companion-profiles";
const LEGACY_SETTINGS_KEY = "companion-settings";
const LEGACY_MEMORY_KEY = "companion-memory";
const LEGACY_API_KEY = "companion-llm-key";
const MAX_EVENTS = 400;
const MAX_MEMORY = 60;
const apiKeyName = (id2) => `companion-llm-key-${id2}`;
const memoryKey = (id2) => `companion-memory-${id2}`;
function defaults() {
  return {
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    host: "localhost",
    port: 25565,
    username: "Companion",
    auth: "offline",
    version: "",
    owner: "",
    personality: DEFAULT_PERSONALITY,
    autonomy: true,
    idleIntervalSec: 45,
    toolSet: "full",
    pricePerMillionTokens: 0,
    sentinel: false,
    routine: "",
    stewardOf: "",
    hasApiKey: false
  };
}
function readProfiles() {
  const raw = db().kvGet(PROFILES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => ({ ...defaults(), ...p, hasApiKey: Boolean(getSecret(apiKeyName(p.id))) }));
      }
    } catch {
    }
  }
  const legacy = db().kvGet(LEGACY_SETTINGS_KEY);
  const id2 = node_crypto.randomUUID();
  let settings = defaults();
  if (legacy) {
    try {
      settings = { ...settings, ...JSON.parse(legacy) };
    } catch {
    }
  }
  const migrated = { ...settings, id: id2, hasApiKey: false };
  const oldKey = getSecret(LEGACY_API_KEY);
  if (oldKey) {
    setSecret(apiKeyName(id2), oldKey);
    if (getSecret(apiKeyName(id2)) === oldKey) {
      removeSecret(LEGACY_API_KEY);
      migrated.hasApiKey = true;
    } else {
      log$n.warn("could not copy the saved API key into the new profile; leaving the original in place");
    }
  }
  const oldMemory = db().kvGet(LEGACY_MEMORY_KEY);
  if (oldMemory) db().kvSet(memoryKey(id2), oldMemory);
  writeProfiles([migrated]);
  if (legacy) log$n.info("migrated the existing companion into a profile");
  return [migrated];
}
function writeProfiles(profiles) {
  db().kvSet(PROFILES_KEY, JSON.stringify(profiles.map((p) => ({ ...p, hasApiKey: void 0 }))));
}
const VALID_USERNAME = /^[A-Za-z0-9_]{3,16}$/;
function assertUsableUsername(username) {
  if (VALID_USERNAME.test(username)) return;
  const cleaned = username.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
  throw new LauncherError("INVALID_INPUT", `"${username}" is not a valid Minecraft username`, {
    title: "That bot username will not work",
    message: "Minecraft usernames are 3 to 16 characters long and may only contain letters, numbers and underscores. A server refuses anything else and drops the connection without explaining why.",
    actions: cleaned.length >= 3 ? [`Try "${cleaned}"`] : ["Pick a name of at least 3 letters or digits"]
  });
}
function listCompanions() {
  return readProfiles();
}
function getCompanion(id2) {
  const found = readProfiles().find((p) => p.id === id2);
  if (!found) throw new LauncherError("NOT_FOUND", `companion ${id2} does not exist`);
  return found;
}
function createCompanion(name) {
  const profiles = readProfiles();
  const id2 = node_crypto.randomUUID();
  const taken = new Set(profiles.map((p) => p.username.toLowerCase()));
  const base = (name ?? "Companion").replace(/[^A-Za-z0-9_]/g, "") || "Companion";
  let username = base.slice(0, 16);
  let suffix = 2;
  while (taken.has(username.toLowerCase())) username = `${base.slice(0, 14)}${suffix++}`;
  if (username.length < 3) username = `Companion${suffix}`;
  const created = { ...defaults(), id: id2, username };
  writeProfiles([...profiles, created]);
  emit("companion:list", listCompanions());
  log$n.info(`created companion ${username}`);
  return created;
}
function deleteCompanion(id2) {
  if (running$1.has(id2)) stopCompanion(id2);
  const profiles = readProfiles().filter((p) => p.id !== id2);
  writeProfiles(profiles);
  removeSecret(apiKeyName(id2));
  db().kvSet(memoryKey(id2), JSON.stringify([]));
  emit("companion:list", listCompanions());
}
function updateCompanion(id2, patch) {
  const profiles = readProfiles();
  const index = profiles.findIndex((p) => p.id === id2);
  if (index < 0) throw new LauncherError("NOT_FOUND", `companion ${id2} does not exist`);
  const current = profiles[index];
  const next = { ...current };
  if (typeof patch.apiKey === "string") {
    if (patch.apiKey.trim()) setSecret(apiKeyName(id2), patch.apiKey.trim());
    else removeSecret(apiKeyName(id2));
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "apiKey" || key === "hasApiKey" || key === "id") continue;
    if (!(key in current)) continue;
    const typed = key;
    if (typeof value !== typeof current[typed]) continue;
    if (typeof value === "number") {
      next[typed] = Math.round(value);
    } else if (typeof value === "string") {
      next[typed] = value.slice(0, 4e3);
    } else {
      next[typed] = value;
    }
  }
  next.port = Math.min(Math.max(next.port, 1), 65535);
  next.idleIntervalSec = Math.min(Math.max(next.idleIntervalSec, 10), 600);
  next.hasApiKey = Boolean(getSecret(apiKeyName(id2)));
  assertUsableUsername(next.username.trim());
  next.username = next.username.trim();
  profiles[index] = next;
  writeProfiles(profiles);
  emit("companion:list", listCompanions());
  const entry = running$1.get(id2);
  if (entry) {
    post(id2, {
      type: "configure",
      autonomy: next.autonomy,
      personality: next.personality,
      idleIntervalSec: next.idleIntervalSec
    });
  }
  return next;
}
function loadMemory(id2) {
  const raw = db().kvGet(memoryKey(id2));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_MEMORY) : [];
  } catch {
    return [];
  }
}
function saveMemory(id2, notes) {
  db().kvSet(memoryKey(id2), JSON.stringify(notes.slice(-MAX_MEMORY)));
}
const running$1 = /* @__PURE__ */ new Map();
function blankState$1(id2) {
  return {
    companionId: id2,
    status: "idle",
    detail: "",
    goal: null,
    memory: loadMemory(id2),
    events: [],
    connectedVersion: null
  };
}
function getCompanionState(id2) {
  const entry = running$1.get(id2);
  const base = entry?.state ?? blankState$1(id2);
  return { ...base, alive: running$1.has(id2), memory: [...base.memory], events: [...base.events] };
}
function allCompanionStates() {
  return listCompanions().map((c) => getCompanionState(c.id));
}
function isCompanionRunning(id2) {
  return running$1.has(id2);
}
function killChild(id2, immediate = false) {
  const entry = running$1.get(id2);
  if (!entry) return;
  entry.child.removeAllListeners();
  if (immediate) {
    try {
      entry.child.kill();
    } catch {
    }
    running$1.delete(id2);
    return;
  }
  try {
    entry.child.send({ type: "stop" });
  } catch {
  }
  const forceQuit = setTimeout(() => {
    try {
      entry.child.kill();
    } catch {
    }
  }, 1500);
  entry.child.once("exit", () => clearTimeout(forceQuit));
  running$1.delete(id2);
}
function setStatus(id2, status2, detail) {
  const entry = running$1.get(id2);
  if (entry) {
    entry.state.status = status2;
    entry.state.detail = detail;
  }
  emitStatus(id2);
}
function emitStatus(id2) {
  const s = getCompanionState(id2);
  emit("companion:status", {
    companionId: id2,
    status: s.status,
    detail: s.detail,
    goal: s.goal,
    connectedVersion: s.connectedVersion,
    alive: s.alive
  });
}
function pushEvent(id2, kind, text, extra = {}) {
  const entry = running$1.get(id2);
  if (!entry) return;
  const event = {
    id: ++entry.eventId,
    companionId: id2,
    at: Date.now(),
    kind,
    text,
    ...extra
  };
  entry.state.events.push(event);
  if (entry.state.events.length > MAX_EVENTS) entry.state.events.shift();
  emit("companion:event", event);
}
function broadcastSiblings() {
  const online = listCompanions().filter((c) => running$1.has(c.id));
  for (const companion of online) {
    post(companion.id, {
      type: "siblings",
      names: online.filter((other) => other.id !== companion.id).map((other) => other.username)
    });
  }
}
function post(id2, message) {
  try {
    running$1.get(id2)?.child.send(message);
  } catch (err) {
    log$n.warn(`could not talk to companion ${id2}: ${err.message}`);
  }
}
function botScriptPath() {
  return electron.app.isPackaged ? node_path.join(electron.app.getAppPath(), "out", "main", "bot.js") : node_path.join(electron.app.getAppPath(), "out", "main", "bot.js");
}
function startCompanion(id2) {
  const settings = getCompanion(id2);
  startUsageSession(id2);
  const existing = running$1.get(id2);
  if (existing && existing.state.status !== "playing" && existing.state.status !== "connecting") {
    log$n.info(`replacing a ${settings.username} process that is not playing`);
    killChild(id2);
  }
  if (running$1.has(id2)) {
    throw new LauncherError("ALREADY_RUNNING", "that companion is already connected", {
      title: `${settings.username} is already running`,
      message: "Stop it before starting it again.",
      actions: ["Press Stop, then Start"]
    });
  }
  const clash = listCompanions().find(
    (c) => c.id !== id2 && running$1.has(c.id) && c.username.toLowerCase() === settings.username.toLowerCase()
  );
  if (clash) {
    throw new LauncherError("INVALID_INPUT", `username ${settings.username} is already in use`, {
      title: "Two companions cannot share a name",
      message: `${clash.username} is already connected under that username, and the server would kick whichever joined second.`,
      actions: ["Give this one a different bot username in its settings"]
    });
  }
  assertUsableUsername(settings.username.trim());
  const apiKey2 = getSecret(apiKeyName(id2)) ?? "";
  if (!settings.routine.trim()) {
    if (!settings.baseUrl.trim()) {
      throw new LauncherError("INVALID_INPUT", "no model endpoint configured", {
        title: "No model endpoint set",
        message: "The companion needs somewhere to send its decisions — a local Ollama server or a hosted API.",
        actions: [
          "Choose a provider in the Companion screen",
          "Ollama runs locally and needs no key",
          "Or set it to follow a routine, which needs no model at all"
        ]
      });
    }
    if (!settings.model.trim()) {
      throw new LauncherError("INVALID_INPUT", "no model selected", {
        title: "No model chosen",
        message: "Choose the model to use. Press Load models to see what your endpoint serves rather than typing a name.",
        actions: ["Set a model name in the Companion screen", "Or set it to follow a routine, which needs no model"]
      });
    }
  }
  const hostedPorts = listHostedServers().filter((server2) => isHostedServerRunning(server2.id)).map((server2) => server2.port);
  const resolved = hostResolve.resolveHost({
    host: settings.host,
    port: settings.port,
    own: hostResolve.ownAddresses(),
    hostedPorts
  });
  if (resolved.note) {
    log$n.info(`${settings.username}: ${resolved.note}`);
    pushEvent(id2, "status", resolved.note);
    if (resolved.persist && resolved.host !== settings.host) {
      try {
        updateCompanion(id2, { host: resolved.host });
      } catch (err) {
        log$n.warn(`could not save the corrected host for ${settings.username}: ${String(err)}`);
      }
    }
  }
  const config = {
    host: resolved.host,
    port: settings.port,
    username: settings.username,
    auth: settings.auth,
    version: settings.version,
    owner: settings.owner,
    personality: settings.personality,
    autonomy: settings.autonomy,
    idleIntervalSec: settings.idleIntervalSec,
    sentinel: settings.sentinel ?? false,
    toolSet: settings.toolSet ?? "full",
    llm: { baseUrl: settings.baseUrl, apiKey: apiKey2, model: settings.model, timeoutMs: 9e4 },
    memory: loadMemory(id2),
    // Empty means think with the model; a name makes it a scripted worker.
    routine: settings.routine ?? "",
    /*
     * Who else is on, so this one can tell an order from an overheard remark.
     * Read at spawn rather than kept in step afterwards: a companion that
     * starts later is not yet talking, and the list is only used to decide
     * whether a line of chat was meant for this bot.
     */
    siblings: listCompanions().filter((c) => c.id !== id2 && running$1.has(c.id)).map((c) => c.username).filter(Boolean)
  };
  const script = botScriptPath();
  if (!node_fs.existsSync(script)) {
    throw new LauncherError("NOT_FOUND", `bot script missing at ${script}`, {
      title: "The companion bot is missing from this build",
      message: "The bot runs from a separate bundled script which could not be found.",
      actions: ["Rebuild the launcher with npm run build"]
    });
  }
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.NODE_OPTIONS;
  const child = node_child_process.spawn(process.execPath, [script], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  running$1.set(id2, {
    child,
    state: { ...blankState$1(id2), memory: config.memory ?? [] },
    eventId: 0
  });
  broadcastSiblings();
  child.stdout?.on("data", (chunk) => log$n.debug(`${settings.username}: ${chunk.toString().trim()}`));
  child.stderr?.on("data", (chunk) => log$n.warn(`${settings.username}: ${chunk.toString().trim()}`));
  child.on("message", (message) => handleMessage(id2, message));
  child.on("exit", (code) => {
    const wasError = running$1.get(id2)?.state.status === "error";
    running$1.delete(id2);
    broadcastSiblings();
    if (!wasError) {
      emit("companion:status", {
        companionId: id2,
        status: "idle",
        detail: code === 0 ? "stopped" : `bot exited with code ${code}`,
        goal: null,
        connectedVersion: null,
        alive: false
      });
    }
    log$n.info(`${settings.username} exited with code ${code}`);
  });
  child.on("error", (err) => {
    running$1.delete(id2);
    emit("companion:status", {
      companionId: id2,
      status: "error",
      detail: err.message,
      goal: null,
      connectedVersion: null,
      alive: false
    });
  });
  setStatus(id2, "connecting", `${resolved.host}:${settings.port}`);
  pushEvent(id2, "status", `Connecting to ${resolved.host}:${settings.port} as ${settings.username}…`);
  post(id2, { type: "start", config });
  log$n.info(`${settings.username} starting -> ${resolved.host}:${settings.port} (model ${settings.model})`);
  return getCompanionState(id2);
}
function handleMessage(id2, message) {
  const entry = running$1.get(id2);
  if (!entry) return;
  switch (message.type) {
    case "status":
      setStatus(id2, message.status, message.detail);
      pushEvent(id2, message.status === "error" ? "error" : "status", message.detail || message.status);
      if (message.status === "playing") {
        const version = message.detail.match(/on ([\d.]+\w*)/)?.[1] ?? null;
        if (version) entry.state.connectedVersion = version;
        void Promise.resolve().then(() => crewService).then(({ refreshFor: refreshFor2, crewOf: crewOf2, broadcast: broadcast2 }) => {
          refreshFor2(id2);
          const crew = crewOf2(id2);
          if (crew) broadcast2(crew.id);
        });
      }
      break;
    case "log":
      pushEvent(id2, "log", message.message);
      break;
    case "chat":
      pushEvent(id2, "chat", message.message, { from: message.from });
      break;
    case "thought":
      pushEvent(id2, "thought", message.text);
      break;
    case "action":
      pushEvent(id2, "action", message.result, { tool: message.name });
      break;
    case "memory":
      entry.state.memory = message.notes;
      saveMemory(id2, message.notes);
      emit("companion:memory", { companionId: id2, notes: message.notes });
      break;
    case "goal":
      entry.state.goal = message.goal;
      emitStatus(id2);
      break;
    case "agentError":
      pushEvent(id2, "error", message.message);
      break;
    case "assign": {
      pushEvent(id2, "action", `assigned ${message.toUsername}: ${message.task}`, { tool: "assign_task" });
      void Promise.resolve().then(() => crewService).then(({ assignTask: assignTask2 }) => assignTask2(id2, message.toUsername, message.task));
      break;
    }
    case "crewNote": {
      pushEvent(id2, "log", `crew note: ${message.text}`);
      void Promise.resolve().then(() => crewService).then(({ noteFromCompanion: noteFromCompanion2 }) => noteFromCompanion2(id2, message.text));
      break;
    }
    case "camera":
      emit("companion:camera", { companionId: id2, frame: message.frame });
      break;
    case "work":
      entry.state.work = message.work;
      emit("companion:work", { companionId: id2, work: message.work });
      break;
    case "alert":
      pushEvent(id2, "log", `${message.title} — ${message.body}`);
      notifyDesktop({ title: message.title, body: message.body, onlyWhenAway: false });
      break;
    case "usage": {
      const totals = recordUsage(id2, message.usage);
      emit("companion:usage", { companionId: id2, usage: totals });
      break;
    }
    case "buildRecord": {
      const records = readBuilds();
      records.push({ ...message.record, companionId: id2 });
      writeBuilds(records);
      pushEvent(id2, "log", `${message.record.label} can be undone (${message.record.placements.length} blocks)`);
      break;
    }
  }
}
const importedBlueprints = /* @__PURE__ */ new Map();
function rememberImport(id2, blueprint, summary) {
  importedBlueprints.set(id2, { blueprint, summary });
  if (importedBlueprints.size > 24) {
    const oldest = importedBlueprints.keys().next().value;
    if (oldest) importedBlueprints.delete(oldest);
  }
}
function listImports() {
  return [...importedBlueprints.values()].map((entry) => entry.summary);
}
function getImport(id2) {
  return importedBlueprints.get(id2);
}
function buildWithCompanion(id2, blueprint, label) {
  post(id2, { type: "build", blueprint, label });
}
const USAGE_KEY = "companion-usage";
function readUsage() {
  try {
    const raw = db().kvGet(USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function blankUsage() {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    sessionTokens: 0,
    sessionCalls: 0
  };
}
function companionUsage() {
  return readUsage();
}
function resetUsage(id2) {
  if (!id2) {
    db().kvSet(USAGE_KEY, JSON.stringify({}));
    return;
  }
  const all = readUsage();
  delete all[id2];
  db().kvSet(USAGE_KEY, JSON.stringify(all));
}
function recordUsage(id2, usage) {
  const all = readUsage();
  const entry = all[id2] ?? blankUsage();
  entry.calls += 1;
  entry.promptTokens += usage.promptTokens;
  entry.completionTokens += usage.completionTokens;
  entry.totalTokens += usage.totalTokens;
  entry.sessionCalls += 1;
  entry.sessionTokens += usage.totalTokens;
  all[id2] = entry;
  db().kvSet(USAGE_KEY, JSON.stringify(all));
  return entry;
}
function startUsageSession(id2) {
  const all = readUsage();
  const entry = all[id2] ?? blankUsage();
  entry.sessionCalls = 0;
  entry.sessionTokens = 0;
  all[id2] = entry;
  db().kvSet(USAGE_KEY, JSON.stringify(all));
}
const BUILDS_KEY = "companion-builds";
function readBuilds() {
  try {
    const raw = db().kvGet(BUILDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function writeBuilds(records) {
  db().kvSet(BUILDS_KEY, JSON.stringify(records.slice(-10)));
}
function listBuilds() {
  return readBuilds().map((record) => ({
    id: record.id,
    companionId: record.companionId,
    label: record.label,
    at: record.at,
    blocks: record.placements.length,
    origin: record.origin,
    undoneAt: record.undoneAt
  })).reverse();
}
function undoBuild(buildId, companionId) {
  const records = readBuilds();
  const record = records.find((entry) => entry.id === buildId);
  if (!record) throw new LauncherError("NOT_FOUND", `no build with id ${buildId}`);
  const target = companionId || record.companionId;
  if (!target) throw new LauncherError("INVALID_INPUT", "no companion to undo this with");
  post(target, { type: "undoBuild", record });
  record.undoneAt = Date.now();
  writeBuilds(records);
}
function interruptCompanion(id2) {
  post(id2, { type: "interrupt" });
}
function setCameraEnabled(id2, on) {
  post(id2, { type: "camera", on });
}
function pushCrewSnapshot(id2, snapshot) {
  post(id2, { type: "crew", snapshot });
}
function stopCompanion(id2) {
  const entry = running$1.get(id2);
  if (!entry) return getCompanionState(id2);
  post(id2, { type: "stop" });
  const dying = entry.child;
  setTimeout(() => {
    if (dying && !dying.killed) dying.kill();
  }, 3e3);
  setStatus(id2, "idle", "stopping");
  return getCompanionState(id2);
}
function instructCompanion(id2, text) {
  if (!running$1.has(id2)) {
    throw new LauncherError("NOT_FOUND", "that companion is not running", {
      title: "That companion is not connected",
      message: "Start it before sending instructions.",
      actions: ["Press Start on the Companion screen"]
    });
  }
  pushEvent(id2, "chat", text, { from: "you" });
  post(id2, { type: "instruct", text: text.slice(0, 500) });
}
function sayAsCompanion(id2, text) {
  if (!running$1.has(id2)) return;
  post(id2, { type: "say", text: text.slice(0, 240) });
}
function clearCompanionMemory(id2) {
  const entry = running$1.get(id2);
  if (entry) entry.state.memory = [];
  saveMemory(id2, []);
  emit("companion:memory", { companionId: id2, notes: [] });
}
function shutdownCompanion() {
  for (const id2 of [...running$1.keys()]) {
    post(id2, { type: "stop" });
    killChild(id2, true);
  }
}
const log$m = createLogger("autopsy");
const LOG_TAIL_LINES = 220;
const MAX_REPORT_CHARS = 14e3;
const SYSTEM_PROMPT = `You diagnose Minecraft crashes for a launcher. You are given a crash report, the tail of the game log, and the list of installed mods.

Reply with JSON only, in exactly this shape:
{
  "summary": "one or two sentences, plain language, no jargon",
  "confidence": "high" | "medium" | "low",
  "suspects": [
    { "modFileName": "exact file name from the mod list, or null", "modName": "readable name", "why": "one sentence", "confidence": "high" | "medium" | "low" }
  ],
  "fixes": [
    { "kind": "disable-mod" | "update-mod" | "more-memory" | "less-memory" | "repair" | "manual",
      "label": "what the button should say",
      "detail": "one sentence saying what this does",
      "modFileName": "exact file name when the fix targets a mod, else null" }
  ]
}

Rules:
- Only name a mod in modFileName if that exact file name appears in the provided mod list. Otherwise use null.
- List at most 4 suspects and at most 4 fixes, best first.
- Prefer "disable-mod" or "update-mod" when a specific mod is implicated; "more-memory" only for genuine out-of-memory errors.
- If the log does not actually say why it crashed, say so in the summary and set confidence to "low". Do not invent a cause.
- Output the JSON object and nothing else.`;
function pickModel() {
  const companions = listCompanions();
  const usable = companions.filter((companion) => companion.model && companion.baseUrl);
  const preferred = usable.find((companion) => !companion.hasApiKey) ?? usable[0];
  if (!preferred) return null;
  return {
    baseUrl: preferred.baseUrl,
    apiKey: getSecret(`companion-llm-key-${preferred.id}`) ?? "",
    model: preferred.model
  };
}
async function autopsyAvailable() {
  if (pickModel() !== null) return true;
  return await findLocalModel() !== null;
}
function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start2 = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start2 < 0 || end <= start2) throw new Error("the model did not return JSON");
  return JSON.parse(candidate.slice(start2, end + 1));
}
function sanitise(raw, mods) {
  const object = raw ?? {};
  const known = new Set(mods.map((mod) => mod.fileName));
  const confidenceOf = (value) => value === "high" || value === "medium" ? value : "low";
  const modFileOf = (value) => typeof value === "string" && known.has(value) ? value : null;
  const suspects = Array.isArray(object.suspects) ? object.suspects.slice(0, 4).map((entry) => {
    const suspect = entry ?? {};
    return {
      modFileName: modFileOf(suspect.modFileName),
      modName: String(suspect.modName ?? "Unknown mod").slice(0, 120),
      why: String(suspect.why ?? "").slice(0, 400),
      confidence: confidenceOf(suspect.confidence)
    };
  }) : [];
  const allowedKinds = /* @__PURE__ */ new Set(["disable-mod", "update-mod", "more-memory", "less-memory", "repair", "manual"]);
  const fixes = Array.isArray(object.fixes) ? object.fixes.slice(0, 4).map((entry) => {
    const fix = entry ?? {};
    const kind = allowedKinds.has(String(fix.kind)) ? fix.kind : "manual";
    const modFileName = modFileOf(fix.modFileName);
    return {
      // A mod-targeted fix with no valid mod behind it is a button that
      // would do nothing; demote it to advice instead of offering it.
      kind: (kind === "disable-mod" || kind === "update-mod") && !modFileName ? "manual" : kind,
      label: String(fix.label ?? "Try this").slice(0, 80),
      detail: String(fix.detail ?? "").slice(0, 300),
      modFileName
    };
  }) : [];
  return {
    summary: String(object.summary ?? "The model did not explain the crash.").slice(0, 900),
    confidence: confidenceOf(object.confidence),
    suspects,
    fixes,
    model: ""
  };
}
async function diagnoseWithModel(instance, crash) {
  const config = pickModel() ?? await findLocalModel();
  if (!config) {
    throw new LauncherError("INVALID_INPUT", "no model configured", {
      title: "No model is set up to read the crash",
      message: "Crash Autopsy uses the same model as your AI companion. Set one up on the Companion screen — Ollama runs locally and costs nothing.",
      actions: ["Open the Companion screen and configure a model", 'Then press "Explain this crash" again']
    });
  }
  const mods = await analyseMods(instance).catch(() => []);
  const enabled = mods.filter((mod) => mod.enabled);
  let report = "";
  if (crash?.reportPath) {
    try {
      report = redact(await promises.readFile(crash.reportPath, "utf8")).slice(0, MAX_REPORT_CHARS);
    } catch {
    }
  }
  const logTail2 = recentLogs(instance.id, LOG_TAIL_LINES).map((line) => line.line).join("\n").slice(-MAX_REPORT_CHARS);
  if (!report && !logTail2.trim()) {
    throw new LauncherError("NOT_FOUND", "nothing to read", {
      title: "There is nothing to diagnose",
      message: "No crash report was written and the game log is empty, so there is no evidence to read.",
      actions: ["Launch the game again and let it fail, then try once more"]
    });
  }
  const modList = enabled.map((mod) => `${mod.fileName} — ${mod.name}${mod.version ? ` ${mod.version}` : ""}`).join("\n").slice(0, 12e3);
  const context = [
    `Minecraft ${instance.minecraftVersion}, loader: ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}`,
    `Memory: ${instance.java.minRamMb}–${instance.java.maxRamMb} MB`,
    crash?.cause ? `Reported cause: ${crash.cause}` : null,
    crash?.description ? `Doing: ${crash.description}` : null,
    crash?.explanation ? `The launcher already recognised this as: ${crash.explanation}` : null,
    "",
    `Enabled mods (${enabled.length}):`,
    modList || "(none)",
    "",
    report ? `Crash report:
${report}` : null,
    logTail2 ? `Log tail:
${logTail2}` : null
  ].filter(Boolean).join("\n");
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context }
  ];
  log$m.info(`asking ${config.model} to read a crash in "${instance.name}"`);
  let reply;
  try {
    reply = await hostResolve.chat({ ...config, temperature: 0.2, timeoutMs: 12e4 }, messages, []);
  } catch (err) {
    if (err instanceof hostResolve.LlmError) {
      throw new LauncherError("UNKNOWN", err.message, {
        title: "The model could not read the crash",
        message: err.message.slice(0, 300),
        actions: ["Check the model works on the Companion screen", "Then try again"]
      });
    }
    throw err;
  }
  let parsed;
  try {
    parsed = sanitise(extractJson(reply.content ?? ""), mods);
  } catch (err) {
    log$m.warn(`the model's answer was not usable: ${err.message}`);
    throw new LauncherError("UNKNOWN", "unparseable model reply", {
      title: "The model did not answer in a usable form",
      message: "It replied, but not with the structured diagnosis the launcher asked for. Smaller local models sometimes do this.",
      actions: ['Press "Explain this crash" again', "Or try a larger model on the Companion screen"]
    });
  }
  parsed.model = config.model;
  return parsed;
}
const log$l = createLogger("content");
const DISABLED_SUFFIX = ".disabled";
function contentDir(instance, kind) {
  return instanceSubdir(instance, kind);
}
function parsePackMcmeta(text) {
  try {
    const json = JSON.parse(text);
    const description = json.pack?.description;
    return {
      // Descriptions may be a raw string or Minecraft's JSON text component.
      description: typeof description === "string" ? description : description ? flattenTextComponent(description) : null,
      packFormat: typeof json.pack?.pack_format === "number" ? json.pack.pack_format : null
    };
  } catch {
    return { description: null, packFormat: null };
  }
}
function flattenTextComponent(component) {
  if (typeof component === "string") return component;
  if (Array.isArray(component)) return component.map(flattenTextComponent).join("");
  if (component && typeof component === "object") {
    const node = component;
    return `${node.text ?? ""}${(node.extra ?? []).map(flattenTextComponent).join("")}`;
  }
  return "";
}
function toDataUrl(data, ext) {
  if (data.byteLength === 0 || data.byteLength > 2 * 1024 * 1024) return null;
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${data.toString("base64")}`;
}
async function readPack(dir, fileName) {
  const full = node_path.join(dir, fileName);
  const enabled = !fileName.endsWith(DISABLED_SUFFIX);
  const bare = enabled ? fileName : fileName.slice(0, -DISABLED_SUFFIX.length);
  const info = await promises.stat(full);
  let meta = { description: null, packFormat: null };
  let iconDataUrl = null;
  if (info.isDirectory()) {
    const mcmeta = node_path.join(full, "pack.mcmeta");
    if (node_fs.existsSync(mcmeta)) meta = parsePackMcmeta(await promises.readFile(mcmeta, "utf8").catch(() => ""));
    const icon = node_path.join(full, "pack.png");
    if (node_fs.existsSync(icon)) iconDataUrl = toDataUrl(await promises.readFile(icon).catch(() => Buffer.alloc(0)), ".png");
  } else if (/\.(zip|jar)(\.disabled)?$/i.test(fileName)) {
    try {
      const zip = new AdmZip(full);
      const mcmeta = zip.getEntry("pack.mcmeta");
      if (mcmeta) meta = parsePackMcmeta(mcmeta.getData().toString("utf8"));
      const icon = zip.getEntry("pack.png");
      if (icon) iconDataUrl = toDataUrl(icon.getData(), ".png");
    } catch {
      log$l.warn(`could not read pack archive ${fileName}`);
    }
  }
  return {
    path: full,
    fileName,
    name: bare.replace(/\.(zip|jar)$/i, ""),
    description: meta.description,
    iconDataUrl,
    packFormat: meta.packFormat,
    enabled,
    isDirectory: info.isDirectory(),
    sizeBytes: info.isDirectory() ? 0 : info.size
  };
}
async function listContent(instance, kind) {
  const dir = contentDir(instance, kind);
  let entries;
  try {
    entries = (await promises.readdir(dir)).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
  const packs = [];
  for (const name of entries) {
    try {
      packs.push(await readPack(dir, name));
    } catch {
    }
  }
  packs.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  return packs;
}
async function setContentEnabled(instance, kind, fileName, enabled) {
  const dir = contentDir(instance, kind);
  const current = assertInside(dir, node_path.join(dir, fileName));
  if (!node_fs.existsSync(current)) throw new LauncherError("NOT_FOUND", "that pack no longer exists");
  const isDisabled = fileName.endsWith(DISABLED_SUFFIX);
  if (enabled === !isDisabled) return;
  const nextName = enabled ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName + DISABLED_SUFFIX;
  await renameWhenFree(current, assertInside(dir, node_path.join(dir, nextName)));
}
async function deleteContent(instance, kind, fileName) {
  const dir = contentDir(instance, kind);
  const target = assertInside(dir, node_path.join(dir, fileName));
  await promises.rm(target, { recursive: true, force: true });
  log$l.info(`removed ${kind} entry ${fileName}`);
}
const ALLOWED_EXTENSIONS = {
  resourcepacks: /\.zip$/i,
  shaderpacks: /\.(zip|zip\.txt)$/i
};
async function importContent(instance, kind, files) {
  const dir = contentDir(instance, kind);
  await promises.mkdir(dir, { recursive: true });
  let imported = 0;
  for (const file2 of files) {
    if (!ALLOWED_EXTENSIONS[kind].test(file2)) continue;
    let target = node_path.join(dir, node_path.basename(file2));
    let counter = 1;
    while (node_fs.existsSync(target)) {
      const ext = node_path.extname(file2);
      target = node_path.join(dir, `${node_path.basename(file2, ext)} (${counter})${ext}`);
      counter++;
    }
    try {
      await promises.copyFile(file2, target);
      imported++;
    } catch (err) {
      log$l.warn(`could not import ${file2}: ${err.message}`);
    }
  }
  return imported;
}
async function listScreenshots(instance, limit = 60) {
  const dir = instanceSubdir(instance, "screenshots");
  let names;
  try {
    names = (await promises.readdir(dir)).filter((name) => /\.(png|jpg|jpeg)$/i.test(name));
  } catch {
    return [];
  }
  const shots = [];
  for (const name of names) {
    const full = node_path.join(dir, name);
    try {
      const info = await promises.stat(full);
      shots.push({ fileName: name, path: full, takenAt: info.mtimeMs, sizeBytes: info.size, dataUrl: null });
    } catch {
    }
  }
  shots.sort((a, b) => b.takenAt - a.takenAt);
  const recent = shots.slice(0, limit);
  for (const shot of recent) {
    if (shot.sizeBytes > 6 * 1024 * 1024) continue;
    try {
      shot.dataUrl = toDataUrl(await promises.readFile(shot.path), node_path.extname(shot.fileName).toLowerCase());
    } catch {
    }
  }
  return recent;
}
const gunzipAsync = node_util.promisify(node_zlib.gunzip);
const inflateAsync = node_util.promisify(node_zlib.inflate);
const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;
class NbtReader {
  constructor(buffer) {
    this.buffer = buffer;
  }
  offset = 0;
  need(bytes) {
    if (this.offset + bytes > this.buffer.length) throw new Error("unexpected end of NBT data");
  }
  readByte() {
    this.need(1);
    return this.buffer.readInt8(this.offset++);
  }
  readShort() {
    this.need(2);
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }
  readUShort() {
    this.need(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }
  readInt() {
    this.need(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }
  readLong() {
    this.need(8);
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }
  readFloat() {
    this.need(4);
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }
  readDouble() {
    this.need(8);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }
  readString() {
    const length = this.readUShort();
    this.need(length);
    const value = this.buffer.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  readPayload(type) {
    switch (type) {
      case TAG_BYTE:
        return this.readByte();
      case TAG_SHORT:
        return this.readShort();
      case TAG_INT:
        return this.readInt();
      case TAG_LONG:
        return this.readLong();
      case TAG_FLOAT:
        return this.readFloat();
      case TAG_DOUBLE:
        return this.readDouble();
      case TAG_BYTE_ARRAY: {
        const length = this.readInt();
        this.need(length);
        const value = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
      }
      case TAG_STRING:
        return this.readString();
      case TAG_LIST: {
        const itemType = this.readByte();
        const length = this.readInt();
        const items = [];
        for (let i = 0; i < length; i++) {
          if (itemType === TAG_END) break;
          items.push(this.readPayload(itemType));
        }
        return items;
      }
      case TAG_COMPOUND: {
        const compound = {};
        for (; ; ) {
          const childType = this.readByte();
          if (childType === TAG_END) break;
          const name = this.readString();
          compound[name] = this.readPayload(childType);
        }
        return compound;
      }
      case TAG_INT_ARRAY: {
        const length = this.readInt();
        const array = new Int32Array(length);
        for (let i = 0; i < length; i++) array[i] = this.readInt();
        return array;
      }
      case TAG_LONG_ARRAY: {
        const length = this.readInt();
        const array = new BigInt64Array(length);
        for (let i = 0; i < length; i++) array[i] = this.readLong();
        return array;
      }
      default:
        throw new Error(`unknown NBT tag type ${type}`);
    }
  }
}
async function parseNbt(data) {
  let raw = data;
  if (data[0] === 31 && data[1] === 139) raw = Buffer.from(await gunzipAsync(data));
  else if (data[0] === 120) raw = Buffer.from(await inflateAsync(data));
  const reader = new NbtReader(raw);
  const rootType = reader.readByte();
  if (rootType !== TAG_COMPOUND) throw new Error("NBT root tag is not a compound");
  reader.readString();
  return reader.readPayload(TAG_COMPOUND);
}
function nbtString(value) {
  return typeof value === "string" ? value : null;
}
function nbtNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : null;
  }
  return null;
}
function nbtCompound(value) {
  return value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value) ? value : null;
}
const SECTOR_BYTES = 4096;
const CHUNK_SIZE = 16;
function unpackLongs(values, bits, count) {
  const out = new Int16Array(count);
  const perLong = Math.floor(64 / bits);
  const mask = (1n << BigInt(bits)) - 1n;
  let index = 0;
  for (const word of values) {
    for (let slot = 0; slot < perLong && index < count; slot += 1) {
      out[index++] = Number(word >> BigInt(slot * bits) & mask);
    }
    if (index >= count) break;
  }
  return out;
}
function decompress(scheme, payload) {
  try {
    if (scheme === 1) return node_zlib.gunzipSync(payload);
    if (scheme === 2) return node_zlib.inflateSync(payload);
    if (scheme === 3) return payload;
  } catch {
  }
  return null;
}
async function readRegion(filePath) {
  const name = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(filePath);
  if (!name) return null;
  const regionX = Number(name[1]);
  const regionZ = Number(name[2]);
  let data;
  try {
    data = await promises.readFile(filePath);
  } catch {
    return null;
  }
  if (data.length < SECTOR_BYTES * 2) return null;
  const nbt = require("prismarine-nbt");
  const chunks = [];
  for (let entry = 0; entry < 1024; entry += 1) {
    const headerAt = entry * 4;
    const offsetSectors = data[headerAt] << 16 | data[headerAt + 1] << 8 | data[headerAt + 2];
    const sectorCount = data[headerAt + 3];
    if (offsetSectors === 0 || sectorCount === 0) continue;
    const start2 = offsetSectors * SECTOR_BYTES;
    if (start2 + 5 > data.length) continue;
    const length = data.readUInt32BE(start2);
    const scheme = data[start2 + 4];
    const payload = data.subarray(start2 + 5, start2 + 4 + length);
    if (payload.length === 0) continue;
    const raw = decompress(scheme, payload);
    if (!raw) continue;
    let simple;
    try {
      const { parsed } = await nbt.parse(raw);
      simple = nbt.simplify(parsed);
    } catch {
      continue;
    }
    const chunk = simple.Level ?? simple;
    const heightmaps = chunk.Heightmaps;
    const packed = heightmaps?.MOTION_BLOCKING ?? heightmaps?.WORLD_SURFACE;
    if (!packed) continue;
    const words = packed.map((value) => {
      if (Array.isArray(value)) {
        const [high, low] = value;
        return BigInt(high) << 32n | BigInt(low >>> 0);
      }
      return BigInt(value);
    });
    const heights = unpackLongs(words, 9, CHUNK_SIZE * CHUNK_SIZE);
    const floor = typeof chunk.yPos === "number" ? chunk.yPos * 16 : 0;
    if (floor !== 0) {
      for (let i = 0; i < heights.length; i += 1) heights[i] += floor;
    }
    chunks.push({
      chunkX: regionX * 32 + entry % 32,
      chunkZ: regionZ * 32 + Math.floor(entry / 32),
      heights
    });
  }
  return chunks.length > 0 ? { regionX, regionZ, chunks } : null;
}
async function readWorldMap(regionDir, maxRegions = 64) {
  let names;
  try {
    names = (await promises.readdir(regionDir)).filter((file2) => file2.endsWith(".mca"));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const ordered = names.map((file2) => {
    const match = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(file2);
    return match ? { file: file2, x: Number(match[1]), z: Number(match[2]) } : null;
  }).filter((entry) => entry !== null).sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z)).slice(0, maxRegions);
  const regions = [];
  for (const entry of ordered) {
    const region = await readRegion(node_path.join(regionDir, entry.file));
    if (region) regions.push(region);
  }
  if (regions.length === 0) return null;
  let minChunkX = Infinity;
  let maxChunkX = -Infinity;
  let minChunkZ = Infinity;
  let maxChunkZ = -Infinity;
  for (const region of regions) {
    for (const chunk of region.chunks) {
      if (chunk.chunkX < minChunkX) minChunkX = chunk.chunkX;
      if (chunk.chunkX > maxChunkX) maxChunkX = chunk.chunkX;
      if (chunk.chunkZ < minChunkZ) minChunkZ = chunk.chunkZ;
      if (chunk.chunkZ > maxChunkZ) maxChunkZ = chunk.chunkZ;
    }
  }
  const width = (maxChunkX - minChunkX + 1) * CHUNK_SIZE;
  const height = (maxChunkZ - minChunkZ + 1) * CHUNK_SIZE;
  const heights = new Int16Array(width * height).fill(-1);
  let low = Infinity;
  let high = -Infinity;
  let chunkCount = 0;
  for (const region of regions) {
    for (const chunk of region.chunks) {
      chunkCount += 1;
      const baseX = (chunk.chunkX - minChunkX) * CHUNK_SIZE;
      const baseZ = (chunk.chunkZ - minChunkZ) * CHUNK_SIZE;
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const value = chunk.heights[z * CHUNK_SIZE + x];
          heights[(baseZ + z) * width + (baseX + x)] = value;
          if (value < low) low = value;
          if (value > high) high = value;
        }
      }
    }
  }
  return {
    minX: minChunkX * CHUNK_SIZE,
    minZ: minChunkZ * CHUNK_SIZE,
    width,
    height,
    heights,
    chunks: chunkCount,
    regions: regions.length,
    low: Number.isFinite(low) ? low : 0,
    high: Number.isFinite(high) ? high : 0
  };
}
const log$k = createLogger("worlds");
async function worldMap(instance, folderName) {
  const regionDir = node_path.join(savesDir(instance), folderName, "region");
  const map = await readWorldMap(regionDir);
  if (!map) return null;
  const step = Math.max(1, Math.ceil(Math.max(map.width, map.height) / 900));
  const width = Math.floor(map.width / step);
  const height = Math.floor(map.height / step);
  const out = new Int16Array(width * height);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = -1;
      for (let dz = 0; dz < step; dz += 1) {
        for (let dx = 0; dx < step; dx += 1) {
          const value = map.heights[(z * step + dz) * map.width + (x * step + dx)];
          if (value > best) best = value;
        }
      }
      out[z * width + x] = best;
    }
  }
  return {
    minX: map.minX,
    minZ: map.minZ,
    width,
    height,
    step,
    low: map.low,
    high: map.high,
    chunks: map.chunks,
    regions: map.regions,
    heights: new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  };
}
function savesDir(instance) {
  return instanceSubdir(instance, "saves");
}
function backupsDir(instance) {
  return ensureDir(node_path.join(instanceDir(instance.id), "backups"));
}
const GAME_MODES = {
  0: "Survival",
  1: "Creative",
  2: "Adventure",
  3: "Spectator"
};
async function directorySize(dir) {
  let total = 0;
  try {
    for (const entry of await promises.readdir(dir, { withFileTypes: true })) {
      const full = node_path.join(dir, entry.name);
      if (entry.isDirectory()) total += await directorySize(full);
      else if (entry.isFile()) total += (await promises.stat(full)).size.valueOf();
    }
  } catch {
  }
  return total;
}
async function readWorld(savesRoot, folderName) {
  const path2 = node_path.join(savesRoot, folderName);
  let info;
  try {
    info = await promises.stat(path2);
  } catch {
    return null;
  }
  if (!info.isDirectory()) return null;
  const world = {
    folderName,
    path: path2,
    name: folderName,
    lastPlayed: null,
    gameVersion: null,
    gameMode: null,
    hardcore: false,
    iconDataUrl: null,
    sizeBytes: 0,
    corrupt: false
  };
  const iconPath = node_path.join(path2, "icon.png");
  if (node_fs.existsSync(iconPath)) {
    try {
      const data = await promises.readFile(iconPath);
      if (data.byteLength > 0 && data.byteLength < 2 * 1024 * 1024) {
        world.iconDataUrl = `data:image/png;base64,${data.toString("base64")}`;
      }
    } catch {
    }
  }
  const levelDat = node_path.join(path2, "level.dat");
  if (!node_fs.existsSync(levelDat)) {
    world.corrupt = true;
    return world;
  }
  try {
    const root = await parseNbt(await promises.readFile(levelDat));
    const data = nbtCompound(root.Data);
    if (!data) throw new Error("level.dat has no Data compound");
    world.name = nbtString(data.LevelName) ?? folderName;
    world.lastPlayed = nbtNumber(data.LastPlayed);
    world.hardcore = nbtNumber(data.hardcore) === 1;
    const gameType = nbtNumber(data.GameType);
    world.gameMode = gameType != null ? GAME_MODES[gameType] ?? null : null;
    const version = nbtCompound(data.Version);
    world.gameVersion = version ? nbtString(version.Name) : null;
  } catch (err) {
    log$k.warn(`could not read level.dat for "${folderName}": ${err.message}`);
    world.corrupt = true;
  }
  world.sizeBytes = await directorySize(path2);
  return world;
}
async function listWorlds(instance) {
  const root = savesDir(instance);
  let entries;
  try {
    entries = await promises.readdir(root);
  } catch {
    return [];
  }
  const worlds = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const world = await readWorld(root, name);
    if (world) worlds.push(world);
  }
  worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name));
  return worlds;
}
function timestamp$1() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}
function safeName(name) {
  return name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 60) || "world";
}
async function backupWorld(instance, folderName) {
  const saves = savesDir(instance);
  const source = assertInside(saves, node_path.join(saves, folderName));
  if (!node_fs.existsSync(source)) throw new LauncherError("NOT_FOUND", "that world no longer exists");
  const dir = backupsDir(instance);
  await promises.mkdir(dir, { recursive: true });
  const fileName = `${safeName(folderName)}_${timestamp$1()}.zip`;
  const output = node_path.join(dir, fileName);
  log$k.info(`backing up world "${folderName}" from ${instance.name}`);
  const result = await zipDirectory(source, output, (progress2) => {
    emit("download:progress", {
      taskId: `backup:${instance.id}`,
      instanceId: instance.id,
      phase: "verifying",
      label: `Backing up ${folderName}`,
      currentFile: progress2.file,
      completedFiles: progress2.completed,
      totalFiles: progress2.total,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      paused: false,
      errors: [],
      active: progress2.completed < progress2.total
    });
  });
  log$k.info(`backup complete: ${fileName} (${result.entries} files, ${result.bytes} bytes)`);
  return {
    fileName,
    path: output,
    sizeBytes: result.bytes,
    createdAt: Date.now(),
    worldName: folderName
  };
}
async function listBackups(instance) {
  const dir = backupsDir(instance);
  let names;
  try {
    names = (await promises.readdir(dir)).filter((name) => name.endsWith(".zip"));
  } catch {
    return [];
  }
  const backups = [];
  for (const name of names) {
    try {
      const info = await promises.stat(node_path.join(dir, name));
      backups.push({
        fileName: name,
        path: node_path.join(dir, name),
        sizeBytes: info.size,
        createdAt: info.mtimeMs,
        // Everything before the timestamp suffix is the world folder name.
        worldName: name.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/, "")
      });
    } catch {
    }
  }
  backups.sort((a, b) => b.createdAt - a.createdAt);
  return backups;
}
async function deleteBackup(instance, fileName) {
  const dir = backupsDir(instance);
  const target = assertInside(dir, node_path.join(dir, fileName));
  await promises.rm(target, { force: true });
}
async function importWorldArchive(instance, filePath) {
  const AdmZip2 = (await import("adm-zip")).default;
  let zip;
  try {
    zip = new AdmZip2(filePath);
  } catch {
    throw new LauncherError("INVALID_INPUT", "not a readable zip archive", {
      title: "That file is not a world archive",
      message: "A Minecraft world is a folder containing level.dat, usually shared as a .zip.",
      actions: ["Check the file downloaded completely", "Drop the .zip you received rather than an extracted folder"]
    });
  }
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const levelEntry = entries.filter((entry) => entry.entryName.toLowerCase().endsWith("level.dat")).sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0];
  if (!levelEntry) {
    throw new LauncherError("INVALID_INPUT", "no level.dat in the archive", {
      title: "That archive is not a Minecraft world",
      message: "It contains no level.dat, which every world has at its root.",
      actions: ["Make sure you are importing a world, not a modpack or resource pack"]
    });
  }
  const prefix = levelEntry.entryName.slice(0, levelEntry.entryName.length - "level.dat".length);
  const suggested = safeName(prefix.replace(/\/$/, "").split("/").pop() || node_path.basename(filePath).replace(/\.zip$/i, ""));
  const saves = savesDir(instance);
  await promises.mkdir(saves, { recursive: true });
  let folderName = suggested;
  let suffix = 2;
  while (node_fs.existsSync(node_path.join(saves, folderName))) {
    folderName = `${suggested} (${suffix})`;
    suffix += 1;
  }
  const destination = assertInside(saves, node_path.join(saves, folderName));
  await promises.mkdir(destination, { recursive: true });
  let written = 0;
  try {
    for (const entry of entries) {
      if (prefix && !entry.entryName.startsWith(prefix)) continue;
      const relative = entry.entryName.slice(prefix.length);
      if (!relative || relative.includes("..")) continue;
      const target = assertInside(destination, node_path.join(destination, ...relative.split("/")));
      await promises.mkdir(node_path.join(target, ".."), { recursive: true });
      await promises.writeFile(target, entry.getData());
      written += 1;
    }
  } catch (err) {
    await promises.rm(destination, { recursive: true, force: true }).catch(() => void 0);
    throw err;
  }
  log$k.info(`imported world "${folderName}" into ${instance.name} (${written} files)`);
  const world = await readWorld(saves, folderName);
  if (!world) throw new LauncherError("INSTANCE_CORRUPT", "the imported world could not be read back");
  return world;
}
async function restoreBackup(instance, fileName) {
  const dir = backupsDir(instance);
  const archive = assertInside(dir, node_path.join(dir, fileName));
  if (!node_fs.existsSync(archive)) throw new LauncherError("NOT_FOUND", "that backup no longer exists");
  const AdmZip2 = (await import("adm-zip")).default;
  const zip = new AdmZip2(archive);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const stamped = fileName.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/, "");
  const saves = savesDir(instance);
  let existing = [];
  try {
    existing = (await promises.readdir(saves, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
  }
  const worldName = existing.find((folder) => folder === stamped) ?? existing.find((folder) => safeName(folder) === stamped) ?? stamped;
  const destination = assertInside(saves, node_path.join(saves, worldName));
  if (node_fs.existsSync(destination)) {
    await backupWorld(instance, worldName);
    await promises.rm(destination, { recursive: true, force: true });
  }
  await promises.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.entryName.includes("..")) continue;
    const target = assertInside(destination, node_path.join(destination, ...entry.entryName.split("/")));
    await promises.mkdir(node_path.join(target, ".."), { recursive: true });
    await promises.writeFile(target, entry.getData());
  }
  log$k.info(`restored "${worldName}" in ${instance.name} from ${fileName}`);
  const world = await readWorld(saves, worldName);
  if (!world) throw new LauncherError("INSTANCE_CORRUPT", "the restored world could not be read back");
  return world;
}
async function deleteWorld(instance, folderName) {
  const saves = savesDir(instance);
  const target = assertInside(saves, node_path.join(saves, folderName));
  if (!node_fs.existsSync(target)) throw new LauncherError("NOT_FOUND", "that world no longer exists");
  const backup = await backupWorld(instance, folderName);
  await promises.rm(target, { recursive: true, force: true });
  log$k.info(`deleted world "${folderName}" (backup kept at ${backup.fileName})`);
  return backup;
}
function versionsForProtocol(protocol) {
  if (protocol === null || !Number.isFinite(protocol) || protocol < 0) return [];
  try {
    const mcData = require("minecraft-data");
    return mcData.versions.pc.filter((entry) => entry.version === protocol && entry.releaseType !== "snapshot").map((entry) => entry.minecraftVersion);
  } catch {
    return [];
  }
}
function releaseOrder() {
  try {
    const mcData = require("minecraft-data");
    return mcData.versions.pc.filter((entry) => entry.releaseType !== "snapshot").map((entry) => entry.minecraftVersion);
  } catch {
    return [];
  }
}
function versionsFromName(versionName) {
  if (!versionName) return [];
  const order = releaseOrder();
  if (order.length === 0) return [];
  const rank = new Map(order.map((version, index) => [version, index]));
  const tokens = (versionName.match(/\d+\.\d+(?:\.\d+)?/g) ?? []).filter((token) => rank.has(token));
  if (tokens.length === 0) return [];
  if (tokens.length === 1) return [tokens[0]];
  const positions = tokens.map((token) => rank.get(token));
  const newest = Math.min(...positions);
  const oldest = Math.max(...positions);
  return order.slice(newest, oldest + 1);
}
function rankInstancesForServer(status2, instances) {
  const serverVersions = versionsForProtocol(status2?.protocol ?? null).length > 0 ? versionsForProtocol(status2?.protocol ?? null) : versionsFromName(status2?.versionName ?? null);
  if (serverVersions.length === 0) return { candidates: [], serverVersions };
  const majors = new Set(serverVersions.map(majorOf));
  const candidates = [];
  for (const instance of instances) {
    const exact = serverVersions.includes(instance.minecraftVersion);
    const sameMajor = majors.has(majorOf(instance.minecraftVersion));
    if (!exact && !sameMajor) continue;
    const vanilla = instance.loader === "vanilla";
    const rank = exact ? vanilla ? 0 : 1 : vanilla ? 2 : 3;
    candidates.push({
      instance,
      rank,
      reason: exact ? vanilla ? `matches ${instance.minecraftVersion} exactly` : `matches ${instance.minecraftVersion}, with ${loaderLabel(instance.loader)}` : `close enough — ${instance.minecraftVersion} against a ${serverVersions[0]} server`
    });
  }
  const newness = new Map(serverVersions.map((version, index) => [version, index]));
  candidates.sort(
    (a, b) => a.rank - b.rank || (newness.get(a.instance.minecraftVersion) ?? 9999) - (newness.get(b.instance.minecraftVersion) ?? 9999) || a.instance.name.localeCompare(b.instance.name)
  );
  return { candidates, serverVersions };
}
function majorOf(version) {
  const parts = version.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
}
function loaderLabel(loader) {
  switch (loader) {
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "neoforge":
      return "NeoForge";
    case "quilt":
      return "Quilt";
    default:
      return "no loader";
  }
}
const log$j = createLogger("restarts");
const SETTINGS_KEY$2 = "server-restart-settings";
const DEFAULTS$2 = {
  enabled: false,
  intervalHours: 12,
  warnMinutes: 5,
  skipIfPlayers: true
};
function readAll$2() {
  const raw = db().kvGet(SETTINGS_KEY$2);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function serverRestartSettings(serverId) {
  return { ...DEFAULTS$2, ...readAll$2()[serverId] };
}
function setServerRestartSettings(serverId, patch) {
  const all = readAll$2();
  const next = { ...DEFAULTS$2, ...all[serverId], ...patch };
  next.intervalHours = Math.min(Math.max(Math.round(next.intervalHours), 1), 168);
  next.warnMinutes = Math.min(Math.max(Math.round(next.warnMinutes), 0), 30);
  all[serverId] = next;
  db().kvSet(SETTINGS_KEY$2, JSON.stringify(all));
  reschedule$1(serverId);
  return next;
}
const scheduled = /* @__PURE__ */ new Map();
function nextRestartAt(serverId) {
  return scheduled.get(serverId)?.dueAt ?? null;
}
function clearTimer$1(serverId) {
  const entry = scheduled.get(serverId);
  if (entry) clearTimeout(entry.timer);
  scheduled.delete(serverId);
}
async function performRestart(serverId) {
  const settings = serverRestartSettings(serverId);
  let server2;
  try {
    server2 = getHostedServer(serverId);
  } catch {
    return;
  }
  if (!isHostedServerRunning(serverId)) {
    log$j.info(`${server2.name} is not running; skipping its restart`);
    return;
  }
  if (settings.skipIfPlayers) {
    const state = listHostedServers().find((entry) => entry.id === serverId);
    if (state) {
      const { allHostedServerStates: allHostedServerStates2 } = await Promise.resolve().then(() => hostService);
      const live = allHostedServerStates2().find((entry) => entry.id === serverId);
      if (live && live.players.length > 0) {
        log$j.info(`${server2.name} has ${live.players.length} player(s) on; postponing the restart`);
        reschedule$1(serverId);
        return;
      }
    }
  }
  const warn = settings.warnMinutes;
  if (warn > 0) {
    const say = (text) => {
      try {
        sendHostedServerCommand(serverId, `say ${text}`);
      } catch {
      }
    };
    say(`Server restarting in ${warn} minute${warn === 1 ? "" : "s"}.`);
    const finalWarnAt = Math.max(0, warn * 6e4 - 3e4);
    await new Promise((resolve) => setTimeout(resolve, finalWarnAt));
    say("Server restarting in 30 seconds — find somewhere safe.");
    await new Promise((resolve) => setTimeout(resolve, 3e4));
  }
  try {
    log$j.info(`restarting ${server2.name} on schedule`);
    await stopHostedServer(serverId);
    await new Promise((resolve) => setTimeout(resolve, 4e3));
    await startHostedServer(serverId);
    notifyDesktop({
      title: `${server2.name} restarted`,
      body: "The scheduled restart finished and the server is starting again."
    });
  } catch (err) {
    log$j.warn(`scheduled restart of ${server2.name} failed: ${err.message}`);
    notifyDesktop({
      title: `${server2.name} did not restart`,
      body: err.message,
      onlyWhenAway: false
    });
  }
}
function reschedule$1(serverId) {
  clearTimer$1(serverId);
  const settings = serverRestartSettings(serverId);
  if (!settings.enabled || !isHostedServerRunning(serverId)) return;
  const delay2 = Math.max(6e4, settings.intervalHours * 36e5 - settings.warnMinutes * 6e4);
  const timer2 = setTimeout(() => {
    void performRestart(serverId);
  }, delay2);
  timer2.unref();
  scheduled.set(serverId, { timer: timer2, dueAt: Date.now() + delay2 + settings.warnMinutes * 6e4 });
  log$j.info(`next restart for ${serverId} in ${Math.round(delay2 / 6e4)} min`);
}
function initRestartScheduler() {
  void Promise.resolve().then(() => hostService).then(({ onHostedServerEvent: onHostedServerEvent2 }) => {
    onHostedServerEvent2((event, serverId) => {
      if (event === "ready") reschedule$1(serverId);
      else if (event === "stopped") clearTimer$1(serverId);
    });
  });
  for (const server2 of listHostedServers()) {
    if (isHostedServerRunning(server2.id)) reschedule$1(server2.id);
  }
  log$j.info("server restart scheduler ready");
}
const log$i = createLogger("import");
function candidateRoots() {
  const home = node_os.homedir();
  const appData = process.env.APPDATA ?? node_path.join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? node_path.join(home, "AppData", "Local");
  return [
    { launcher: "curseforge", dir: node_path.join(home, "curseforge", "minecraft", "Instances") },
    { launcher: "curseforge", dir: node_path.join(home, "Documents", "curseforge", "minecraft", "Instances") },
    { launcher: "prism", dir: node_path.join(appData, "PrismLauncher", "instances") },
    { launcher: "prism", dir: node_path.join(localAppData, "Programs", "PrismLauncher", "instances") },
    { launcher: "multimc", dir: node_path.join(appData, "MultiMC", "instances") },
    { launcher: "modrinth", dir: node_path.join(appData, "com.modrinth.theseus", "profiles") },
    { launcher: "modrinth", dir: node_path.join(appData, "ModrinthApp", "profiles") },
    { launcher: "gdlauncher", dir: node_path.join(appData, "gdlauncher_next", "instances") },
    { launcher: "vanilla", dir: node_path.join(appData, ".minecraft") }
  ];
}
function loaderFrom(text) {
  const lower = text.toLowerCase();
  if (lower.includes("neoforge")) return "neoforge";
  if (lower.includes("forge")) return "forge";
  if (lower.includes("fabric")) return "fabric";
  if (lower.includes("quilt")) return "quilt";
  return "vanilla";
}
async function countIn(dir, filter) {
  try {
    return (await promises.readdir(dir)).filter(filter).length;
  } catch {
    return 0;
  }
}
async function roughSize(dir) {
  let total = 0;
  try {
    for (const name of await promises.readdir(dir, { withFileTypes: true })) {
      const path2 = node_path.join(dir, name.name);
      try {
        if (name.isFile()) total += (await promises.stat(path2)).size;
        else if (name.isDirectory()) {
          for (const inner of await promises.readdir(path2, { withFileTypes: true })) {
            if (inner.isFile()) total += (await promises.stat(node_path.join(path2, inner.name))).size;
          }
        }
      } catch {
      }
    }
  } catch {
  }
  return total;
}
async function readCurseForge(dir, name) {
  const manifest = node_path.join(dir, "minecraftinstance.json");
  if (!node_fs.existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(await promises.readFile(manifest, "utf8"));
    const minecraftVersion = parsed.baseModLoader?.minecraftVersion ?? parsed.gameVersion ?? "";
    if (!minecraftVersion) return null;
    const loaderName = parsed.baseModLoader?.name ?? "";
    return {
      id: `curseforge:${name}`,
      launcher: "curseforge",
      name: parsed.name ?? name,
      minecraftVersion,
      loader: loaderFrom(loaderName),
      loaderVersion: parsed.baseModLoader?.forgeVersion ?? null,
      gameDir: dir,
      mods: await countIn(node_path.join(dir, "mods"), (file2) => file2.endsWith(".jar")),
      worlds: await countIn(node_path.join(dir, "saves"), () => true),
      sizeBytes: await roughSize(dir)
    };
  } catch {
    return null;
  }
}
async function readPrismLike(dir, name, launcher) {
  const config = node_path.join(dir, "instance.cfg");
  if (!node_fs.existsSync(config)) return null;
  const gameDir = ["minecraft", ".minecraft"].map((entry) => node_path.join(dir, entry)).find((entry) => node_fs.existsSync(entry));
  if (!gameDir) return null;
  let displayName = name;
  try {
    const text = await promises.readFile(config, "utf8");
    const match = /^name\s*=\s*(.+)$/m.exec(text);
    if (match) displayName = match[1].trim();
  } catch {
  }
  let minecraftVersion = "";
  let loader = "vanilla";
  let loaderVersion = null;
  try {
    const pack = JSON.parse(await promises.readFile(node_path.join(dir, "mmc-pack.json"), "utf8"));
    for (const component of pack.components ?? []) {
      const uid = component.uid ?? "";
      if (uid === "net.minecraft") minecraftVersion = component.version ?? "";
      else if (uid.includes("fabric") || uid.includes("forge") || uid.includes("quilt")) {
        loader = loaderFrom(uid);
        loaderVersion = component.version ?? null;
      }
    }
  } catch {
    return null;
  }
  if (!minecraftVersion) return null;
  return {
    id: `${launcher}:${name}`,
    launcher,
    name: displayName,
    minecraftVersion,
    loader,
    loaderVersion,
    gameDir,
    mods: await countIn(node_path.join(gameDir, "mods"), (file2) => file2.endsWith(".jar")),
    worlds: await countIn(node_path.join(gameDir, "saves"), () => true),
    sizeBytes: await roughSize(gameDir)
  };
}
async function readModrinth(dir, name) {
  const manifest = node_path.join(dir, "profile.json");
  if (!node_fs.existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(await promises.readFile(manifest, "utf8"));
    if (!parsed.game_version) return null;
    return {
      id: `modrinth:${name}`,
      launcher: "modrinth",
      name: parsed.name ?? name,
      minecraftVersion: parsed.game_version,
      loader: loaderFrom(parsed.loader ?? ""),
      loaderVersion: parsed.loader_version?.id ?? null,
      gameDir: dir,
      mods: await countIn(node_path.join(dir, "mods"), (file2) => file2.endsWith(".jar")),
      worlds: await countIn(node_path.join(dir, "saves"), () => true),
      sizeBytes: await roughSize(dir)
    };
  } catch {
    return null;
  }
}
async function readVanilla(dir) {
  if (!node_fs.existsSync(node_path.join(dir, "saves")) && !node_fs.existsSync(node_path.join(dir, "versions"))) return null;
  let minecraftVersion = "";
  try {
    const versions = await promises.readdir(node_path.join(dir, "versions"));
    const releases = versions.filter((name) => /^\d+\.\d+(\.\d+)?$/.test(name));
    minecraftVersion = releases.sort().pop() ?? "";
  } catch {
  }
  if (!minecraftVersion) return null;
  return {
    id: "vanilla:.minecraft",
    launcher: "vanilla",
    name: "Minecraft (official launcher)",
    minecraftVersion,
    loader: "vanilla",
    loaderVersion: null,
    gameDir: dir,
    mods: await countIn(node_path.join(dir, "mods"), (file2) => file2.endsWith(".jar")),
    worlds: await countIn(node_path.join(dir, "saves"), () => true),
    sizeBytes: await roughSize(dir)
  };
}
async function findForeignInstances() {
  const found = [];
  for (const { launcher, dir } of candidateRoots()) {
    if (!node_fs.existsSync(dir)) continue;
    if (launcher === "vanilla") {
      const entry = await readVanilla(dir);
      if (entry) found.push(entry);
      continue;
    }
    let names;
    try {
      names = (await promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const path2 = node_path.join(dir, name);
      const entry = launcher === "curseforge" || launcher === "gdlauncher" ? await readCurseForge(path2, name) : launcher === "modrinth" ? await readModrinth(path2, name) : await readPrismLike(path2, name, launcher);
      if (entry) found.push(entry);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const unique = found.filter((entry) => {
    const key = entry.gameDir.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  log$i.info(`found ${unique.length} importable instance(s)`);
  return unique;
}
const COPY_FOLDERS = ["mods", "config", "saves", "resourcepacks", "shaderpacks", "scripts", "kubejs", "defaultconfigs"];
const COPY_FILES = ["options.txt", "servers.dat", "optionsof.txt"];
async function importForeignInstance(entry, name) {
  if (!node_fs.existsSync(entry.gameDir)) {
    throw new LauncherError("NOT_FOUND", "that instance folder is gone", {
      title: `${entry.name} is no longer where it was`,
      message: "The folder it was found in has moved or been deleted since the scan.",
      actions: ["Scan again"]
    });
  }
  const instance = await createInstance({
    name: (name ?? entry.name).slice(0, 64),
    minecraftVersion: entry.minecraftVersion,
    loader: entry.loader,
    loaderVersion: entry.loaderVersion
  });
  await ensureInstanceLayout(instance);
  const copied = [];
  const skipped = [];
  for (const folder of COPY_FOLDERS) {
    const source = node_path.join(entry.gameDir, folder);
    if (!node_fs.existsSync(source)) continue;
    try {
      await promises.cp(source, instanceSubdir(instance, folder), { recursive: true, force: true });
      copied.push(folder);
    } catch (err) {
      skipped.push(`${folder} (${err.message})`);
    }
  }
  for (const file2 of COPY_FILES) {
    const source = node_path.join(entry.gameDir, file2);
    if (!node_fs.existsSync(source)) continue;
    try {
      await promises.cp(source, node_path.join(instance.gameDir, file2), { force: true });
      copied.push(file2);
    } catch (err) {
      skipped.push(`${file2} (${err.message})`);
    }
  }
  log$i.info(`imported "${entry.name}" from ${entry.launcher} into ${instance.id}`);
  return { instanceId: instance.id, name: instance.name, copiedFolders: copied, skipped };
}
const DIRECTORY_CATEGORIES = [
  { id: "minigames", label: "Minigames", blurb: "Bed wars, sky wars, parkour and party games." },
  { id: "survival", label: "Survival & SMP", blurb: "Long-running worlds to build in with other people." },
  { id: "skyblock", label: "Skyblock", blurb: "Start on an island with nothing and grow it." },
  { id: "anarchy", label: "Anarchy", blurb: "No rules, no resets. Bring a friend and low expectations." },
  { id: "prison", label: "Prison & Factions", blurb: "Rank up, raid, and defend what you have taken." },
  { id: "adventure", label: "Adventure & MMO", blurb: "Custom quests, classes and hand-built worlds." },
  { id: "creative", label: "Creative & Towny", blurb: "Plots, cities and nations to build in." },
  { id: "modded", label: "Modded", blurb: "Pixelmon and other servers that need a mod pack." }
];
const BUNDLED_DIRECTORY = [
  {
    id: "hypixel",
    name: "Hypixel",
    address: "mc.hypixel.net",
    port: 25565,
    category: "minigames",
    description: "The largest Minecraft server in the world. Bed Wars, SkyBlock, Murder Mystery and dozens more.",
    version: "1.21",
    tags: ["bedwars", "skyblock", "duels"]
  },
  {
    id: "cubecraft",
    name: "CubeCraft Games",
    address: "play.cubecraft.net",
    port: 25565,
    category: "minigames",
    description: "Long-running minigame network with Eggwars, Skyblock and Lucky Islands.",
    version: "1.21",
    tags: ["eggwars", "skywars"]
  },
  {
    id: "manacube",
    name: "ManaCube",
    address: "play.manacube.com",
    port: 25565,
    category: "minigames",
    description: "Parkour, survival, factions and islands across one network.",
    version: "1.21",
    tags: ["parkour", "islands"]
  },
  {
    id: "pika",
    name: "PikaNetwork",
    address: "play.pika-network.net",
    port: 25565,
    category: "minigames",
    description: "Practice PvP, bed wars, skyblock and lifesteal.",
    version: "1.21",
    tags: ["pvp", "lifesteal"]
  },
  {
    id: "jartex",
    name: "JartexNetwork",
    address: "play.jartexnetwork.com",
    port: 25565,
    category: "minigames",
    description: "Bed wars, skyblock, prison and survival with a large player base.",
    version: "1.21",
    tags: ["bedwars", "prison"]
  },
  {
    id: "mccentral",
    name: "MCCentral",
    address: "play.mccentral.org",
    port: 25565,
    category: "minigames",
    description: "Skyblock, prison, factions and creative plots.",
    version: "1.21",
    tags: ["skyblock", "creative"]
  },
  {
    id: "donutsmp",
    name: "DonutSMP",
    address: "donutsmp.net",
    port: 25565,
    category: "survival",
    description: "Survival with an economy where everything has a price. Popular with streamers.",
    version: "1.21",
    tags: ["economy", "smp"]
  },
  {
    id: "loverfella",
    name: "LoverFella",
    address: "play.loverfella.com",
    port: 25565,
    category: "survival",
    description: "Whitelist-style community survival built around a YouTube channel.",
    version: "1.21",
    tags: ["community", "smp"]
  },
  {
    id: "minesuperior",
    name: "MineSuperior",
    address: "play.minesuperior.com",
    port: 25565,
    category: "survival",
    description: "Skyblock, survival and prison across several long-lived worlds.",
    version: "1.21",
    tags: ["skyblock", "prison"]
  },
  {
    id: "opblocks",
    name: "OPBlocks",
    address: "play.opblocks.com",
    port: 25565,
    category: "skyblock",
    description: "Skyblock and prison with heavy custom progression.",
    version: "1.21",
    tags: ["skyblock", "prison"]
  },
  {
    id: "2b2t",
    name: "2b2t",
    address: "2b2t.org",
    port: 25565,
    category: "anarchy",
    description: "The oldest anarchy server in Minecraft. No rules, never reset, and usually a long queue.",
    version: "1.21",
    tags: ["anarchy", "queue"]
  },
  {
    id: "9b9t",
    name: "9b9t",
    address: "9b9t.com",
    port: 25565,
    category: "anarchy",
    description: "Anarchy server with no rules and a shorter queue than 2b2t.",
    version: "1.21",
    tags: ["anarchy"]
  },
  {
    id: "constantiam",
    name: "Constantiam",
    address: "constantiam.net",
    port: 25565,
    category: "anarchy",
    description: "Anarchy with an unusually technical, redstone-heavy community.",
    version: "1.21",
    tags: ["anarchy", "technical"]
  },
  {
    id: "purpleprison",
    name: "Purple Prison",
    address: "purpleprison.net",
    port: 25565,
    category: "prison",
    description: "One of the longest-running prison servers, with mining ranks and gangs.",
    version: "1.21",
    tags: ["prison", "gangs"]
  },
  {
    id: "wynncraft",
    name: "Wynncraft",
    address: "play.wynncraft.com",
    port: 25565,
    category: "adventure",
    description: "A full MMORPG built inside Minecraft: classes, quests and a hand-built continent.",
    version: "1.21",
    tags: ["mmorpg", "quests"]
  },
  {
    id: "originrealms",
    name: "Origin Realms",
    address: "play.originrealms.com",
    port: 25565,
    category: "adventure",
    description: "Custom blocks and mechanics with no mods required, thanks to a resource pack.",
    version: "1.21",
    tags: ["custom", "no-mods"]
  },
  {
    id: "earthmc",
    name: "EarthMC",
    address: "earthmc.net",
    port: 25565,
    category: "creative",
    description: "A 1:3000 scale map of Earth where players found real towns and nations.",
    version: "1.21",
    tags: ["towny", "earth"]
  },
  {
    id: "complex",
    name: "Complex Gaming",
    address: "hub.mc-complex.com",
    port: 25565,
    category: "modded",
    description: "The best known Pixelmon network, plus skyblock and factions worlds.",
    version: "1.21",
    tags: ["pixelmon", "modded"]
  },
  {
    id: "pixelmoncraft",
    name: "PixelmonCraft",
    address: "play.pixelmoncraft.com",
    port: 25565,
    category: "modded",
    description: "Pixelmon server with recreated Kanto and Johto regions. Needs the Pixelmon mod.",
    version: "1.20.2",
    tags: ["pixelmon", "modded"]
  },
  /*
   * Added in a second pass, the same way as the first: every one of these
   * answered a real ping before it was written down, and the descriptions come
   * from what the server itself said in its MOTD rather than from a server-list
   * site. Twenty-three candidates that did not answer were dropped, and seven
   * more were the same networks already listed above on a different domain.
   *
   * A warning for whoever probes the next batch: ping them in small groups.
   * Firing sixty-four at once made sixty-three of them time out and look dead,
   * which very nearly deleted most of this list before it was written.
   */
  {
    id: "gommehd",
    name: "GommeHD.net",
    address: "gommehd.net",
    port: 25565,
    category: "minigames",
    description: "Long-running German network. Bed wars, sky wars and cores, with English players welcome.",
    version: "1.21",
    tags: ["bedwars", "skywars", "german"]
  },
  {
    id: "blocksmc",
    name: "BlocksMC",
    address: "play.blocksmc.com",
    port: 25565,
    category: "minigames",
    description: "Practice PvP, bed wars and a rotating set of custom games.",
    version: "1.21",
    tags: ["pvp", "bedwars", "practice"]
  },
  {
    id: "mineland",
    name: "Mineland Network",
    address: "play.mineland.net",
    port: 25565,
    category: "minigames",
    description: "Minigames, creative plots and its own mini-game builder. Takes 1.8 through current.",
    version: "1.21",
    tags: ["minigames", "creative"]
  },
  {
    id: "hoplite",
    name: "Hoplite Network",
    address: "mc.hoplite.gg",
    port: 25565,
    category: "minigames",
    description: "Competitive minigames with limited-time modes. Runs a current version rather than 1.8.",
    version: "1.21.11",
    tags: ["pvp", "minigames"]
  },
  {
    id: "minefun",
    name: "MineFun Network",
    address: "play.minefun.net",
    port: 25565,
    category: "minigames",
    description: "Mixed network of survival, skyblock and PvP modes.",
    version: "1.21",
    tags: ["survival", "pvp"]
  },
  {
    id: "mineverse",
    name: "Mineverse",
    address: "play.mineverse.com",
    port: 25565,
    category: "minigames",
    description: "Veteran minigame network — kit PvP, prison and factions.",
    version: "1.21",
    tags: ["kitpvp", "prison", "factions"]
  },
  {
    id: "vortex-network",
    name: "Vortex Network",
    address: "play.vortexnetwork.net",
    port: 25565,
    category: "skyblock",
    description: "Skyblock, prison and survival modes across one network.",
    version: "1.21",
    tags: ["skyblock", "prison"]
  },
  {
    id: "advancius",
    name: "Advancius Network",
    address: "mc.advancius.net",
    port: 25565,
    category: "survival",
    description: "Towny earth map and prison on one network, accepting 1.8 through current.",
    version: "1.21",
    tags: ["towny", "earth", "prison"]
  },
  {
    id: "craftyourtown",
    name: "CraftYourTown",
    address: "mc.craftyourtown.com",
    port: 25565,
    category: "survival",
    description: "Towny survival with Slimefun and minigames alongside it.",
    version: "1.21",
    tags: ["towny", "slimefun", "survival"]
  },
  {
    id: "extremecraft",
    name: "ExtremeCraft",
    address: "play.extremecraft.net",
    port: 25565,
    category: "survival",
    description: "Survival with a custom economy, plus skyblock, factions and prison worlds.",
    version: "1.21",
    tags: ["survival", "economy", "factions"]
  },
  {
    id: "snapcraft",
    name: "SnapCraft",
    address: "play.snapcraft.net",
    port: 25565,
    category: "survival",
    description: "Survival network running alongside skyblock and prison modes.",
    version: "1.21",
    tags: ["survival", "skyblock"]
  },
  {
    id: "mythicmc",
    name: "MythicMC",
    address: "play.mythicmc.org",
    port: 25565,
    category: "survival",
    description: "Factions, survival, creative and PvP together on one address.",
    version: "1.21",
    tags: ["factions", "survival", "creative"]
  },
  {
    id: "foxcraft",
    name: "Foxcraft",
    address: "play.foxcraft.net",
    port: 25565,
    category: "survival",
    description: "Survival, skyblock and prison, on a current version.",
    version: "1.21",
    tags: ["survival", "skyblock", "prison"]
  },
  {
    id: "piratecraft",
    name: "PirateCraft",
    address: "mc.piratemc.com",
    port: 25565,
    category: "adventure",
    description: "Pirate-themed survival with buildable, sailable ships, cannons and sea battles.",
    version: "1.21",
    tags: ["pirates", "ships", "survival"]
  },
  {
    id: "grandtheftmc",
    name: "Grand Theft Minecart",
    address: "play.grandtheftmc.net",
    port: 25565,
    category: "adventure",
    description: "Open-world roleplay with cars, guns, jobs and heists.",
    version: "1.21",
    tags: ["roleplay", "guns", "cars"]
  },
  {
    id: "buildersrefuge",
    name: "Builders Refuge",
    address: "play.buildersrefuge.com",
    port: 25565,
    category: "creative",
    description: "Creative plots aimed at serious builders, with a large plugin toolkit.",
    version: "1.21.11",
    tags: ["creative", "plots", "building"]
  },
  {
    id: "mcmiddleearth",
    name: "Minecraft Middle Earth",
    address: "mcmiddleearth.com",
    port: 25565,
    category: "creative",
    description: "A years-long collaborative build of Tolkien’s Middle-earth. Tours run for visitors.",
    version: "1.21",
    tags: ["building", "tolkien", "tours"]
  },
  {
    id: "skyblock-net",
    name: "Skyblock.net",
    address: "play.skyblock.net",
    port: 25565,
    category: "skyblock",
    description: "One of the older dedicated skyblock servers, now with Bedrock support.",
    version: "1.21",
    tags: ["skyblock", "bedrock"]
  },
  {
    id: "fadecloud",
    name: "FadeCloud",
    address: "play.fadecloud.com",
    port: 25565,
    category: "skyblock",
    description: "Skyblock, prison and gens, taking 1.13 through current.",
    version: "1.21",
    tags: ["skyblock", "prison", "gens"]
  },
  {
    id: "lemoncloud",
    name: "LemonCloud",
    address: "play.lemoncloud.net",
    port: 25565,
    category: "skyblock",
    description: "Skyblock and survival with a heavy custom-item economy.",
    version: "1.21",
    tags: ["skyblock", "survival"]
  },
  {
    id: "aslanmc",
    name: "AslanMC",
    address: "play.mineheroes.net",
    port: 25565,
    category: "skyblock",
    description: "Formerly MineHeroes — skyblock and survival. The old address still reaches it.",
    version: "1.21",
    tags: ["skyblock", "survival"]
  },
  {
    id: "pvpwars",
    name: "PvPWars",
    address: "play.pvpwars.net",
    port: 25565,
    category: "skyblock",
    description: "Skyblock and factions. Was showing a maintenance message when this was added.",
    version: "1.19.2",
    tags: ["skyblock", "factions"]
  },
  {
    id: "minecadia",
    name: "Minecadia",
    address: "play.minecadia.com",
    port: 25565,
    category: "prison",
    description: "Factions and prison with custom enchants, from 1.8 upward.",
    version: "1.21",
    tags: ["factions", "prison", "enchants"]
  },
  {
    id: "saicopvp",
    name: "SaiCoPvP",
    address: "play.saicopvp.com",
    port: 25565,
    category: "prison",
    description: "Prison and factions realms with a long-running competitive scene.",
    version: "1.21",
    tags: ["prison", "factions", "pvp"]
  },
  {
    id: "wildnetwork",
    name: "WildNetwork",
    address: "play.wildprison.net",
    port: 25565,
    category: "prison",
    description: "Prison and survival on one network.",
    version: "1.21",
    tags: ["prison", "survival"]
  },
  {
    id: "akumamc",
    name: "AkumaMC",
    address: "play.akumamc.net",
    port: 25565,
    category: "prison",
    description: "Prison, skyblock and factions, accepting 1.8 through current.",
    version: "1.21",
    tags: ["prison", "skyblock", "factions"]
  },
  {
    id: "cosmicpvp",
    name: "Cosmic Prisons",
    address: "play.cosmicpvp.me",
    port: 25565,
    category: "prison",
    description: "Prisons and factions with heavily customised progression.",
    version: "1.21",
    tags: ["prison", "factions"]
  },
  {
    id: "bosscraft",
    name: "BossCraft",
    address: "play.mcprison.net",
    port: 25565,
    category: "prison",
    description: "Prison server running 1.17 through current.",
    version: "1.21",
    tags: ["prison"]
  },
  {
    id: "6b6t",
    name: "6b6t",
    address: "6b6t.org",
    port: 25565,
    category: "anarchy",
    description: "Anarchy since 2022, but with /tpa and /home — a gentler take than 2b2t.",
    version: "1.21",
    tags: ["anarchy", "no-rules"]
  },
  {
    id: "pixelmon-realms",
    name: "Pixelmon Realms",
    address: "play.pixelmonrealms.com",
    port: 25565,
    category: "modded",
    description: "Pixelmon with warzones and custom content. Needs the Pixelmon mod.",
    version: "1.16.5",
    tags: ["pixelmon", "modded"]
  },
  {
    id: "pokesaga",
    name: "PokéSaga",
    address: "play.pokesaga.org",
    port: 25565,
    category: "modded",
    description: "Pixelmon with custom enchants and fishing. Needs the Pixelmon mod.",
    version: "1.16.5",
    tags: ["pixelmon", "modded"]
  }
];
const log$h = createLogger("directory");
const statusCache$1 = /* @__PURE__ */ new Map();
const inFlight$2 = /* @__PURE__ */ new Map();
const STATUS_TTL_MS = 6e4;
const PING_CONCURRENCY = 8;
let remoteCatalogue = null;
let remoteFetchedAt = 0;
let remoteCatalogueUrl = "";
function catalogue() {
  return remoteCatalogue ?? BUNDLED_DIRECTORY;
}
function categories() {
  return DIRECTORY_CATEGORIES;
}
function sanitiseEntry(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw;
  const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 64) : "";
  const address = typeof entry.address === "string" ? entry.address.trim().slice(0, 255) : "";
  if (!name || !address) return null;
  const port = typeof entry.port === "number" && entry.port >= 1 && entry.port <= 65535 ? Math.round(entry.port) : 25565;
  const known = DIRECTORY_CATEGORIES.some((c) => c.id === entry.category);
  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim().slice(0, 64) : `remote-${index}`,
    name,
    address,
    port,
    category: known ? entry.category : "survival",
    description: typeof entry.description === "string" ? entry.description.trim().slice(0, 300) : "",
    version: typeof entry.version === "string" ? entry.version.trim().slice(0, 32) : null,
    tags: Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === "string").slice(0, 6).map((t) => t.slice(0, 24)) : []
  };
}
async function loadRemoteCatalogue(force = false) {
  const url = getSettings().directoryUrl.trim();
  if (!url) {
    remoteCatalogue = null;
    remoteCatalogueUrl = "";
    return { entries: BUNDLED_DIRECTORY.length, source: "bundled" };
  }
  if (!force && remoteCatalogue && remoteCatalogueUrl === url && Date.now() - remoteFetchedAt < 30 * 6e4) {
    return { entries: remoteCatalogue.length, source: "remote" };
  }
  if (!url.startsWith("https://")) {
    throw new LauncherError("INVALID_INPUT", "the server list url must be https", {
      title: "That server list address was refused",
      message: "NexusCraft only fetches a custom server list over https.",
      actions: ["Use an https:// address, or clear the box to go back to the built-in list"]
    });
  }
  const payload = await getJson(url, { timeoutMs: 15e3 });
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload.servers) ? payload.servers : null;
  if (!rows) {
    throw new LauncherError("INVALID_INPUT", "the server list was not an array", {
      title: "That server list could not be read",
      message: 'The file has to be a JSON array of servers, or an object with a "servers" array.',
      actions: ["Check the file, or clear the box to go back to the built-in list"]
    });
  }
  const parsed = rows.map(sanitiseEntry).filter((e) => e !== null).slice(0, 500);
  if (parsed.length === 0) {
    throw new LauncherError("INVALID_INPUT", "no usable entries in the server list", {
      title: "That server list had nothing in it",
      message: "Every entry needs at least a name and an address.",
      actions: ["Check the file, or clear the box to go back to the built-in list"]
    });
  }
  remoteCatalogue = parsed;
  remoteCatalogueUrl = url;
  remoteFetchedAt = Date.now();
  log$h.info(`loaded ${parsed.length} servers from a custom directory`);
  return { entries: parsed.length, source: "remote" };
}
function unknownStatus(id2) {
  return {
    serverId: id2,
    online: null,
    checkedAt: Date.now(),
    latencyMs: null,
    playersOnline: null,
    playersMax: null,
    versionName: null,
    protocol: null,
    motd: null,
    // A previously fetched icon is worth keeping through a re-check so the row
    // does not flicker back to a placeholder.
    faviconDataUrl: statusCache$1.get(id2)?.faviconDataUrl ?? null,
    error: null
  };
}
async function pingInto(id2, address, port) {
  const pending2 = inFlight$2.get(id2);
  if (pending2) return await pending2;
  const promise = (async () => {
    const placeholder = unknownStatus(id2);
    statusCache$1.set(id2, placeholder);
    emit("directory:status", placeholder);
    const result = await pingServer(address, port, 6e3);
    const status2 = result.online ? {
      serverId: id2,
      online: true,
      checkedAt: Date.now(),
      latencyMs: result.latencyMs,
      playersOnline: result.playersOnline,
      playersMax: result.playersMax,
      versionName: result.versionName ? stripFormatting(result.versionName) : null,
      protocol: result.protocol,
      motd: result.motd,
      faviconDataUrl: result.faviconDataUrl,
      error: null
    } : {
      ...unknownStatus(id2),
      online: false,
      error: result.error
    };
    statusCache$1.set(id2, status2);
    emit("directory:status", status2);
    return status2;
  })();
  inFlight$2.set(id2, promise);
  try {
    return await promise;
  } finally {
    inFlight$2.delete(id2);
  }
}
function cachedDirectoryStatuses() {
  return [...statusCache$1.values()];
}
async function pingDirectoryServer(id2) {
  const entry = catalogue().find((server2) => server2.id === id2);
  if (!entry) throw new LauncherError("NOT_FOUND", `no directory server with id ${id2}`);
  return await pingInto(entry.id, entry.address, entry.port);
}
async function refreshDirectory(force = false) {
  const entries = catalogue();
  const due = force ? entries : entries.filter((entry) => {
    const cached2 = statusCache$1.get(entry.id);
    return !cached2 || Date.now() - cached2.checkedAt > STATUS_TTL_MS;
  });
  for (let i = 0; i < due.length; i += PING_CONCURRENCY) {
    const batch = due.slice(i, i + PING_CONCURRENCY);
    await Promise.all(
      batch.map(
        (entry) => pingInto(entry.id, entry.address, entry.port).catch((err) => {
          log$h.warn(`could not ping ${entry.address}: ${err.message}`);
        })
      )
    );
  }
  return cachedDirectoryStatuses();
}
function parseServerAddress(rawAddress) {
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    throw new LauncherError("INVALID_INPUT", "no address given", {
      title: "Enter a server address",
      message: "Type the address a server gave you, like play.example.com.",
      actions: []
    });
  }
  const withoutScheme = trimmed.replace(/^minecraft:\/\//i, "").replace(/\/+$/, "");
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(withoutScheme);
  const match = bracketed ?? /^([^:]+)(?::(\d{1,5}))?$/.exec(withoutScheme);
  if (!match) {
    throw new LauncherError("INVALID_INPUT", "that address could not be read", {
      title: "That does not look like a server address",
      message: "Enter something like play.example.com, or play.example.com:25566 if it uses a different port.",
      actions: []
    });
  }
  const host = match[1].trim();
  const port = match[2] ? Number(match[2]) : 25565;
  if (!host || host.length > 255 || /\s/.test(host)) {
    throw new LauncherError("INVALID_INPUT", "that address could not be read", {
      title: "That does not look like a server address",
      message: "Enter something like play.example.com, or play.example.com:25566 if it uses a different port.",
      actions: []
    });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LauncherError("INVALID_INPUT", "port out of range", {
      title: "That port number is not valid",
      message: "A port has to be between 1 and 65535.",
      actions: []
    });
  }
  return { host, port };
}
async function lookupAddress(rawAddress) {
  const { host, port } = parseServerAddress(rawAddress);
  const resolved = await resolveServerAddress(host, port);
  const id2 = `lookup:${host}:${port}`;
  const status2 = await pingInto(id2, host, port);
  return {
    address: host,
    port,
    resolvedAddress: resolved.host,
    resolvedPort: resolved.port,
    status: status2
  };
}
const log$g = createLogger("servers");
function listServers() {
  return db().all(Collections.servers).sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder || (b.lastJoinedAt ?? 0) - (a.lastJoinedAt ?? 0) || a.name.localeCompare(b.name)
  );
}
function getServer(id2) {
  const server2 = db().get(Collections.servers, id2);
  if (!server2) throw new LauncherError("NOT_FOUND", `server ${id2} does not exist`);
  return server2;
}
function saveServer(input) {
  const existing = input.id ? db().get(Collections.servers, input.id) : null;
  const [host, parsedPort] = splitAddress(input.address);
  const port = input.port && input.port !== 25565 ? input.port : parsedPort;
  const server2 = {
    id: existing?.id ?? node_crypto.randomUUID(),
    name: input.name.trim().slice(0, 64) || host,
    address: host,
    port,
    notedVersion: input.notedVersion?.slice(0, 64) ?? existing?.notedVersion ?? null,
    description: input.description?.slice(0, 512) ?? existing?.description ?? null,
    favorite: input.favorite ?? existing?.favorite ?? false,
    preferredInstanceId: input.preferredInstanceId ?? existing?.preferredInstanceId ?? null,
    lastJoinedAt: existing?.lastJoinedAt ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    sortOrder: existing?.sortOrder ?? Date.now()
  };
  db().put(Collections.servers, server2.id, server2);
  return server2;
}
function deleteServer(id2) {
  getServer(id2);
  db().remove(Collections.servers, id2);
  statusCache.delete(id2);
}
function setFavorite(id2, favorite) {
  const server2 = getServer(id2);
  const next = { ...server2, favorite };
  db().put(Collections.servers, id2, next);
  return next;
}
function recordJoin(id2) {
  const server2 = db().get(Collections.servers, id2);
  if (!server2) return;
  db().put(Collections.servers, id2, { ...server2, lastJoinedAt: Date.now() });
}
const statusCache = /* @__PURE__ */ new Map();
const inFlight$1 = /* @__PURE__ */ new Map();
function cachedStatuses() {
  return [...statusCache.values()];
}
async function checkServer(id2) {
  const pending2 = inFlight$1.get(id2);
  if (pending2) return pending2;
  const server2 = getServer(id2);
  const promise = (async () => {
    const pendingStatus = {
      serverId: id2,
      online: null,
      checkedAt: Date.now(),
      latencyMs: null,
      playersOnline: null,
      playersMax: null,
      versionName: null,
      protocol: null,
      motd: null,
      faviconDataUrl: statusCache.get(id2)?.faviconDataUrl ?? null,
      error: null
    };
    statusCache.set(id2, pendingStatus);
    emit("servers:status", pendingStatus);
    const result = await pingServer(server2.address, server2.port);
    const status2 = result.online ? {
      serverId: id2,
      online: true,
      checkedAt: Date.now(),
      latencyMs: result.latencyMs,
      playersOnline: result.playersOnline,
      playersMax: result.playersMax,
      versionName: result.versionName ? stripFormatting(result.versionName) : null,
      protocol: result.protocol,
      motd: result.motd,
      faviconDataUrl: result.faviconDataUrl,
      error: null
    } : {
      serverId: id2,
      online: false,
      checkedAt: Date.now(),
      latencyMs: null,
      playersOnline: null,
      playersMax: null,
      versionName: null,
      protocol: null,
      motd: null,
      faviconDataUrl: statusCache.get(id2)?.faviconDataUrl ?? null,
      error: result.error
    };
    statusCache.set(id2, status2);
    emit("servers:status", status2);
    return status2;
  })();
  inFlight$1.set(id2, promise);
  try {
    return await promise;
  } finally {
    inFlight$1.delete(id2);
  }
}
async function checkAllServers() {
  const servers = listServers();
  const results = [];
  const batchSize = 5;
  for (let i = 0; i < servers.length; i += batchSize) {
    const batch = servers.slice(i, i + batchSize);
    results.push(
      ...await Promise.all(
        batch.map(
          (server2) => checkServer(server2.id).catch(
            () => ({
              serverId: server2.id,
              online: false,
              checkedAt: Date.now(),
              latencyMs: null,
              playersOnline: null,
              playersMax: null,
              versionName: null,
              protocol: null,
              motd: null,
              faviconDataUrl: null,
              error: "The check could not be completed."
            })
          )
        )
      )
    );
  }
  return results;
}
async function importFromInstance(instance) {
  const file2 = node_path.join(instance.gameDir, "servers.dat");
  if (!node_fs.existsSync(file2)) {
    throw new LauncherError("NOT_FOUND", "no servers.dat in this instance", {
      title: "No server list found",
      message: `This instance has no servers.dat yet. Minecraft writes it once you add a server in game.`,
      actions: ["Launch the instance and add a server in Minecraft first", "Or add servers here by hand"]
    });
  }
  const root = await parseNbt(await promises.readFile(file2));
  const list = root.servers;
  if (!Array.isArray(list)) return 0;
  const existing = listServers();
  let imported = 0;
  for (const entry of list) {
    const compound = nbtCompound(entry);
    if (!compound) continue;
    const ip = nbtString(compound.ip);
    if (!ip) continue;
    const [host, port] = splitAddress(ip);
    if (existing.some((s) => s.address.toLowerCase() === host.toLowerCase() && s.port === port)) continue;
    saveServer({
      id: null,
      name: stripFormatting(nbtString(compound.name) ?? host).slice(0, 64),
      address: host,
      port,
      description: null,
      notedVersion: null
    });
    imported++;
  }
  log$g.info(`imported ${imported} server(s) from ${instance.name}`);
  return imported;
}
const log$f = createLogger("skins");
const SKINS_ENDPOINT = "https://api.minecraftservices.com/minecraft/profile/skins";
const ACTIVE_SKIN_ENDPOINT = "https://api.minecraftservices.com/minecraft/profile/skins/active";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function readPngInfo(data) {
  if (data.length < 24) return null;
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (data.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
function validateSkinFile(data) {
  const info = readPngInfo(data);
  if (!info) {
    throw new LauncherError("INVALID_INPUT", "file is not a PNG", {
      title: "That file is not a PNG image",
      message: "Minecraft skins must be PNG images. The file you chose is a different format.",
      actions: ["Choose a .png file exported from a skin editor"]
    });
  }
  const valid = info.width === 64 && (info.height === 64 || info.height === 32) || info.width === 128 && info.height === 128;
  if (!valid) {
    throw new LauncherError("INVALID_INPUT", `unexpected skin size ${info.width}x${info.height}`, {
      title: "That image is the wrong size for a skin",
      message: `Minecraft skins are 64x64 pixels (or 64x32 for the old layout). This image is ${info.width}x${info.height}.`,
      actions: ["Resize the image to 64x64", "Or export it again from a skin editor"]
    });
  }
  if (data.byteLength > 1024 * 1024) {
    throw new LauncherError("INVALID_INPUT", "skin file is too large");
  }
  return info;
}
function listSkins() {
  return db().all(Collections.skins).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.addedAt - a.addedAt);
}
async function importSkin(filePath, name, variant) {
  const info = await promises.stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new LauncherError("NOT_FOUND", "that file no longer exists");
  const data = await promises.readFile(filePath);
  validateSkinFile(data);
  const id2 = node_crypto.randomUUID();
  const stored = node_path.join(ensureDir(skinsRoot()), `${id2}.png`);
  await promises.writeFile(stored, data);
  const skin = {
    id: id2,
    name: name.trim().slice(0, 64) || "Untitled skin",
    variant,
    dataUrl: `data:image/png;base64,${data.toString("base64")}`,
    favorite: false,
    addedAt: Date.now()
  };
  db().put(Collections.skins, id2, skin);
  log$f.info(`imported skin "${skin.name}"`);
  return skin;
}
async function deleteSkin(id2) {
  const skin = db().get(Collections.skins, id2);
  if (!skin) throw new LauncherError("NOT_FOUND", "that skin no longer exists");
  db().remove(Collections.skins, id2);
  await promises.rm(node_path.join(skinsRoot(), `${id2}.png`), { force: true }).catch(() => void 0);
}
function favoriteSkin(id2, favorite) {
  const skin = db().get(Collections.skins, id2);
  if (!skin) throw new LauncherError("NOT_FOUND", "that skin no longer exists");
  const next = { ...skin, favorite };
  db().put(Collections.skins, id2, next);
  return next;
}
async function applySkin(account, skinId) {
  const skin = db().get(Collections.skins, skinId);
  if (!skin) throw new LauncherError("NOT_FOUND", "that skin no longer exists");
  const file2 = node_path.join(skinsRoot(), `${skinId}.png`);
  const data = await promises.readFile(file2).catch(() => null);
  if (!data) throw new LauncherError("NOT_FOUND", "the stored skin image is missing");
  validateSkinFile(data);
  const token = await getValidMinecraftToken(account.id);
  const form = new FormData();
  form.append("variant", skin.variant);
  form.append("file", new Blob([new Uint8Array(data)], { type: "image/png" }), "skin.png");
  const response = await request(SKINS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    retries: 1,
    timeoutMs: 3e4
  });
  if (response.status === 401) throw new LauncherError("TOKEN_EXPIRED", "skin upload was rejected");
  if (!response.ok) {
    throw new LauncherError("UNKNOWN", `skin upload returned HTTP ${response.status}`, {
      title: "The skin could not be applied",
      message: "Mojang rejected the skin upload. The image may not meet their requirements, or the service may be busy.",
      actions: ["Check the skin is a valid 64x64 PNG", "Try again in a few minutes"]
    });
  }
  log$f.info(`applied skin "${skin.name}" to ${account.username}`);
}
async function resetSkin(account) {
  const token = await getValidMinecraftToken(account.id);
  const response = await request(ACTIVE_SKIN_ENDPOINT, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    retries: 1
  });
  if (!response.ok && response.status !== 204) {
    throw new LauncherError("UNKNOWN", `skin reset returned HTTP ${response.status}`, {
      title: "The skin could not be reset",
      message: "Mojang did not accept the request to reset your skin.",
      actions: ["Try again shortly", "Or reset it at minecraft.net/profile/skin"]
    });
  }
  log$f.info(`reset skin for ${account.username}`);
}
const log$e = createLogger("steward");
function stewardPersonality(serverName, operators) {
  const owner = operators[0];
  return `You live on "${serverName}", a Minecraft server run from NexusCraft. You are its resident companion: you greet players by name when they join, answer questions about the world, help with directions and building, and keep an eye on things when nobody else is around. ` + (owner ? `${owner} runs this server. ` : "") + "Speak briefly and naturally in chat. Do not narrate every action, and never ask for permission to do something small.";
}
function stewardUsername(serverName) {
  const base = serverName.replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "Server";
  return `${base}Bot`.slice(0, 16);
}
function stewardsFor(serverId) {
  return listCompanions().filter((companion) => companion.stewardOf === serverId);
}
function deploySteward(serverId, companionId) {
  const server2 = getHostedServer(serverId);
  if (server2.onlineMode) {
    throw new LauncherError("INVALID_INPUT", "server verifies players with Mojang", {
      title: "This server will not let a companion in",
      message: `"${server2.name}" verifies players with Mojang, and a companion has no Minecraft account to verify. Turning that off lets it join; the launcher then keeps the server off the internet unless you explicitly forward the port.`,
      actions: [
        `Edit "${server2.name}" and turn off "Verify players with Mojang"`,
        "Start the server again, then deploy the companion"
      ]
    });
  }
  const [host, port] = splitAddress(serverAddress(server2));
  const existing = companionId ? getCompanion(companionId) : null;
  const created = !existing;
  const companion = existing ?? createCompanion(stewardUsername(server2.name));
  const updated = updateCompanion(companion.id, {
    host,
    port,
    auth: "offline",
    // Pinning the version avoids a protocol guess against a server we already
    // know the version of.
    version: server2.minecraftVersion,
    owner: server2.operators[0] ?? companion.owner,
    stewardOf: serverId,
    // Only overwrite a personality the user has not written themselves.
    personality: created || !companion.personality.trim() ? stewardPersonality(server2.name, server2.operators) : companion.personality
  });
  log$e.info(`${updated.username} is now the steward of "${server2.name}"`);
  if (!isHostedServerRunning(serverId)) {
    return {
      companion: updated,
      created,
      warning: "The server is not running. The companion will join automatically once you start it."
    };
  }
  try {
    startCompanion(updated.id);
    return { companion: updated, created, warning: null };
  } catch (err) {
    return { companion: updated, created, warning: err.message };
  }
}
function dismissSteward(companionId) {
  getCompanion(companionId);
  if (isCompanionRunning(companionId)) stopCompanion(companionId);
  return updateCompanion(companionId, { stewardOf: "" });
}
function initStewards() {
  onHostedServerEvent((event, serverId, player) => {
    const stewards = stewardsFor(serverId);
    if (stewards.length === 0) return;
    if (event === "ready") {
      for (const steward of stewards) {
        if (isCompanionRunning(steward.id)) continue;
        setTimeout(() => {
          if (!isHostedServerRunning(serverId)) return;
          try {
            startCompanion(steward.id);
            log$e.info(`${steward.username} joined its server`);
          } catch (err) {
            log$e.warn(`${steward.username} could not join: ${err.message}`);
            toast("warning", `${steward.username} could not join`, err.message);
          }
        }, 4e3).unref();
      }
      return;
    }
    if (event === "stopped") {
      for (const steward of stewards) {
        if (!isCompanionRunning(steward.id)) continue;
        try {
          stopCompanion(steward.id);
          log$e.info(`${steward.username} left with its server`);
        } catch (err) {
          log$e.warn(`could not stop ${steward.username}: ${err.message}`);
        }
      }
      return;
    }
    if (event === "player-joined" && player) {
      for (const steward of stewards) {
        if (!isCompanionRunning(steward.id) || steward.username === player) continue;
        sayAsCompanion(steward.id, `Welcome back, ${player}!`);
      }
    }
  });
  log$e.info("watching hosted servers for resident companions");
}
const log$d = createLogger("crew");
const CREWS_KEY = "companion-crews";
const NOTES_KEY = "companion-crew-notes";
function readCrews() {
  const raw = db().kvGet(CREWS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeCrews(crews) {
  db().kvSet(CREWS_KEY, JSON.stringify(crews));
}
function readNotes(crewId) {
  const raw = db().kvGet(`${NOTES_KEY}-${crewId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeNotes(crewId, notes) {
  db().kvSet(`${NOTES_KEY}-${crewId}`, JSON.stringify(notes.slice(-40)));
}
const lastTasks = /* @__PURE__ */ new Map();
function listCrews() {
  return readCrews();
}
function getCrew(id2) {
  const crew = readCrews().find((entry) => entry.id === id2);
  if (!crew) throw new LauncherError("NOT_FOUND", `crew ${id2} does not exist`);
  return crew;
}
function crewOf(companionId) {
  return readCrews().find((crew) => crew.foremanId === companionId || crew.memberIds.includes(companionId)) ?? null;
}
function createCrew(name, foremanId, memberIds) {
  const foreman = getCompanion(foremanId);
  if (foreman.routine) {
    throw new LauncherError("INVALID_INPUT", "the foreman follows a routine", {
      title: `${foreman.username} cannot lead a crew`,
      message: "A foreman decides what everyone else does, which needs a language model. This companion is set to follow a scripted routine instead.",
      actions: [`Set ${foreman.username}'s routine to "Think for itself" on the Companion screen`, "Or pick a different foreman"]
    });
  }
  const existing = readCrews();
  const taken = [foremanId, ...memberIds].filter((id2) => crewOf(id2));
  if (taken.length > 0) {
    const names = taken.map((id2) => getCompanion(id2).username).join(", ");
    throw new LauncherError("INVALID_INPUT", "already in a crew", {
      title: "Already on a crew",
      message: `${names} ${taken.length === 1 ? "is" : "are"} already part of another crew.`,
      actions: ["Remove them from that crew first"]
    });
  }
  const crew = {
    id: node_crypto.randomUUID(),
    name: name.trim().slice(0, 40) || "Crew",
    foremanId,
    memberIds: memberIds.filter((id2) => id2 !== foremanId),
    createdAt: Date.now()
  };
  writeCrews([...existing, crew]);
  log$d.info(`created crew "${crew.name}" under ${foreman.username} with ${crew.memberIds.length} workers`);
  broadcast(crew.id);
  return crew;
}
function updateCrew(id2, patch) {
  const crews = readCrews();
  const index = crews.findIndex((entry) => entry.id === id2);
  if (index < 0) throw new LauncherError("NOT_FOUND", `crew ${id2} does not exist`);
  const crew = crews[index];
  if (typeof patch.name === "string") crew.name = patch.name.trim().slice(0, 40) || crew.name;
  if (Array.isArray(patch.memberIds)) {
    const wanted = patch.memberIds.filter((memberId) => memberId !== crew.foremanId);
    for (const memberId of wanted) {
      const other = crewOf(memberId);
      if (other && other.id !== id2) {
        throw new LauncherError("INVALID_INPUT", "already in another crew", {
          title: `${getCompanion(memberId).username} is on another crew`,
          message: `They are already part of "${other.name}".`,
          actions: ["Remove them from that crew first"]
        });
      }
    }
    crew.memberIds = wanted;
  }
  crews[index] = crew;
  writeCrews(crews);
  broadcast(id2);
  return crew;
}
function deleteCrew(id2) {
  writeCrews(readCrews().filter((crew) => crew.id !== id2));
  db().kvSet(`${NOTES_KEY}-${id2}`, JSON.stringify([]));
  log$d.info(`disbanded crew ${id2}`);
}
function crewNotes(crewId) {
  return readNotes(crewId);
}
function addCrewNote(crewId, from, text) {
  const notes = readNotes(crewId);
  notes.push({ at: Date.now(), from, text: text.slice(0, 240) });
  writeNotes(crewId, notes);
  broadcast(crewId);
}
function clearCrewNotes(crewId) {
  writeNotes(crewId, []);
  broadcast(crewId);
}
function membersOf(crew, forCompanionId) {
  const ids = [crew.foremanId, ...crew.memberIds].filter((id2) => id2 !== forCompanionId);
  return ids.flatMap((id2) => {
    const companion = listCompanions().find((entry) => entry.id === id2);
    if (!companion) return [];
    const online = isCompanionRunning(id2);
    return [
      {
        companionId: id2,
        username: companion.username,
        routine: companion.routine,
        online,
        status: online ? getCompanionState(id2).status : "idle",
        lastTask: lastTasks.get(id2) ?? null
      }
    ];
  });
}
function snapshotFor(companionId) {
  const crew = crewOf(companionId);
  if (!crew) return null;
  return {
    crewId: crew.id,
    crewName: crew.name,
    isForeman: crew.foremanId === companionId,
    members: membersOf(crew, companionId),
    notes: readNotes(crew.id)
  };
}
function broadcast(crewId) {
  const crew = readCrews().find((entry) => entry.id === crewId);
  if (!crew) return;
  for (const id2 of [crew.foremanId, ...crew.memberIds]) {
    if (!isCompanionRunning(id2)) continue;
    const snapshot = snapshotFor(id2);
    if (snapshot) pushCrewSnapshot(id2, snapshot);
  }
}
function refreshFor(companionId) {
  const snapshot = snapshotFor(companionId);
  if (snapshot && isCompanionRunning(companionId)) pushCrewSnapshot(companionId, snapshot);
}
function assignTask(fromCompanionId, toUsername, task) {
  const crew = crewOf(fromCompanionId);
  if (!crew) {
    log$d.warn(`a companion not on a crew tried to assign work`);
    return;
  }
  if (crew.foremanId !== fromCompanionId) {
    log$d.warn(`${getCompanion(fromCompanionId).username} is not the foreman and tried to assign work`);
    return;
  }
  const target = listCompanions().find(
    (companion) => companion.username.toLowerCase() === toUsername.toLowerCase() && (crew.memberIds.includes(companion.id) || companion.id === crew.foremanId) && companion.id !== fromCompanionId
  );
  if (!target) {
    log$d.warn(`no crew member called "${toUsername}" to assign work to`);
    return;
  }
  if (!isCompanionRunning(target.id)) {
    log$d.info(`${target.username} is not connected; the task was not delivered`);
    return;
  }
  if (target.routine) {
    log$d.info(`${target.username} follows the ${target.routine} routine and cannot take an assigned task`);
    addCrewNote(
      crew.id,
      getCompanion(fromCompanionId).username,
      `${target.username} runs the ${target.routine} routine and cannot take other jobs.`
    );
    return;
  }
  lastTasks.set(target.id, task);
  const foremanName = getCompanion(fromCompanionId).username;
  instructCompanion(target.id, `[from ${foremanName}, your crew foreman] ${task}`);
  log$d.info(`${foremanName} assigned "${task.slice(0, 60)}" to ${target.username}`);
  broadcast(crew.id);
}
function noteFromCompanion(companionId, text) {
  const crew = crewOf(companionId);
  if (!crew) return;
  addCrewNote(crew.id, getCompanion(companionId).username, text);
}
function startCrew(id2) {
  const crew = getCrew(id2);
  const started2 = [];
  const failed = [];
  for (const companionId of [crew.foremanId, ...crew.memberIds]) {
    if (isCompanionRunning(companionId)) continue;
    const companion = getCompanion(companionId);
    try {
      startCompanion(companionId);
      started2.push(companion.username);
    } catch (err) {
      failed.push({ username: companion.username, reason: err.message });
    }
  }
  setTimeout(() => broadcast(id2), 5e3).unref();
  return { started: started2, failed };
}
function stopCrew(id2) {
  const crew = getCrew(id2);
  const stopped = [];
  for (const companionId of [crew.foremanId, ...crew.memberIds]) {
    if (!isCompanionRunning(companionId)) continue;
    stopCompanion(companionId);
    stopped.push(getCompanion(companionId).username);
  }
  return stopped;
}
const crewService = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  addCrewNote,
  assignTask,
  broadcast,
  clearCrewNotes,
  createCrew,
  crewNotes,
  crewOf,
  deleteCrew,
  getCrew,
  listCrews,
  noteFromCompanion,
  refreshFor,
  snapshotFor,
  startCrew,
  stopCrew,
  updateCrew
}, Symbol.toStringTag, { value: "Module" }));
const log$c = createLogger("backups");
const SETTINGS_KEY$1 = "server-backup-settings";
const DEFAULTS$1 = {
  enabled: false,
  intervalMinutes: 60,
  keep: 8,
  onStop: true
};
function readAll$1() {
  const raw = db().kvGet(SETTINGS_KEY$1);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function serverBackupSettings(serverId) {
  return { ...DEFAULTS$1, ...readAll$1()[serverId] };
}
function setServerBackupSettings(serverId, patch) {
  const all = readAll$1();
  const next = {
    ...DEFAULTS$1,
    ...all[serverId],
    ...patch
  };
  next.intervalMinutes = Math.min(Math.max(Math.round(next.intervalMinutes), 5), 1440);
  next.keep = Math.min(Math.max(Math.round(next.keep), 1), 50);
  all[serverId] = next;
  db().kvSet(SETTINGS_KEY$1, JSON.stringify(all));
  reschedule(serverId);
  return next;
}
function serverBackupsDir(serverId) {
  return ensureDir(node_path.join(hostedServerDir(serverId), "backups"));
}
async function worldFolder(server2) {
  const dir = hostedServerDir(server2.id);
  try {
    const { readFile } = await import("node:fs/promises");
    const properties = await readFile(node_path.join(dir, "server.properties"), "utf8");
    const match = /^level-name=(.*)$/m.exec(properties);
    const name = match?.[1]?.trim();
    if (name && !name.includes("/") && !name.includes("\\") && name !== "..") return name;
  } catch {
  }
  return "world";
}
function timestamp() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}
const inFlight = /* @__PURE__ */ new Set();
async function backupHostedServer(serverId, reason = "manual") {
  if (inFlight.has(serverId)) {
    throw new LauncherError("ALREADY_RUNNING", "a snapshot of that server is already being taken");
  }
  const server2 = getHostedServer(serverId);
  const folder = await worldFolder(server2);
  const source = node_path.join(hostedServerDir(serverId), folder);
  if (!node_fs.existsSync(source)) {
    throw new LauncherError("NOT_FOUND", "that server has no world yet", {
      title: "There is no world to back up",
      message: `${server2.name} has not generated its world yet. Start it once and let it finish loading.`,
      actions: ['Press Start and wait for "Ready for players"']
    });
  }
  const live = isHostedServerRunning(serverId);
  inFlight.add(serverId);
  try {
    if (live) {
      sendHostedServerCommand(serverId, "save-off");
      sendHostedServerCommand(serverId, "save-all flush");
      await new Promise((resolve) => setTimeout(resolve, 3e3));
    }
    const dir = serverBackupsDir(serverId);
    await promises.mkdir(dir, { recursive: true });
    const fileName = `${folder}_${timestamp()}.zip`;
    const output = node_path.join(dir, fileName);
    log$c.info(`backing up "${server2.name}" (${reason})`);
    const result = await zipDirectory(source, output, (progress2) => {
      emit("download:progress", {
        taskId: `server-backup:${serverId}`,
        instanceId: null,
        phase: "verifying",
        label: `Backing up ${server2.name}`,
        currentFile: progress2.file,
        completedFiles: progress2.completed,
        totalFiles: progress2.total,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        etaSeconds: null,
        paused: false,
        errors: [],
        active: progress2.completed < progress2.total
      });
    });
    const info = {
      fileName,
      path: output,
      sizeBytes: result.bytes,
      createdAt: Date.now(),
      worldName: folder
    };
    await pruneOldBackups(serverId);
    log$c.info(`snapshot of "${server2.name}": ${fileName} (${result.entries} files)`);
    return info;
  } finally {
    if (live && isHostedServerRunning(serverId)) {
      try {
        sendHostedServerCommand(serverId, "save-on");
      } catch (err) {
        log$c.error(`could not turn saving back on for "${server2.name}"`, err);
        toast(
          "error",
          "Saving may still be off on your server",
          `Type "save-on" in the ${server2.name} console to be sure.`
        );
      }
    }
    inFlight.delete(serverId);
  }
}
async function listServerBackups(serverId) {
  const dir = serverBackupsDir(serverId);
  let names;
  try {
    names = (await promises.readdir(dir)).filter((name) => name.endsWith(".zip"));
  } catch {
    return [];
  }
  const backups = [];
  for (const name of names) {
    try {
      const info = await promises.stat(node_path.join(dir, name));
      backups.push({
        fileName: name,
        path: node_path.join(dir, name),
        sizeBytes: info.size,
        createdAt: info.mtimeMs,
        worldName: name.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/, "")
      });
    } catch {
    }
  }
  backups.sort((a, b) => b.createdAt - a.createdAt);
  return backups;
}
async function deleteServerBackup(serverId, fileName) {
  const dir = serverBackupsDir(serverId);
  await promises.rm(assertInside(dir, node_path.join(dir, fileName)), { force: true });
}
async function pruneOldBackups(serverId) {
  const { keep } = serverBackupSettings(serverId);
  const backups = await listServerBackups(serverId);
  for (const old of backups.slice(keep)) {
    await promises.rm(old.path, { force: true }).catch(() => void 0);
    log$c.info(`pruned old snapshot ${old.fileName}`);
  }
}
async function restoreServerBackup(serverId, fileName) {
  if (isHostedServerRunning(serverId)) {
    throw new LauncherError("ALREADY_RUNNING", "that server is running", {
      title: "Stop the server first",
      message: "A world cannot be replaced while the server has it open.",
      actions: ["Press Stop, wait for it to say stopped, then restore"]
    });
  }
  const server2 = getHostedServer(serverId);
  const dir = serverBackupsDir(serverId);
  const archive = assertInside(dir, node_path.join(dir, fileName));
  if (!node_fs.existsSync(archive)) throw new LauncherError("NOT_FOUND", "that snapshot no longer exists");
  const folder = await worldFolder(server2);
  const destination = node_path.join(hostedServerDir(serverId), folder);
  const AdmZip2 = (await import("adm-zip")).default;
  const { readFile, writeFile } = await import("node:fs/promises");
  const zip = new AdmZip2(await readFile(archive));
  if (node_fs.existsSync(destination)) {
    await backupHostedServer(serverId, "before restore").catch((err) => {
      log$c.warn(`could not snapshot before restoring: ${err.message}`);
    });
    await promises.rm(destination, { recursive: true, force: true });
  }
  await promises.mkdir(destination, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.entryName.includes("..")) continue;
    const target = assertInside(destination, node_path.join(destination, ...entry.entryName.split("/")));
    await promises.mkdir(node_path.join(target, ".."), { recursive: true });
    await writeFile(target, entry.getData());
  }
  log$c.info(`restored "${server2.name}" from ${fileName}`);
}
const timers = /* @__PURE__ */ new Map();
function clearTimer(serverId) {
  const timer2 = timers.get(serverId);
  if (timer2) clearInterval(timer2);
  timers.delete(serverId);
}
function reschedule(serverId) {
  clearTimer(serverId);
  const settings = serverBackupSettings(serverId);
  if (!settings.enabled || !isHostedServerRunning(serverId)) return;
  const timer2 = setInterval(
    () => {
      if (!isHostedServerRunning(serverId)) {
        clearTimer(serverId);
        return;
      }
      void backupHostedServer(serverId, "scheduled").catch((err) => {
        log$c.warn(`scheduled snapshot failed: ${err.message}`);
      });
    },
    settings.intervalMinutes * 6e4
  );
  timer2.unref();
  timers.set(serverId, timer2);
  log$c.info(`snapshots every ${settings.intervalMinutes} minutes for server ${serverId}`);
}
function initBackupScheduler() {
  void Promise.resolve().then(() => hostService).then(({ onHostedServerEvent: onHostedServerEvent2 }) => {
    onHostedServerEvent2((event, serverId) => {
      if (event === "ready") {
        reschedule(serverId);
        return;
      }
      if (event === "stopped") {
        clearTimer(serverId);
        const settings = serverBackupSettings(serverId);
        if (!settings.enabled || !settings.onStop) return;
        void backupHostedServer(serverId, "on stop").then((info) => {
          notifyDesktop({
            title: "World backed up",
            body: `A snapshot of ${getHostedServer(serverId).name} was saved as the server shut down.`
          });
          log$c.info(`shutdown snapshot: ${info.fileName}`);
        }).catch((err) => log$c.warn(`shutdown snapshot failed: ${err.message}`));
      }
    });
  });
  for (const server2 of listHostedServers()) {
    if (isHostedServerRunning(server2.id)) reschedule(server2.id);
  }
  log$c.info("server backup scheduler ready");
}
const log$b = createLogger("modpack");
const ALLOWED_DOWNLOAD_DOMAINS = [
  "modrinth.com",
  "githubusercontent.com",
  "github.com",
  "gitlab.com",
  "shedaniel.me",
  "maven.minecraftforge.net",
  "maven.neoforged.net",
  "maven.fabricmc.net"
];
function isAllowedDownload(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_DOWNLOAD_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
function resolveLoader(dependencies) {
  if (dependencies["fabric-loader"]) return { loader: "fabric", version: dependencies["fabric-loader"] };
  if (dependencies["quilt-loader"]) return { loader: "quilt", version: dependencies["quilt-loader"] };
  if (dependencies["neoforge"]) return { loader: "neoforge", version: dependencies["neoforge"] };
  if (dependencies["forge"]) return { loader: "forge", version: dependencies["forge"] };
  return { loader: "vanilla", version: null };
}
function safeTarget(gameDir, relative) {
  const cleaned = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || node_path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    throw new LauncherError("INVALID_INPUT", `modpack entry escapes the instance: ${relative.slice(0, 120)}`);
  }
  const target = node_path.join(gameDir, ...cleaned.split("/"));
  return assertInside(gameDir, target);
}
function readIndex$1(zip) {
  const entry = zip.getEntry("modrinth.index.json");
  if (!entry) {
    throw new LauncherError("INVALID_INPUT", "no modrinth.index.json in the archive", {
      title: "That is not a Modrinth modpack",
      message: "The archive contains neither a modrinth.index.json nor a CurseForge manifest.json, so it is not a modpack this launcher recognises.",
      actions: [
        "Check you selected a .mrpack or a CurseForge pack .zip",
        "Some sites wrap the pack in another zip — extract it first"
      ]
    });
  }
  let index;
  try {
    index = JSON.parse(entry.getData().toString("utf8"));
  } catch {
    throw new LauncherError("INVALID_INPUT", "modrinth.index.json is not valid JSON");
  }
  if (!index.dependencies?.minecraft) {
    throw new LauncherError("INVALID_INPUT", "the pack does not declare a Minecraft version");
  }
  return index;
}
function countOverrides(zip) {
  return zip.getEntries().filter((e) => !e.isDirectory && (e.entryName.startsWith("overrides/") || e.entryName.startsWith("client-overrides/"))).length;
}
async function inspectModpack(filePath) {
  if (!node_fs.existsSync(filePath)) throw new LauncherError("NOT_FOUND", "that file no longer exists");
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch {
    throw new LauncherError("INVALID_INPUT", "the archive could not be opened", {
      title: "That file could not be read",
      message: "The modpack archive appears to be damaged or is not a zip file.",
      actions: ["Download the modpack again"]
    });
  }
  const cf = readCfManifest(zip);
  if (cf) return inspectCurseForge(zip, cf);
  const index = readIndex$1(zip);
  const { loader, version } = resolveLoader(index.dependencies);
  return {
    name: index.name || "Modpack",
    version: index.versionId || "",
    summary: index.summary ?? null,
    minecraftVersion: index.dependencies.minecraft,
    loader,
    loaderVersion: version,
    fileCount: (index.files ?? []).length,
    overrideCount: countOverrides(zip),
    format: "modrinth"
  };
}
async function installModpackFromFile(filePath, nameOverride) {
  const zip = new AdmZip(filePath);
  const cf = readCfManifest(zip);
  if (cf) return await installCurseForgePack(zip, cf, nameOverride);
  const index = readIndex$1(zip);
  const { loader, version: loaderVersion } = resolveLoader(index.dependencies);
  log$b.info(`installing modpack "${index.name}" (${index.dependencies.minecraft}, ${loader})`);
  const instance = await createInstance({
    name: (nameOverride?.trim() || index.name || "Modpack").slice(0, 64),
    minecraftVersion: index.dependencies.minecraft,
    loader,
    loaderVersion
  });
  const task = createTask({ instanceId: instance.id, label: `Installing ${index.name}`, phase: "libraries" });
  const skipped = [];
  try {
    const items = [];
    for (const file2 of index.files ?? []) {
      if (file2.env?.client === "unsupported") continue;
      const url = (file2.downloads ?? []).find(isAllowedDownload);
      if (!url) {
        skipped.push(file2.path);
        log$b.warn(`skipping "${file2.path}": no download URL from an allowed host`);
        continue;
      }
      items.push({
        url,
        destination: safeTarget(instance.gameDir, file2.path),
        sha1: file2.hashes?.sha1 ?? null,
        size: file2.fileSize ?? null,
        label: file2.path.split("/").pop() ?? file2.path
      });
    }
    task.setPhase("libraries", `Downloading ${items.length} modpack files`);
    task.add(items);
    await task.run();
    task.setPhase("verifying", "Unpacking modpack configuration");
    let overrides = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const prefix = entry.entryName.startsWith("overrides/") ? "overrides/" : entry.entryName.startsWith("client-overrides/") ? "client-overrides/" : null;
      if (!prefix) continue;
      const relative = entry.entryName.slice(prefix.length);
      if (!relative) continue;
      const target = safeTarget(instance.gameDir, relative);
      await promises.mkdir(node_path.dirname(target), { recursive: true });
      await promises.writeFile(target, entry.getData());
      overrides++;
    }
    task.setPhase("done", "Modpack installed");
    task.markDone();
    log$b.info(`modpack "${index.name}" installed: ${items.length} files, ${overrides} overrides, ${skipped.length} skipped`);
    return { instance, installedFiles: items.length, overrides, skipped };
  } catch (err) {
    task.cancel();
    await deleteInstance(instance.id, true).catch(() => void 0);
    throw err;
  }
}
async function installModpackFromModrinth(versionId, nameOverride) {
  const version = await getJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    timeoutMs: 2e4,
    retries: 2
  });
  const file2 = version.files.find((f) => f.filename.endsWith(".mrpack")) ?? version.files.find((f) => f.primary);
  if (!file2 || !isAllowedDownload(file2.url)) {
    throw new LauncherError("INVALID_INPUT", "that version has no downloadable .mrpack file");
  }
  const workDir = node_path.join(node_os.tmpdir(), `nexuscraft-mrpack-${node_crypto.randomUUID()}`);
  await promises.mkdir(workDir, { recursive: true });
  const localPath = node_path.join(workDir, "pack.mrpack");
  try {
    log$b.info(`downloading modpack archive ${file2.filename}`);
    await promises.writeFile(localPath, await getBuffer(file2.url, { timeoutMs: 3e5, retries: 2 }));
    return await installModpackFromFile(localPath, nameOverride);
  } finally {
    await promises.rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
}
function parseCfLoader(modLoaders) {
  const primary = modLoaders?.find((l) => l.primary) ?? modLoaders?.[0];
  if (!primary?.id) return { loader: "vanilla", version: null };
  const [name, ...rest] = primary.id.split("-");
  const version = rest.join("-") || null;
  switch (name.toLowerCase()) {
    case "forge":
      return { loader: "forge", version };
    case "neoforge":
      return { loader: "neoforge", version };
    case "fabric":
      return { loader: "fabric", version };
    case "quilt":
      return { loader: "quilt", version };
    default:
      return { loader: "vanilla", version: null };
  }
}
function readCfManifest(zip) {
  const entry = zip.getEntry("manifest.json");
  if (!entry) return null;
  try {
    const parsed = JSON.parse(entry.getData().toString("utf8"));
    return parsed.minecraft?.version ? parsed : null;
  } catch {
    return null;
  }
}
function inspectCurseForge(zip, manifest) {
  const { loader, version } = parseCfLoader(manifest.minecraft.modLoaders);
  const overridesDir = manifest.overrides ?? "overrides";
  const overrideCount = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.startsWith(`${overridesDir}/`)).length;
  return {
    name: manifest.name || "Modpack",
    version: manifest.version || "",
    summary: manifest.author ? `by ${manifest.author}` : null,
    minecraftVersion: manifest.minecraft.version,
    loader,
    loaderVersion: version,
    fileCount: (manifest.files ?? []).length,
    overrideCount,
    format: "curseforge"
  };
}
async function installCurseForgePack(zip, manifest, nameOverride) {
  const { loader, version: loaderVersion } = parseCfLoader(manifest.minecraft.modLoaders);
  log$b.info(`installing CurseForge modpack "${manifest.name}" (${manifest.minecraft.version}, ${loader})`);
  const instance = await createInstance({
    name: (nameOverride?.trim() || manifest.name || "Modpack").slice(0, 64),
    minecraftVersion: manifest.minecraft.version,
    loader,
    loaderVersion
  });
  const task = createTask({ instanceId: instance.id, label: `Installing ${manifest.name}`, phase: "libraries" });
  const skipped = [];
  try {
    const entries = manifest.files ?? [];
    task.setPhase("libraries", `Resolving ${entries.length} files with CurseForge`);
    const resolved = await getFiles(entries.map((f) => f.fileID));
    const byId = new Map(resolved.map((f) => [f.id, f]));
    const items = [];
    for (const entry of entries) {
      const file2 = byId.get(entry.fileID);
      if (!file2) {
        skipped.push(`file ${entry.fileID}`);
        continue;
      }
      if (!file2.downloadUrl) {
        skipped.push(file2.fileName || `file ${entry.fileID}`);
        continue;
      }
      items.push({
        url: file2.downloadUrl,
        destination: safeTarget(instance.gameDir, `mods/${file2.fileName}`),
        sha1: file2.hashes?.find((h) => h.algo === 1)?.value ?? null,
        size: file2.fileLength ?? null,
        label: file2.fileName
      });
    }
    task.setPhase("libraries", `Downloading ${items.length} modpack files`);
    task.add(items);
    await task.run();
    task.setPhase("verifying", "Unpacking modpack configuration");
    const overridesDir = manifest.overrides ?? "overrides";
    let overrides = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.startsWith(`${overridesDir}/`)) continue;
      const relative = entry.entryName.slice(overridesDir.length + 1);
      if (!relative) continue;
      const target = safeTarget(instance.gameDir, relative);
      await promises.mkdir(node_path.dirname(target), { recursive: true });
      await promises.writeFile(target, entry.getData());
      overrides++;
    }
    task.setPhase("done", "Modpack installed");
    task.markDone();
    if (skipped.length > 0) {
      log$b.warn(`${skipped.length} file(s) could not be downloaded automatically (author opt-out)`);
    }
    return { instance, installedFiles: items.length, overrides, skipped };
  } catch (err) {
    task.cancel();
    await deleteInstance(instance.id, true).catch(() => void 0);
    throw err;
  }
}
async function installCurseForgeModpack(projectId, fileId, nameOverride) {
  const [file2] = await getFiles([Number(fileId)]);
  if (!file2?.downloadUrl) {
    throw new LauncherError("INVALID_INPUT", `modpack file ${fileId} cannot be downloaded`, {
      title: "This modpack must be downloaded manually",
      message: "Its author has turned off third-party downloads on CurseForge, so no launcher may fetch it automatically. Download the pack .zip from its CurseForge page, then use Import modpack.",
      actions: [
        "Open the pack page on CurseForge and download the .zip",
        "Return here and use Instances -> Import modpack",
        "Modrinth packs carry no such restriction"
      ]
    });
  }
  const workDir = node_path.join(node_os.tmpdir(), `nexuscraft-cfpack-${node_crypto.randomUUID()}`);
  await promises.mkdir(workDir, { recursive: true });
  const localPath = node_path.join(workDir, "pack.zip");
  try {
    await promises.writeFile(localPath, await getBuffer(file2.downloadUrl, { timeoutMs: 3e5, retries: 2 }));
    return await installModpackFromFile(localPath, nameOverride);
  } finally {
    await promises.rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
}
const log$a = createLogger("pack-export");
const API = "https://api.modrinth.com/v2";
const HASHED_DIRS = ["mods", "resourcepacks", "shaderpacks"];
const CONFIG_DIRS = ["config", "defaultconfigs", "kubejs", "scripts", "resourcepacks", "shaderpacks", "mods"];
async function hashFile(path2) {
  const data = await promises.readFile(path2);
  return {
    sha1: node_crypto.createHash("sha1").update(data).digest("hex"),
    sha512: node_crypto.createHash("sha512").update(data).digest("hex"),
    size: data.length
  };
}
async function lookupByHash(hashes) {
  if (hashes.length === 0) return {};
  try {
    const response = await request(`${API}/version_files`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ hashes, algorithm: "sha1" }),
      timeoutMs: 25e3,
      retries: 2
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    log$a.warn(`could not reach Modrinth to match files: ${err.message}`);
    return {};
  }
}
async function walk$1(dir) {
  const found = [];
  async function visit(current) {
    let entries;
    try {
      entries = await promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = node_path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) found.push(node_path.relative(dir, full));
    }
  }
  await visit(dir);
  return found;
}
function dependencyBlock(instance) {
  const dependencies = { minecraft: instance.minecraftVersion };
  const version = instance.loaderVersion ?? "";
  switch (instance.loader) {
    case "fabric":
      dependencies["fabric-loader"] = version || "0.16.9";
      break;
    case "quilt":
      dependencies["quilt-loader"] = version || "0.27.0";
      break;
    case "forge":
      dependencies["forge"] = version || "";
      break;
    case "neoforge":
      dependencies["neoforge"] = version || "";
      break;
  }
  for (const [key, value] of Object.entries(dependencies)) {
    if (!value) delete dependencies[key];
  }
  return dependencies;
}
async function exportInstanceAsPack(instance, outputPath, options = {}) {
  const includeConfigs = options.includeConfigs ?? true;
  const includeWorlds = options.includeWorlds ?? false;
  const candidates = [];
  for (const subdir of HASHED_DIRS) {
    const dir = instanceSubdir(instance, subdir);
    if (!node_fs.existsSync(dir)) continue;
    for (const relativePath of await walk$1(dir)) {
      if (relativePath.endsWith(".disabled")) continue;
      if (!/\.(jar|zip)$/i.test(relativePath)) continue;
      const absolute = node_path.join(dir, relativePath);
      const { sha1, sha512, size: size2 } = await hashFile(absolute);
      candidates.push({
        packPath: `${subdir}/${relativePath.split(node_path.sep).join("/")}`,
        absolute,
        sha1,
        sha512,
        size: size2
      });
    }
  }
  const matched = await lookupByHash(candidates.map((candidate) => candidate.sha1));
  const files = [];
  const copyIntoOverrides = [];
  const unmatched = [];
  for (const candidate of candidates) {
    const version = matched[candidate.sha1];
    const remote = version?.files.find((file2) => file2.hashes?.sha1 === candidate.sha1);
    if (remote && remote.url) {
      files.push({
        path: candidate.packPath,
        hashes: { sha1: candidate.sha1, sha512: candidate.sha512 },
        downloads: [remote.url],
        fileSize: candidate.size
      });
    } else {
      copyIntoOverrides.push({ packPath: candidate.packPath, absolute: candidate.absolute });
      unmatched.push(candidate.packPath.split("/").pop() ?? candidate.packPath);
    }
  }
  if (includeConfigs) {
    for (const subdir of CONFIG_DIRS) {
      const dir = instanceSubdir(instance, subdir);
      if (!node_fs.existsSync(dir)) continue;
      for (const relativePath of await walk$1(dir)) {
        const packPath = `${subdir}/${relativePath.split(node_path.sep).join("/")}`;
        if (candidates.some((candidate) => candidate.packPath === packPath)) continue;
        if (relativePath.endsWith(".disabled")) continue;
        copyIntoOverrides.push({ packPath, absolute: node_path.join(dir, relativePath) });
      }
    }
  }
  if (includeWorlds) {
    const saves = instanceSubdir(instance, "saves");
    if (node_fs.existsSync(saves)) {
      for (const relativePath of await walk$1(saves)) {
        copyIntoOverrides.push({
          packPath: `saves/${relativePath.split(node_path.sep).join("/")}`,
          absolute: node_path.join(saves, relativePath)
        });
      }
    }
  }
  if (files.length === 0 && copyIntoOverrides.length === 0) {
    throw new LauncherError("NOT_FOUND", "nothing to export", {
      title: "There is nothing in this instance to pack",
      message: `${instance.name} has no mods, packs or config files, so the export would be empty.`,
      actions: ["Add some mods first, then export"]
    });
  }
  const index = {
    formatVersion: 1,
    game: "minecraft",
    versionId: (options.version ?? "1.0.0").slice(0, 32),
    name: (options.name?.trim() || instance.name).slice(0, 120),
    summary: options.summary?.slice(0, 400) || void 0,
    files,
    dependencies: dependencyBlock(instance)
  };
  const zip = new AdmZip();
  zip.addFile("modrinth.index.json", Buffer.from(JSON.stringify(index, null, 2), "utf8"));
  for (const entry of copyIntoOverrides) {
    try {
      zip.addFile(`overrides/${entry.packPath}`, await promises.readFile(entry.absolute));
    } catch (err) {
      log$a.warn(`skipped ${entry.packPath}: ${err.message}`);
    }
  }
  await new Promise((resolve, reject) => {
    zip.writeZip(outputPath, (err) => err ? reject(err) : resolve());
  });
  const { size } = await promises.stat(outputPath);
  log$a.info(
    `exported "${instance.name}" as ${outputPath}: ${files.length} linked, ${copyIntoOverrides.length} copied`
  );
  return {
    path: outputPath,
    bytes: size,
    linked: files.length,
    overrides: copyIntoOverrides.length,
    unmatched
  };
}
const log$9 = createLogger("snapshots");
const LINKED_DIRS = ["mods", "resourcepacks", "shaderpacks"];
const COPIED_DIRS = ["config", "defaultconfigs", "kubejs", "scripts"];
const TRACKED = [...LINKED_DIRS, ...COPIED_DIRS];
const TRACKED_FILES = ["options.txt", "servers.dat", "optionsof.txt", "optionsshaders.txt"];
function snapshotsRoot(instanceId) {
  return node_path.join(instanceDir(instanceId), "snapshots");
}
function snapshotDir(instanceId, snapshotId) {
  return assertInside(snapshotsRoot(instanceId), node_path.join(snapshotsRoot(instanceId), snapshotId));
}
const INDEX_FILE = "snapshots.json";
async function readIndex(instanceId) {
  try {
    const raw = await promises.readFile(node_path.join(snapshotsRoot(instanceId), INDEX_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function writeIndex(instanceId, entries) {
  await promises.mkdir(snapshotsRoot(instanceId), { recursive: true });
  await promises.writeFile(node_path.join(snapshotsRoot(instanceId), INDEX_FILE), JSON.stringify(entries, null, 2), "utf8");
}
async function walk(dir) {
  const found = /* @__PURE__ */ new Map();
  async function visit(current) {
    let entries;
    try {
      entries = await promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = node_path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        try {
          found.set(node_path.relative(dir, full).split(node_path.sep).join("/"), (await promises.stat(full)).size);
        } catch {
        }
      }
    }
  }
  await visit(dir);
  return found;
}
async function copyTree(from, to, mode) {
  let files = 0;
  let bytes = 0;
  let allLinked = mode === "link";
  const entries = await walk(from);
  for (const [relativePath, size] of entries) {
    const source = node_path.join(from, ...relativePath.split("/"));
    const target = node_path.join(to, ...relativePath.split("/"));
    await promises.mkdir(node_path.join(target, ".."), { recursive: true });
    let placed = false;
    if (mode === "link") {
      try {
        await promises.link(source, target);
        placed = true;
      } catch {
        allLinked = false;
      }
    }
    if (!placed) {
      try {
        await promises.cp(source, target);
      } catch (err) {
        log$9.warn(`could not snapshot ${relativePath}: ${err.message}`);
        continue;
      }
    }
    files += 1;
    bytes += size;
  }
  return { files, bytes, linked: allLinked };
}
function modeFor(folder) {
  return LINKED_DIRS.includes(folder) ? "link" : "copy";
}
async function listSnapshots(instanceId) {
  const entries = await readIndex(instanceId);
  return entries.filter((entry) => node_fs.existsSync(snapshotDir(instanceId, entry.id))).sort((a, b) => b.createdAt - a.createdAt);
}
async function createSnapshot(instanceId, name, note = "") {
  const instance = getInstance(instanceId);
  if (isRunning(instanceId)) {
    throw new LauncherError("ALREADY_RUNNING", "the game is running", {
      title: "Close Minecraft first",
      message: "A snapshot taken while the game is running can capture half-written config files.",
      actions: ["Quit Minecraft, then take the snapshot"]
    });
  }
  const id2 = node_crypto.randomUUID();
  const target = snapshotDir(instanceId, id2);
  await promises.mkdir(target, { recursive: true });
  let files = 0;
  let bytes = 0;
  let linked = true;
  try {
    for (const folder of TRACKED) {
      const source = node_path.join(instance.gameDir, folder);
      if (!node_fs.existsSync(source)) continue;
      const result = await copyTree(source, node_path.join(target, folder), modeFor(folder));
      files += result.files;
      bytes += result.bytes;
      if (modeFor(folder) === "link" && !result.linked) linked = false;
    }
    for (const fileName of TRACKED_FILES) {
      const source = node_path.join(instance.gameDir, fileName);
      if (!node_fs.existsSync(source)) continue;
      await promises.cp(source, node_path.join(target, fileName)).catch(() => void 0);
      files += 1;
      bytes += (await promises.stat(source).catch(() => ({ size: 0 }))).size;
    }
  } catch (err) {
    await promises.rm(target, { recursive: true, force: true }).catch(() => void 0);
    throw err;
  }
  const snapshot = {
    id: id2,
    instanceId,
    name: name.trim().slice(0, 60) || "Snapshot",
    note: note.slice(0, 300),
    createdAt: Date.now(),
    files,
    bytes,
    /** False when the filesystem made us copy, which is worth telling the user. */
    linked,
    minecraftVersion: instance.minecraftVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion
  };
  const entries = await readIndex(instanceId);
  await writeIndex(instanceId, [snapshot, ...entries]);
  log$9.info(
    `snapshot "${snapshot.name}" of ${instance.name}: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB ${linked ? "linked" : "copied"}`
  );
  return snapshot;
}
async function deleteSnapshot(instanceId, snapshotId) {
  await promises.rm(snapshotDir(instanceId, snapshotId), { recursive: true, force: true });
  await writeIndex(
    instanceId,
    (await readIndex(instanceId)).filter((entry) => entry.id !== snapshotId)
  );
}
async function restoreSnapshot(instanceId, snapshotId) {
  const instance = getInstance(instanceId);
  if (isRunning(instanceId)) {
    throw new LauncherError("ALREADY_RUNNING", "the game is running", {
      title: "Close Minecraft first",
      message: "Replacing mods and configs under a running game would crash it.",
      actions: ["Quit Minecraft, then restore"]
    });
  }
  const entries = await readIndex(instanceId);
  const snapshot = entries.find((entry) => entry.id === snapshotId);
  if (!snapshot) throw new LauncherError("NOT_FOUND", "that snapshot no longer exists");
  const source = snapshotDir(instanceId, snapshotId);
  if (!node_fs.existsSync(source)) throw new LauncherError("NOT_FOUND", "that snapshot is no longer on disk");
  await createSnapshot(instanceId, `Before restoring "${snapshot.name}"`, "Taken automatically").catch(
    (err) => log$9.warn(`could not snapshot before restoring: ${err.message}`)
  );
  for (const folder of TRACKED) {
    const target = node_path.join(instance.gameDir, folder);
    const saved = node_path.join(source, folder);
    await promises.rm(target, { recursive: true, force: true }).catch(() => void 0);
    if (node_fs.existsSync(saved)) {
      await promises.mkdir(target, { recursive: true });
      await copyTree(saved, target, modeFor(folder));
    }
  }
  for (const fileName of TRACKED_FILES) {
    const target = node_path.join(instance.gameDir, fileName);
    const saved = node_path.join(source, fileName);
    await promises.rm(target, { force: true }).catch(() => void 0);
    if (node_fs.existsSync(saved)) await promises.cp(saved, target).catch(() => void 0);
  }
  if (snapshot.loader !== instance.loader || snapshot.loaderVersion !== instance.loaderVersion) {
    updateInstance(instanceId, {
      loader: snapshot.loader,
      loaderVersion: snapshot.loaderVersion,
      // Force the loader profile to be resolved again on the next launch.
      resolvedVersionId: null
    });
  }
  log$9.info(`restored ${instance.name} to "${snapshot.name}"`);
  return snapshot;
}
async function diffSnapshot(instanceId, snapshotId) {
  const instance = getInstance(instanceId);
  const source = snapshotDir(instanceId, snapshotId);
  if (!node_fs.existsSync(source)) throw new LauncherError("NOT_FOUND", "that snapshot is no longer on disk");
  const added = [];
  const removed = [];
  const changed = [];
  for (const folder of TRACKED) {
    const before = node_fs.existsSync(node_path.join(source, folder)) ? await walk(node_path.join(source, folder)) : /* @__PURE__ */ new Map();
    const after = node_fs.existsSync(node_path.join(instance.gameDir, folder)) ? await walk(node_path.join(instance.gameDir, folder)) : /* @__PURE__ */ new Map();
    for (const [path2, size] of after) {
      if (!before.has(path2)) added.push({ path: `${folder}/${path2}`, sizeBytes: size });
      else if (before.get(path2) !== size) changed.push({ path: `${folder}/${path2}`, sizeBytes: size });
    }
    for (const [path2, size] of before) {
      if (!after.has(path2)) removed.push({ path: `${folder}/${path2}`, sizeBytes: size });
    }
  }
  const byPath = (a, b) => a.path.localeCompare(b.path);
  return {
    snapshotId,
    added: added.sort(byPath),
    removed: removed.sort(byPath),
    changed: changed.sort(byPath)
  };
}
const log$8 = createLogger("tunnel");
const SETTINGS_KEY = "server-tunnel-settings";
const running = /* @__PURE__ */ new Map();
function readAll() {
  const raw = db().kvGet(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
const DEFAULTS = { agentPath: "", provider: "playit", args: "" };
function tunnelSettings(serverId) {
  return { ...DEFAULTS, ...readAll()[serverId] };
}
function setTunnelSettings(serverId, patch) {
  const all = readAll();
  const next = { ...tunnelSettings(serverId), ...patch };
  if (next.agentPath && !node_fs.existsSync(next.agentPath)) {
    throw new LauncherError("NOT_FOUND", "no file at that path", {
      title: "That file is not there",
      message: `NexusCraft could not find anything at ${next.agentPath}.`,
      actions: ["Browse to the agent you downloaded", "On Windows it is usually a .exe in your Downloads folder"]
    });
  }
  all[serverId] = next;
  db().kvSet(SETTINGS_KEY, JSON.stringify(all));
  return next;
}
function blankState(serverId) {
  return { serverId, status: "stopped", address: null, detail: "", output: [] };
}
function tunnelState(serverId) {
  return running.get(serverId)?.state ?? blankState(serverId);
}
function setState(serverId, patch) {
  const entry = running.get(serverId);
  const next = { ...entry?.state ?? blankState(serverId), ...patch };
  if (entry) entry.state = next;
  emit("tunnel:state", next);
}
function addressFromOutput(line) {
  const withPort = /\b((?:[a-z0-9-]+\.)+[a-z]{2,}:\d{2,5})\b/i.exec(line);
  if (withPort) return withPort[1];
  if (/tunnel|address|connect|endpoint|assigned/i.test(line)) {
    const host = /\b((?:[a-z0-9-]+\.)+(?:gg|com|net|io|org|dev|xyz))\b/i.exec(line);
    if (host) return host[1];
  }
  return null;
}
function startTunnel(serverId, serverPort) {
  if (running.has(serverId)) return tunnelState(serverId);
  const settings = tunnelSettings(serverId);
  if (!settings.agentPath) {
    throw new LauncherError("INVALID_INPUT", "no tunnel agent configured", {
      title: "No relay agent is set up",
      message: "A relay makes your server reachable when your router cannot forward a port — on carrier-grade NAT, for instance. NexusCraft drives an agent you install yourself rather than downloading one for you.",
      actions: [
        "Get the playit.gg agent from playit.gg, install it, and sign in once",
        'Then point NexusCraft at it with "Choose the agent"'
      ]
    });
  }
  if (!node_fs.existsSync(settings.agentPath)) {
    throw new LauncherError("NOT_FOUND", "the agent is gone", {
      title: "The relay agent is no longer there",
      message: `Nothing is at ${settings.agentPath} any more.`,
      actions: ["Point NexusCraft at the agent again"]
    });
  }
  const extra = settings.args.match(/"[^"]*"|\S+/g)?.map((argument) => argument.replace(/^"|"$/g, "").replace("{port}", String(serverPort))) ?? [];
  log$8.info(`starting the relay agent for server ${serverId}`);
  const child = node_child_process.spawn(settings.agentPath, extra, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const entry = {
    child,
    state: {
      serverId,
      status: "starting",
      address: null,
      detail: "Starting the relay agent…",
      output: []
    }
  };
  running.set(serverId, entry);
  emit("tunnel:state", entry.state);
  const consume = (chunk) => {
    for (const raw of chunk.toString("utf8").split(/\r?\n/)) {
      const text = raw.trimEnd();
      if (!text) continue;
      const output = [...entry.state.output, text].slice(-60);
      const address = entry.state.address ?? addressFromOutput(text);
      const becameReady = address && !entry.state.address;
      setState(serverId, {
        output,
        address,
        status: address ? "running" : entry.state.status,
        detail: address ? "Friends can join at this address." : entry.state.detail
      });
      if (becameReady) {
        log$8.info(`the relay is up at ${address}`);
        toast("success", "Your server is reachable", `Friends can join at ${address}.`);
      }
    }
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  child.on("error", (err) => {
    running.delete(serverId);
    log$8.error("the relay agent could not be started", err);
    emit("tunnel:state", {
      ...blankState(serverId),
      status: "error",
      detail: `Could not start the agent: ${err.message}`
    });
  });
  child.on("exit", (code, signal) => {
    const wasRunning = running.get(serverId)?.state.status === "running";
    const output = running.get(serverId)?.state.output ?? [];
    running.delete(serverId);
    const clean = code === 0 || signal === "SIGTERM";
    emit("tunnel:state", {
      ...blankState(serverId),
      status: clean ? "stopped" : "error",
      detail: clean ? "The relay was stopped." : `The agent exited unexpectedly (code ${code ?? signal}). Its last words: ${output.slice(-2).join(" / ") || "nothing"}`,
      output
    });
    if (!clean && wasRunning) {
      toast("warning", "The relay stopped", "Your server is no longer reachable from outside your network.");
    }
    log$8.info(`the relay agent exited with code ${code ?? signal}`);
  });
  return entry.state;
}
function stopTunnel(serverId) {
  const entry = running.get(serverId);
  if (!entry) return blankState(serverId);
  setState(serverId, { status: "stopped", detail: "Stopping…" });
  entry.child.kill("SIGTERM");
  setTimeout(() => {
    if (running.has(serverId)) entry.child.kill("SIGKILL");
  }, 5e3).unref();
  return tunnelState(serverId);
}
function shutdownTunnels() {
  for (const [serverId, entry] of running) {
    entry.child.kill("SIGTERM");
    running.delete(serverId);
  }
}
function initTunnels() {
  void Promise.resolve().then(() => hostService).then(({ onHostedServerEvent: onHostedServerEvent2 }) => {
    onHostedServerEvent2((event, serverId) => {
      if (event === "stopped" && running.has(serverId)) {
        log$8.info(`server ${serverId} stopped; closing its relay`);
        stopTunnel(serverId);
      }
    });
  });
}
const log$7 = createLogger("links");
const PROTOCOL = "nexuscraft";
const SAFE_ID = /^[A-Za-z0-9]{1,32}$/;
const SAFE_HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
function parseDeepLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:`) return null;
  const segments = [url.hostname, ...url.pathname.split("/")].map((segment) => decodeURIComponent(segment.trim())).filter(Boolean);
  const [action, ...rest] = segments;
  if (!action) return null;
  switch (action.toLowerCase()) {
    case "modpack": {
      const [source, first, second] = rest;
      if (source === "modrinth" && SAFE_ID.test(first ?? "")) {
        return { kind: "modpack-modrinth", versionId: first };
      }
      if (source === "curseforge" && SAFE_ID.test(first ?? "") && SAFE_ID.test(second ?? "")) {
        return { kind: "modpack-curseforge", projectId: first, fileId: second };
      }
      return null;
    }
    case "mod": {
      const [source, first] = rest;
      if (source === "modrinth" && SAFE_ID.test(first ?? "")) {
        return { kind: "mod-modrinth", versionId: first };
      }
      return null;
    }
    case "join": {
      const [host, portText] = rest;
      if (!host || !SAFE_HOST.test(host)) return null;
      const port = Number(portText ?? "25565");
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      const packVersionId = url.searchParams.get("pack");
      return {
        kind: "join",
        host,
        port,
        name: url.searchParams.get("name")?.slice(0, 64) ?? null,
        minecraftVersion: url.searchParams.get("version")?.slice(0, 32) ?? null,
        loader: url.searchParams.get("loader")?.slice(0, 16) ?? null,
        packVersionId: packVersionId && SAFE_ID.test(packVersionId) ? packVersionId : null
      };
    }
    default:
      return null;
  }
}
function buildJoinLink(input) {
  if (!SAFE_HOST.test(input.host)) {
    throw new LauncherError("INVALID_INPUT", `refusing to build a link for host "${input.host}"`);
  }
  const url = new URL(`${PROTOCOL}://join/${input.host}/${input.port}`);
  if (input.name) url.searchParams.set("name", input.name.slice(0, 64));
  if (input.minecraftVersion) url.searchParams.set("version", input.minecraftVersion);
  if (input.loader) url.searchParams.set("loader", input.loader);
  if (input.packVersionId) url.searchParams.set("pack", input.packVersionId);
  return url.toString();
}
function registerProtocol() {
  const registered2 = process.defaultApp && process.argv.length >= 2 ? electron.app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]) : electron.app.setAsDefaultProtocolClient(PROTOCOL);
  if (registered2) log$7.info(`registered ${PROTOCOL}:// links`);
  else log$7.warn(`could not register ${PROTOCOL}:// links`);
}
function findLinkInArgv(argv) {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}
const log$6 = createLogger("link-actions");
let pendingInvite = null;
function takePendingInvite() {
  const invite = pendingInvite;
  pendingInvite = null;
  return invite;
}
function currentPendingInvite() {
  return pendingInvite;
}
async function handleDeepLink(raw) {
  const link = parseDeepLink(raw);
  if (!link) {
    log$6.warn(`ignored an unusable link: ${raw.slice(0, 120)}`);
    toast("warning", "That link was not understood", "NexusCraft only opens its own install and invite links.");
    return;
  }
  log$6.info(`handling a ${link.kind} link`);
  switch (link.kind) {
    case "modpack-modrinth": {
      toast("info", "Installing a modpack", "Started from a link. This can take a few minutes.");
      const result = await installModpackFromModrinth(link.versionId);
      toast("success", `${result.instance.name} is ready`, "Installed from a link.");
      return;
    }
    case "modpack-curseforge": {
      toast("info", "Installing a modpack", "Started from a link. This can take a few minutes.");
      const result = await installCurseForgeModpack(link.projectId, link.fileId);
      toast("success", `${result.instance.name} is ready`, "Installed from a link.");
      return;
    }
    case "mod-modrinth": {
      emit("link:install-mod", { versionId: link.versionId });
      return;
    }
    case "join": {
      pendingInvite = link;
      emit("link:invite", {
        host: link.host,
        port: link.port,
        name: link.name,
        minecraftVersion: link.minecraftVersion,
        loader: link.loader,
        packVersionId: link.packVersionId
      });
      return;
    }
  }
}
async function acceptInvite(invite) {
  const address = `${invite.host}:${invite.port}`;
  const serverName = invite.name?.trim() || invite.host;
  const known = listServers().find(
    (server2) => server2.address.toLowerCase() === invite.host.toLowerCase() && server2.port === invite.port
  );
  if (!known) {
    saveServer({
      id: null,
      name: serverName.slice(0, 64),
      address: invite.host,
      port: invite.port,
      notedVersion: invite.minecraftVersion ?? null,
      description: "Added from an invite link"
    });
  }
  const instances = listInstances();
  if (invite.instanceId) {
    const chosen = instances.find((entry) => entry.id === invite.instanceId);
    if (chosen) {
      await launchInstance({ instanceId: chosen.id, serverAddress: address });
      return { instance: chosen, address };
    }
  }
  const loader = normaliseLoader(invite.loader);
  if (invite.packVersionId) {
    const existing = instances.find(
      (entry) => entry.minecraftVersion === invite.minecraftVersion && (!loader || entry.loader === loader)
    );
    if (!existing) {
      toast("info", "Setting up to join", "Installing the modpack this server runs. This can take a few minutes.");
      const result = await installModpackFromModrinth(invite.packVersionId, serverName);
      await launchInstance({ instanceId: result.instance.id, serverAddress: address });
      return { instance: result.instance, address };
    }
  }
  let instance = instances.find(
    (entry) => (!invite.minecraftVersion || entry.minecraftVersion === invite.minecraftVersion) && (!loader || entry.loader === loader)
  );
  if (!instance) {
    if (!invite.minecraftVersion) {
      throw new Error("This invite did not say which Minecraft version the server runs. Pick an instance to join with.");
    }
    instance = await createInstance({
      name: `${serverName} (client)`.slice(0, 64),
      minecraftVersion: invite.minecraftVersion,
      loader: loader ?? "vanilla"
    });
    toast("info", "Made a client for this server", `${instance.name} — matching ${invite.minecraftVersion}.`);
  }
  await launchInstance({ instanceId: instance.id, serverAddress: address });
  return { instance, address };
}
function normaliseLoader(value) {
  const lower = value?.toLowerCase();
  if (lower === "fabric" || lower === "forge" || lower === "neoforge" || lower === "quilt" || lower === "vanilla") {
    return lower;
  }
  return null;
}
const log$5 = createLogger("modpack-server");
function softwareForLoader(loader, packName) {
  switch (loader) {
    case "fabric":
      return "fabric";
    case "forge":
      return "forge";
    case "neoforge":
      return "neoforge";
    case "vanilla":
      return "vanilla";
    case "quilt":
      throw new LauncherError("INVALID_INPUT", `no Quilt server software for "${packName}"`, {
        title: "Quilt packs cannot be hosted yet",
        message: "This pack runs on Quilt, and the launcher can install Vanilla, Paper, Purpur, Fabric, Forge and NeoForge servers — not Quilt.",
        actions: [
          "Most Quilt packs also publish a Fabric version — look for that on the pack page",
          "You can still install this pack as a normal instance and play it single-player"
        ]
      });
    default:
      throw new LauncherError("INVALID_INPUT", `unknown loader ${loader}`);
  }
}
function firstFreePort() {
  const taken = new Set(listHostedServers().map((server2) => server2.port));
  for (let port = 25565; port < 25665; port++) {
    if (!taken.has(port)) return port;
  }
  throw new LauncherError("INVALID_INPUT", "every port from 25565 to 25664 is already used by one of your servers");
}
const CLIENT_ONLY_PREFIXES = [
  "resourcepacks/",
  "shaderpacks/",
  "saves/",
  "screenshots/",
  "logs/",
  "crash-reports/",
  "texturepacks/"
];
const CLIENT_ONLY_FILES = ["options.txt", "optionsof.txt", "servers.dat", "servers.dat_old", "usercache.json"];
function isClientOnlyOverride(relative) {
  const lower = relative.toLowerCase();
  if (CLIENT_ONLY_FILES.includes(lower)) return true;
  return CLIENT_ONLY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
async function applyOverrides(zip, dir, overridesDir) {
  let applied = 0;
  let skipped = 0;
  const prefixes = [`${overridesDir}/`, "server-overrides/"];
  for (const prefix of prefixes) {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.startsWith(prefix)) continue;
      const relative = entry.entryName.slice(prefix.length);
      if (!relative) continue;
      if (isClientOnlyOverride(relative)) {
        skipped++;
        continue;
      }
      const target = safeTarget(dir, relative);
      await promises.mkdir(node_path.dirname(target), { recursive: true });
      await promises.writeFile(target, entry.getData());
      applied++;
    }
  }
  return { applied, skipped };
}
async function disableClientOnlyMods(serverId) {
  const server2 = getHostedServer(serverId);
  const target = serverModTarget(server2);
  if (!node_fs.existsSync(target.dir)) return [];
  const mods = await analyseModsIn(target);
  const clientOnly = mods.filter((mod) => mod.environment === "client");
  for (const mod of clientOnly) {
    try {
      await setModEnabledIn(target.dir, mod.fileName, false);
    } catch (err) {
      log$5.warn(`could not disable client-only mod ${mod.fileName}: ${String(err)}`);
    }
  }
  if (clientOnly.length > 0) {
    log$5.info(`disabled ${clientOnly.length} client-only mod(s) for server ${server2.name}`);
  }
  return clientOnly.map((mod) => mod.name || mod.fileName);
}
function factsFromMrpack(index) {
  const { loader, version } = resolveLoader(index.dependencies);
  return {
    name: index.name || "Modpack server",
    minecraftVersion: index.dependencies.minecraft,
    loader,
    loaderVersion: version
  };
}
function factsFromCurseForge(manifest) {
  const { loader, version } = parseCfLoader(manifest.minecraft.modLoaders);
  return {
    name: manifest.name || "Modpack server",
    minecraftVersion: manifest.minecraft.version,
    loader,
    loaderVersion: version
  };
}
function createServerFor(facts, options) {
  const software = softwareForLoader(facts.loader, facts.name);
  const server2 = saveHostedServer({
    id: null,
    name: (options.name?.trim() || facts.name).slice(0, 64),
    minecraftVersion: facts.minecraftVersion,
    software,
    port: options.port ?? firstFreePort(),
    onlineMode: true,
    reachability: "network",
    // Modded servers are hungry. 4 GB is a working floor for a real pack where
    // vanilla's default would spend its first minute garbage-collecting.
    memoryMb: options.memoryMb ?? 4096,
    motd: facts.name.slice(0, 59),
    difficulty: "normal",
    gameMode: "survival",
    maxPlayers: 10,
    allowCheats: false,
    operators: []
  });
  return server2.id;
}
async function installPackAsServer(zip, options) {
  const cf = readCfManifest(zip);
  const index = cf ? null : readIndex$1(zip);
  const facts = cf ? factsFromCurseForge(cf) : factsFromMrpack(index);
  log$5.info(`installing "${facts.name}" as a server (${facts.minecraftVersion}, ${facts.loader})`);
  const serverId = createServerFor(facts, options);
  const dir = hostedServerDir(serverId);
  const skipped = [];
  try {
    await installHostedServer(serverId);
    const modsDir2 = node_path.join(dir, "mods");
    await promises.mkdir(modsDir2, { recursive: true });
    const items = cf ? await curseForgeItems(cf, dir, skipped) : mrpackItems(index, dir, skipped);
    const task = createTask({ label: `Installing ${facts.name}`, phase: "libraries" });
    task.setPhase("libraries", `Downloading ${items.length} server files`);
    task.add(items);
    await task.run();
    task.setPhase("verifying", "Unpacking pack configuration");
    const overridesDir = cf?.overrides ?? "overrides";
    const { applied, skipped: clientOverrides } = await applyOverrides(zip, dir, overridesDir);
    const clientOnly = await disableClientOnlyMods(serverId);
    task.setPhase("done", "Server ready");
    task.markDone();
    log$5.info(
      `"${facts.name}" installed as a server: ${items.length} files, ${applied} overrides, ${clientOverrides} client-only overrides skipped, ${clientOnly.length} client-only mods disabled`
    );
    return {
      server: getHostedServer(serverId),
      installedFiles: items.length,
      overrides: applied,
      skipped,
      clientOnlyMods: clientOnly,
      clientOverridesSkipped: clientOverrides
    };
  } catch (err) {
    await deleteHostedServer(serverId, true).catch(() => void 0);
    throw err;
  }
}
function mrpackItems(index, dir, skipped) {
  const items = [];
  for (const file2 of index.files ?? []) {
    if (file2.env?.server === "unsupported") continue;
    const url = (file2.downloads ?? []).find(isAllowedDownload);
    if (!url) {
      skipped.push(file2.path);
      log$5.warn(`skipping "${file2.path}": no download URL from an allowed host`);
      continue;
    }
    items.push({
      url,
      destination: safeTarget(dir, file2.path),
      sha1: file2.hashes?.sha1 ?? null,
      size: file2.fileSize ?? null,
      label: file2.path.split("/").pop() ?? file2.path
    });
  }
  return items;
}
async function curseForgeItems(manifest, dir, skipped) {
  const entries = manifest.files ?? [];
  const resolved = await getFiles(entries.map((file2) => file2.fileID));
  const byId = new Map(resolved.map((file2) => [file2.id, file2]));
  const items = [];
  for (const entry of entries) {
    const file2 = byId.get(entry.fileID);
    if (!file2) {
      skipped.push(`file ${entry.fileID}`);
      continue;
    }
    if (!file2.downloadUrl) {
      skipped.push(file2.fileName || `file ${entry.fileID}`);
      continue;
    }
    items.push({
      url: file2.downloadUrl,
      destination: safeTarget(dir, `mods/${file2.fileName}`),
      sha1: file2.hashes?.find((hash) => hash.algo === 1)?.value ?? null,
      size: file2.fileLength ?? null,
      label: file2.fileName
    });
  }
  return items;
}
async function installModpackAsServerFromFile(filePath, options = {}) {
  if (!node_fs.existsSync(filePath)) throw new LauncherError("NOT_FOUND", "that file no longer exists");
  return await installPackAsServer(new AdmZip(filePath), options);
}
async function installModpackAsServerFromModrinth(versionId, options = {}) {
  const version = await getJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    timeoutMs: 2e4,
    retries: 2
  });
  const file2 = version.files.find((f) => f.filename.endsWith(".mrpack")) ?? version.files.find((f) => f.primary);
  if (!file2 || !isAllowedDownload(file2.url)) {
    throw new LauncherError("INVALID_INPUT", "that version has no downloadable .mrpack file");
  }
  const workDir = node_path.join(node_os.tmpdir(), `nexuscraft-srvpack-${node_crypto.randomUUID()}`);
  await promises.mkdir(workDir, { recursive: true });
  const localPath = node_path.join(workDir, "pack.mrpack");
  try {
    await promises.writeFile(localPath, await getBuffer(file2.url, { timeoutMs: 3e5, retries: 2 }));
    return await installModpackAsServerFromFile(localPath, options);
  } finally {
    await promises.rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function installModpackAsServerFromCurseForge(projectId, fileId, options = {}) {
  const [file2] = await getFiles([Number(fileId)]);
  if (!file2?.downloadUrl) {
    throw new LauncherError("INVALID_INPUT", `modpack file ${fileId} cannot be downloaded`, {
      title: "This modpack must be downloaded manually",
      message: "Its author has turned off third-party downloads on CurseForge, so no launcher may fetch it automatically. Download the pack .zip from its CurseForge page, then host it from that file.",
      actions: [
        "Open the pack page on CurseForge and download the .zip",
        "Return here and use Host a server -> From a modpack file",
        "Modrinth packs carry no such restriction"
      ]
    });
  }
  const workDir = node_path.join(node_os.tmpdir(), `nexuscraft-srvpack-${node_crypto.randomUUID()}`);
  await promises.mkdir(workDir, { recursive: true });
  const localPath = node_path.join(workDir, "pack.zip");
  try {
    await promises.writeFile(localPath, await getBuffer(file2.downloadUrl, { timeoutMs: 3e5, retries: 2 }));
    return await installModpackAsServerFromFile(localPath, options);
  } finally {
    await promises.rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }
}
const PALETTE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+/:;<=>?@^_~[]{}()|";
const MAX_BLOCKS = 6e4;
const MAX_EDGE = 128;
function plainBlockName(id2) {
  return id2.replace(/^minecraft:/, "").replace(/\[.*$/, "").trim();
}
function readVarIntArray(data, expected) {
  const out = [];
  let index = 0;
  while (index < data.length && out.length < expected) {
    let value = 0;
    let shift = 0;
    for (; ; ) {
      if (index >= data.length) return out;
      const byte = data[index++] & 255;
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) break;
      shift += 7;
      if (shift > 35) return out;
    }
    out.push(value);
  }
  return out;
}
function num$1(value) {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return Number(value[0]) || 0;
  if (value && typeof value === "object" && "value" in value) return Number(value.value) || 0;
  return Number(value) || 0;
}
function toBlueprint(name, width, height, length, blockAt) {
  const counts = /* @__PURE__ */ new Map();
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < length; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const block = blockAt(x, y, z);
        if (!block || block === "air" || block === "cave_air" || block === "void_air") continue;
        counts.set(block, (counts.get(block) ?? 0) + 1);
      }
    }
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const notes = [];
  const kept = ordered.slice(0, PALETTE_CHARS.length);
  if (ordered.length > PALETTE_CHARS.length) {
    const dropped = ordered.slice(PALETTE_CHARS.length);
    notes.push(
      `${dropped.length} rare block type${dropped.length === 1 ? "" : "s"} were left out — the format holds ${PALETTE_CHARS.length} at once`
    );
  }
  const charFor = /* @__PURE__ */ new Map();
  const palette = {};
  kept.forEach(([block], index) => {
    const character = PALETTE_CHARS[index];
    charFor.set(block, character);
    palette[character] = block;
  });
  const layers = [];
  for (let y = 0; y < height; y += 1) {
    const rows = [];
    for (let z = 0; z < length; z += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        const block = blockAt(x, y, z);
        row += block && charFor.get(block) || ".";
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  const blockCount = kept.reduce((total, [, count]) => total + count, 0);
  return {
    blueprint: { name, palette, layers, description: `Imported schematic, ${width}x${height}x${length}` },
    info: {
      name,
      width,
      height,
      length,
      blockCount,
      materials: kept.slice(0, 24).map(([block, count]) => ({ block, count })),
      notes
    }
  };
}
async function loadSchematic(filePath, displayName) {
  const buffer = await promises.readFile(filePath);
  const nbt = require("prismarine-nbt");
  const { parsed } = await nbt.parse(buffer);
  const root = nbt.simplify(parsed);
  const schematic = root.Schematic ?? root;
  const width = num$1(schematic.Width);
  const height = num$1(schematic.Height);
  const length = num$1(schematic.Length);
  if (!width || !height || !length) {
    if (schematic.Blocks && schematic.Data && !schematic.Palette) {
      throw new Error(
        "that is a legacy MCEdit .schematic, which stores numeric block ids from before 1.13. Open it in WorldEdit or Amulet and save it as a .schem first."
      );
    }
    throw new Error("that file does not look like a schematic — no width, height or length in it");
  }
  if (width > MAX_EDGE || height > MAX_EDGE || length > MAX_EDGE) {
    throw new Error(`that schematic is ${width}x${height}x${length}; the limit is ${MAX_EDGE} blocks along any edge`);
  }
  if (width * height * length > MAX_BLOCKS * 4) {
    throw new Error(`that schematic has ${width * height * length} block positions, which is too many to build`);
  }
  const blocks = schematic.Blocks ?? schematic;
  const rawPalette = blocks.Palette ?? schematic.Palette;
  const rawData = blocks.Data ?? blocks.BlockData ?? schematic.BlockData;
  if (!rawPalette || !rawData) {
    throw new Error("that schematic has no block palette — it may be a Litematica file, which is a different format");
  }
  const byIndex = /* @__PURE__ */ new Map();
  for (const [id2, index] of Object.entries(rawPalette)) {
    byIndex.set(num$1(index), plainBlockName(id2));
  }
  const indices = readVarIntArray(rawData, width * height * length);
  const blockAt = (x, y, z) => {
    const position = (y * length + z) * width + x;
    const index = indices[position];
    if (index === void 0) return null;
    return byIndex.get(index) ?? null;
  };
  const name = (displayName ?? String(schematic.Metadata?.Name ?? "Imported structure")).slice(0, 60);
  const { blueprint, info } = toBlueprint(name, width, height, length, blockAt);
  if (info.blockCount === 0) throw new Error("that schematic is empty — every position in it is air");
  if (info.blockCount > MAX_BLOCKS) {
    throw new Error(`that schematic needs ${info.blockCount} blocks placed; the limit is ${MAX_BLOCKS}`);
  }
  return { blueprint, info };
}
const FALLBACK_DATA_VERSION = 3955;
function dataVersionFor(minecraftVersion) {
  if (!minecraftVersion) return FALLBACK_DATA_VERSION;
  try {
    const mcd = require("minecraft-data");
    const found = mcd.versions.pc.find(
      (entry) => entry.minecraftVersion === minecraftVersion
    );
    return found?.dataVersion ?? FALLBACK_DATA_VERSION;
  } catch {
    return FALLBACK_DATA_VERSION;
  }
}
function toVarInts(values) {
  const out = [];
  for (const value of values) {
    let remaining = value >>> 0;
    do {
      let byte = remaining & 127;
      remaining >>>= 7;
      if (remaining !== 0) byte |= 128;
      out.push(byte);
    } while (remaining !== 0);
  }
  return out;
}
function indexBlueprint(blueprint) {
  const { width, height, depth } = hostResolve.blueprintSize(blueprint);
  const names = ["minecraft:air"];
  const indexFor = /* @__PURE__ */ new Map([["minecraft:air", 0]]);
  const grid = new Int32Array(width * height * depth);
  for (const block of hostResolve.blueprintBlocks(blueprint)) {
    const id2 = `minecraft:${block.id}`;
    let index = indexFor.get(id2);
    if (index === void 0) {
      index = names.length;
      names.push(id2);
      indexFor.set(id2, index);
    }
    grid[(block.dy * depth + block.dz) * width + block.dx] = index;
  }
  return {
    width,
    height,
    depth,
    names,
    at: (x, y, z) => grid[(y * depth + z) * width + x]
  };
}
function toSpongeSchematic(blueprint, dataVersion = FALLBACK_DATA_VERSION) {
  const nbt = require("prismarine-nbt");
  const { width, height, depth, names, at } = indexBlueprint(blueprint);
  const data = [];
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) data.push(at(x, y, z));
    }
  }
  const palette = {};
  names.forEach((name, index) => {
    palette[name] = nbt.int(index);
  });
  const tag = nbt.comp({
    Version: nbt.int(2),
    DataVersion: nbt.int(dataVersion),
    Width: nbt.short(width),
    Height: nbt.short(height),
    Length: nbt.short(depth),
    PaletteMax: nbt.int(names.length),
    Palette: nbt.comp(palette),
    BlockData: nbt.byteArray(toVarInts(data)),
    Metadata: nbt.comp({ Name: nbt.string(blueprint.name) })
  });
  return node_zlib.gzipSync(nbt.writeUncompressed({ ...tag, name: "Schematic" }));
}
function toVanillaStructure(blueprint, dataVersion = FALLBACK_DATA_VERSION) {
  const nbt = require("prismarine-nbt");
  const { width, height, depth, names, at } = indexBlueprint(blueprint);
  const palette = names.slice(1).map((name) => {
    const properties = hostResolve.blockState(name);
    const entry = { Name: nbt.string(`minecraft:${hostResolve.baseBlockName(name)}`) };
    if (Object.keys(properties).length > 0) {
      entry.Properties = nbt.comp(
        Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, nbt.string(value)]))
      );
    }
    return entry;
  });
  const blocks = [];
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = at(x, y, z);
        if (index === 0) continue;
        blocks.push({
          pos: nbt.list(nbt.int([x, y, z])),
          state: nbt.int(index - 1)
        });
      }
    }
  }
  const tag = nbt.comp({
    DataVersion: nbt.int(dataVersion),
    size: nbt.list(nbt.int([width, height, depth])),
    palette: nbt.list(nbt.comp(palette)),
    blocks: nbt.list(nbt.comp(blocks)),
    entities: nbt.list(nbt.comp([]))
  });
  return node_zlib.gzipSync(nbt.writeUncompressed({ ...tag, name: "" }));
}
function safeFileName(name) {
  const cleaned = name.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_").slice(0, 48);
  return cleaned || "structure";
}
async function exportBlueprint(blueprint, targetPath, format, minecraftVersion) {
  const version = dataVersionFor(minecraftVersion);
  const data = format === "schem" ? toSpongeSchematic(blueprint, version) : toVanillaStructure(blueprint, version);
  await promises.mkdir(node_path.dirname(targetPath), { recursive: true });
  await promises.writeFile(targetPath, data);
  return { path: targetPath, format, bytes: data.length };
}
function schematicsDir(gameDir) {
  return node_path.join(gameDir, "schematics");
}
function structuresDir(worldDir) {
  return node_path.join(worldDir, "generated", "minecraft", "structures");
}
async function serverWorldName(serverDir) {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(node_path.join(serverDir, "server.properties"), "utf8");
    const match = /^level-name\s*=\s*(.+)$/m.exec(text);
    const name = match?.[1]?.trim();
    const unsafe = !name || name.includes("..") || /[/\\]/.test(name);
    return unsafe ? "world" : name;
  } catch {
    return "world";
  }
}
function bool(options, key, fallback = false) {
  const value = options[key];
  return typeof value === "boolean" ? value : fallback;
}
function num(options, key, fallback) {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function str(options, key, fallback) {
  const value = options[key];
  return typeof value === "string" && value ? value : fallback;
}
const HOSTILES = [
  "zombie",
  "husk",
  "drowned",
  "zombie_villager",
  "skeleton",
  "stray",
  "wither_skeleton",
  "creeper",
  "spider",
  "cave_spider",
  "enderman",
  "endermite",
  "silverfish",
  "witch",
  "slime",
  "magma_cube",
  "blaze",
  "ghast",
  "phantom",
  "pillager",
  "vindicator",
  "evoker",
  "ravager",
  "vex",
  "piglin_brute",
  "hoglin",
  "zoglin",
  "guardian",
  "elder_guardian",
  "shulker",
  "warden",
  "breeze",
  "bogged"
];
const PACKS = [
  /* ============================================================ originals */
  {
    id: "quality-of-life",
    name: "Quality of Life",
    tagline: "The world rules most people change anyway, in one pack.",
    description: "Applies a set of game rules as soon as the world loads. Each one is optional, so you can take only the parts you want.",
    icon: "settings",
    category: "Essentials",
    options: [
      { key: "keepInventory", label: "Keep inventory on death", type: "boolean", default: true },
      { key: "sleepPercent", label: "Players needed to skip night (%)", type: "number", default: 50, min: 1, max: 100 },
      { key: "noMobGriefing", label: "Stop creepers and endermen wrecking the place", type: "boolean", default: false },
      { key: "noFireSpread", label: "Stop fire spreading", type: "boolean", default: false },
      { key: "alwaysDay", label: "Lock time to day", type: "boolean", default: false },
      { key: "clearWeather", label: "Lock weather to clear", type: "boolean", default: false }
    ],
    build: ({ options }) => {
      const load = [];
      if (bool(options, "keepInventory", true)) load.push("gamerule keepInventory true");
      load.push(`gamerule playersSleepingPercentage ${Math.round(num(options, "sleepPercent", 50))}`);
      if (bool(options, "noMobGriefing")) load.push("gamerule mobGriefing false");
      if (bool(options, "noFireSpread")) load.push("gamerule doFireTick false");
      if (bool(options, "alwaysDay")) load.push("gamerule doDaylightCycle false", "time set day");
      if (bool(options, "clearWeather")) load.push("gamerule doWeatherCycle false", "weather clear");
      return { functions: { load } };
    }
  },
  {
    id: "coordinates-hud",
    name: "Coordinates HUD",
    tagline: "Your position, always on screen, without pressing F3.",
    description: "Shows your X, Y and Z in the action bar above the hotbar. Reads the position off each player every tick and writes it to a scoreboard.",
    icon: "compass",
    category: "Essentials",
    options: [],
    build: ({ ns }) => ({
      functions: {
        load: [
          "scoreboard objectives add nc_x dummy",
          "scoreboard objectives add nc_y dummy",
          "scoreboard objectives add nc_z dummy"
        ],
        tick: [
          "execute as @a store result score @s nc_x run data get entity @s Pos[0]",
          "execute as @a store result score @s nc_y run data get entity @s Pos[1]",
          "execute as @a store result score @s nc_z run data get entity @s Pos[2]",
          'execute as @a run title @s actionbar ["",{"text":"X ","color":"gray"},{"score":{"name":"@s","objective":"nc_x"},"color":"white"},{"text":"  Y ","color":"gray"},{"score":{"name":"@s","objective":"nc_y"},"color":"white"},{"text":"  Z ","color":"gray"},{"score":{"name":"@s","objective":"nc_z"},"color":"white"}]'
        ]
      }
    })
  },
  {
    id: "cave-sense",
    name: "Cave Sense",
    tagline: "Night vision kicks in when you go deep.",
    description: "Grants night vision automatically below a chosen depth and removes it when you climb back up. Handy for caving without burning through torches.",
    icon: "eye",
    category: "Essentials",
    options: [
      { key: "depth", label: "Apply below Y", type: "number", default: 0, min: -64, max: 320 },
      { key: "announce", label: "Say when it turns on", type: "boolean", default: false }
    ],
    build: ({ options }) => {
      const depth = Math.round(num(options, "depth", 0));
      const tick = [
        "execute as @a store result score @s nc_depth run data get entity @s Pos[1]",
        `execute as @a[scores={nc_depth=..${depth}}] run effect give @s minecraft:night_vision 12 0 true`,
        `execute as @a[scores={nc_depth=${depth + 1}..}] run effect clear @s minecraft:night_vision`
      ];
      if (bool(options, "announce")) {
        tick.push(
          `execute as @a[scores={nc_depth=..${depth}}] run title @s actionbar {"text":"Cave sense active","color":"aqua"}`
        );
      }
      return { functions: { load: ["scoreboard objectives add nc_depth dummy"], tick } };
    }
  },
  {
    id: "explorers-kit",
    name: "Explorer's Kit",
    tagline: "Start with the basics instead of punching trees.",
    description: "Gives each player a small kit the first time they are in the world. Uses an advancement so it fires exactly once per player.",
    icon: "package",
    category: "Essentials",
    options: [
      {
        key: "tier",
        label: "Kit",
        type: "select",
        default: "stone",
        choices: [
          { value: "wood", label: "Modest — wooden tools and bread" },
          { value: "stone", label: "Standard — stone tools, torches, food" },
          { value: "iron", label: "Generous — iron tools and armour" }
        ]
      },
      { key: "compass", label: "Include a compass and a map", type: "boolean", default: true }
    ],
    build: ({ options, ns }) => {
      const kits = {
        wood: ["wooden_sword", "wooden_pickaxe", "wooden_axe"].map((i) => `give @s minecraft:${i}`).concat("give @s minecraft:bread 8"),
        stone: ["stone_sword", "stone_pickaxe", "stone_axe", "stone_shovel"].map((i) => `give @s minecraft:${i}`).concat("give @s minecraft:torch 32", "give @s minecraft:cooked_beef 16"),
        iron: ["iron_sword", "iron_pickaxe", "iron_axe", "iron_shovel", "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"].map((i) => `give @s minecraft:${i}`).concat("give @s minecraft:torch 64", "give @s minecraft:cooked_beef 32")
      };
      const lines = [...kits[str(options, "tier", "stone")] ?? kits.stone];
      if (bool(options, "compass", true)) lines.push("give @s minecraft:compass", "give @s minecraft:map");
      lines.push('tellraw @s [{"text":"[NexusCraft] ","color":"aqua"},{"text":"Here is your kit. Good luck.","color":"gray"}]');
      return {
        functions: { kit: lines },
        json: [
          {
            kind: "advancement",
            name: "kit",
            data: { criteria: { joined: { trigger: "minecraft:tick" } }, rewards: { function: `${ns}:kit` } }
          }
        ]
      };
    }
  },
  {
    id: "scoreboard-suite",
    name: "Scoreboard Suite",
    tagline: "Health under names, kills on the sidebar.",
    description: "Turns on Minecraft's built-in scoreboard displays: hearts beneath every player name, and a running kill count in the sidebar.",
    icon: "trophy",
    category: "Essentials",
    options: [
      { key: "health", label: "Show health under player names", type: "boolean", default: true },
      { key: "kills", label: "Show a kill counter on the sidebar", type: "boolean", default: true },
      { key: "deaths", label: "Track deaths in the tab list", type: "boolean", default: false }
    ],
    build: ({ options }) => {
      const load = [];
      if (bool(options, "health", true)) {
        load.push(
          "scoreboard objectives add nc_health health",
          'scoreboard objectives modify nc_health displayname "Health"',
          "scoreboard objectives setdisplay below_name nc_health"
        );
      }
      if (bool(options, "kills", true)) {
        load.push(
          "scoreboard objectives add nc_kills totalKillCount",
          'scoreboard objectives modify nc_kills displayname "Kills"',
          "scoreboard objectives setdisplay sidebar nc_kills"
        );
      }
      if (bool(options, "deaths")) {
        load.push("scoreboard objectives add nc_deaths deathCount", "scoreboard objectives setdisplay list nc_deaths");
      }
      return { functions: { load } };
    }
  },
  /* ==================================================== survival essentials */
  {
    id: "death-waypoint",
    name: "Death Waypoint",
    tagline: "Never lose your stuff to a forgotten cave again.",
    description: "Records exactly where you died and tells you the coordinates. Run /trigger deathpoint at any time to hear them again.",
    icon: "skull",
    category: "Survival",
    options: [{ key: "announce", label: "Announce deaths to everyone", type: "boolean", default: false }],
    build: ({ options, ns }) => ({
      functions: {
        load: [
          "scoreboard objectives add nc_died deathCount",
          "scoreboard objectives add nc_dp trigger",
          "scoreboard objectives add nc_dx dummy",
          "scoreboard objectives add nc_dy dummy",
          "scoreboard objectives add nc_dz dummy"
        ],
        tick: [
          "scoreboard players enable @a nc_dp",
          // A player stays at the place they died until they respawn, so the
          // next tick still has the right position.
          `execute as @a[scores={nc_died=1..}] at @s run function ${ns}:record`,
          `execute as @a[scores={nc_dp=1..}] run function ${ns}:show`
        ],
        record: [
          "execute store result score @s nc_dx run data get entity @s Pos[0]",
          "execute store result score @s nc_dy run data get entity @s Pos[1]",
          "execute store result score @s nc_dz run data get entity @s Pos[2]",
          "scoreboard players set @s nc_died 0",
          ...bool(options, "announce") ? ['tellraw @a [{"selector":"@s","color":"yellow"},{"text":" died at ","color":"gray"},{"score":{"name":"@s","objective":"nc_dx"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dy"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dz"},"color":"white"}]'] : [],
          'tellraw @s [{"text":"[Waypoint] ","color":"red"},{"text":"You died at ","color":"gray"},{"score":{"name":"@s","objective":"nc_dx"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dy"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dz"},"color":"white"},{"text":"  (/trigger deathpoint)","color":"dark_gray"}]'
        ],
        show: [
          "scoreboard players set @s nc_dp 0",
          'tellraw @s [{"text":"[Waypoint] ","color":"red"},{"text":"Last death: ","color":"gray"},{"score":{"name":"@s","objective":"nc_dx"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dy"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dz"},"color":"white"}]'
        ]
      }
    })
  },
  {
    id: "home-waypoints",
    name: "Home & Waypoints",
    tagline: "Set a home, then get back to it from anywhere.",
    description: "Adds /trigger sethome and /trigger home. Your home is stored per player and the teleport is done with a macro function, so it works across dimensions in the overworld.",
    icon: "house",
    category: "Survival",
    // Macro functions ($ arguments) arrived with data pack format 18 (1.20.2).
    minPackFormat: 18,
    options: [{ key: "cooldown", label: "Cooldown between teleports (seconds)", type: "number", default: 10, min: 0, max: 600 }],
    build: ({ options, ns }) => {
      const cooldown = Math.round(num(options, "cooldown", 10)) * 20;
      return {
        functions: {
          load: [
            "scoreboard objectives add nc_sethome trigger",
            "scoreboard objectives add nc_home trigger",
            "scoreboard objectives add nc_hx dummy",
            "scoreboard objectives add nc_hy dummy",
            "scoreboard objectives add nc_hz dummy",
            "scoreboard objectives add nc_hset dummy",
            "scoreboard objectives add nc_cool dummy"
          ],
          tick: [
            "scoreboard players enable @a nc_sethome",
            "scoreboard players enable @a nc_home",
            "execute as @a[scores={nc_cool=1..}] run scoreboard players remove @s nc_cool 1",
            `execute as @a[scores={nc_sethome=1..}] at @s run function ${ns}:set_home`,
            `execute as @a[scores={nc_home=1..}] at @s run function ${ns}:go_home`
          ],
          set_home: [
            "scoreboard players set @s nc_sethome 0",
            "execute store result score @s nc_hx run data get entity @s Pos[0]",
            "execute store result score @s nc_hy run data get entity @s Pos[1]",
            "execute store result score @s nc_hz run data get entity @s Pos[2]",
            "scoreboard players set @s nc_hset 1",
            'tellraw @s [{"text":"[Home] ","color":"green"},{"text":"Home set here.","color":"gray"}]'
          ],
          go_home: [
            "scoreboard players set @s nc_home 0",
            'execute if score @s nc_hset matches 0 run tellraw @s [{"text":"[Home] ","color":"red"},{"text":"No home set yet — use /trigger sethome.","color":"gray"}]',
            `execute if score @s nc_cool matches 1.. run tellraw @s [{"text":"[Home] ","color":"red"},{"text":"Still on cooldown.","color":"gray"}]`,
            `execute if score @s nc_hset matches 1 if score @s nc_cool matches ..0 run function ${ns}:teleport`
          ],
          teleport: [
            // Scores are copied into storage so a macro can read them.
            "execute store result storage nexuscraft:home x int 1 run scoreboard players get @s nc_hx",
            "execute store result storage nexuscraft:home y int 1 run scoreboard players get @s nc_hy",
            "execute store result storage nexuscraft:home z int 1 run scoreboard players get @s nc_hz",
            `function ${ns}:do_teleport with storage nexuscraft:home`,
            ...cooldown > 0 ? [`scoreboard players set @s nc_cool ${cooldown}`] : [],
            'tellraw @s [{"text":"[Home] ","color":"green"},{"text":"Welcome back.","color":"gray"}]'
          ],
          do_teleport: ["$tp @s $(x) $(y) $(z)"]
        }
      };
    }
  },
  {
    id: "random-teleport",
    name: "Random Teleport",
    tagline: "Drop yourself somewhere completely new.",
    description: "Adds /trigger rtp, which scatters you to a random safe spot within a radius you choose. Uses vanilla spreadplayers, so it always lands you on solid ground.",
    icon: "shuffle",
    category: "Survival",
    options: [
      { key: "range", label: "Maximum distance from spawn", type: "number", default: 5e3, min: 200, max: 1e5 },
      { key: "cooldown", label: "Cooldown (seconds)", type: "number", default: 60, min: 0, max: 3600 }
    ],
    build: ({ options, ns }) => {
      const range = Math.round(num(options, "range", 5e3));
      const cooldown = Math.round(num(options, "cooldown", 60)) * 20;
      return {
        functions: {
          load: ["scoreboard objectives add nc_rtp trigger", "scoreboard objectives add nc_rtpcd dummy"],
          tick: [
            "scoreboard players enable @a nc_rtp",
            "execute as @a[scores={nc_rtpcd=1..}] run scoreboard players remove @s nc_rtpcd 1",
            `execute as @a[scores={nc_rtp=1..}] at @s run function ${ns}:go`
          ],
          go: [
            "scoreboard players set @s nc_rtp 0",
            'execute if score @s nc_rtpcd matches 1.. run tellraw @s [{"text":"[RTP] ","color":"red"},{"text":"Still on cooldown.","color":"gray"}]',
            `execute if score @s nc_rtpcd matches ..0 run spreadplayers 0 0 200 ${range} false @s`,
            ...cooldown > 0 ? [`execute if score @s nc_rtpcd matches ..0 run scoreboard players set @s nc_rtpcd ${cooldown}`] : [],
            'execute if score @s nc_rtpcd matches 1.. run tellraw @s [{"text":"[RTP] ","color":"aqua"},{"text":"Off you go.","color":"gray"}]'
          ]
        }
      };
    }
  },
  {
    id: "void-rescue",
    name: "Void Rescue",
    tagline: "Catches you before the void does.",
    description: "If you fall below the world, you are pulled back to a safe height with slow falling instead of dying. Useful in the End, or after a bad ladder.",
    icon: "lifebuoy",
    category: "Survival",
    options: [
      { key: "catchY", label: "Catch below Y", type: "number", default: -70, min: -200, max: 0 },
      { key: "rescueY", label: "Return to Y", type: "number", default: 90, min: 0, max: 320 }
    ],
    build: ({ options, ns }) => {
      const catchY = Math.round(num(options, "catchY", -70));
      const rescueY = Math.round(num(options, "rescueY", 90));
      return {
        functions: {
          load: ["scoreboard objectives add nc_void dummy"],
          tick: [
            "execute as @a store result score @s nc_void run data get entity @s Pos[1]",
            `execute as @a[scores={nc_void=..${catchY}}] at @s run function ${ns}:rescue`
          ],
          rescue: [
            `tp @s ~ ${rescueY} ~`,
            "effect give @s minecraft:slow_falling 15 0 true",
            "effect give @s minecraft:resistance 10 4 true",
            'tellraw @s [{"text":"[Rescue] ","color":"aqua"},{"text":"Caught you.","color":"gray"}]'
          ]
        }
      };
    }
  },
  {
    id: "nether-calculator",
    name: "Nether Calculator",
    tagline: "The matching Nether coordinates, worked out for you.",
    description: "Shows the Nether equivalent of your current position in the action bar — your coordinates divided by eight — so linking portals stops being mental arithmetic.",
    icon: "calculator",
    category: "Survival",
    options: [],
    build: () => ({
      functions: {
        load: [
          "scoreboard objectives add nc_nx dummy",
          "scoreboard objectives add nc_nz dummy",
          "scoreboard objectives add nc_const dummy",
          "scoreboard players set #eight nc_const 8"
        ],
        tick: [
          "execute as @a store result score @s nc_nx run data get entity @s Pos[0]",
          "execute as @a store result score @s nc_nz run data get entity @s Pos[2]",
          "execute as @a run scoreboard players operation @s nc_nx /= #eight nc_const",
          "execute as @a run scoreboard players operation @s nc_nz /= #eight nc_const",
          'execute as @a run title @s actionbar ["",{"text":"Nether ","color":"red"},{"score":{"name":"@s","objective":"nc_nx"},"color":"white"},{"text":" / ","color":"gray"},{"score":{"name":"@s","objective":"nc_nz"},"color":"white"}]'
        ]
      }
    })
  },
  /* ============================================================ toys */
  {
    id: "elevator-blocks",
    name: "Elevator Blocks",
    tagline: "Jump on a block to ride up to the next one.",
    description: "Stack a chosen block at different heights and jump while standing on one to be lifted to the next above it. Searches up to 64 blocks upward.",
    icon: "arrow-up",
    category: "Toys",
    options: [
      {
        key: "block",
        label: "Elevator block",
        type: "select",
        default: "minecraft:gold_block",
        choices: [
          { value: "minecraft:gold_block", label: "Gold block" },
          { value: "minecraft:diamond_block", label: "Diamond block" },
          { value: "minecraft:emerald_block", label: "Emerald block" },
          { value: "minecraft:iron_block", label: "Iron block" },
          { value: "minecraft:lapis_block", label: "Lapis block" }
        ]
      }
    ],
    build: ({ options, ns }) => {
      const block = str(options, "block", "minecraft:gold_block");
      return {
        functions: {
          load: [
            // The jump statistic increments once per jump, which is the
            // cleanest way vanilla exposes "the player jumped".
            "scoreboard objectives add nc_jump minecraft.custom:minecraft.jump",
            "scoreboard objectives add nc_scan dummy"
          ],
          tick: [
            `execute as @a[scores={nc_jump=1..}] at @s if block ~ ~-1 ~ ${block} run function ${ns}:ascend`,
            "scoreboard players set @a nc_jump 0"
          ],
          ascend: ["scoreboard players set @s nc_scan 0", `function ${ns}:scan`],
          scan: [
            "scoreboard players add @s nc_scan 1",
            `execute if block ~ ~1 ~ ${block} run tp @s ~ ~2 ~`,
            `execute if block ~ ~1 ~ ${block} run playsound minecraft:entity.enderman.teleport master @s ~ ~ ~ 0.4 1.6`,
            // Step upward one block at a time until a landing is found or the
            // search runs out, carrying the position into the next call.
            `execute unless block ~ ~1 ~ ${block} if score @s nc_scan matches ..64 positioned ~ ~1 ~ run function ${ns}:scan`
          ]
        }
      };
    }
  },
  {
    id: "mob-radar",
    name: "Mob Radar",
    tagline: "Hostiles glow through the walls when they get close.",
    description: "Nearby hostile mobs are outlined so you can see them coming. Set the range, and optionally only switch it on underground.",
    icon: "radar",
    category: "Toys",
    options: [
      { key: "range", label: "Detection range (blocks)", type: "number", default: 24, min: 4, max: 64 },
      { key: "undergroundOnly", label: "Only underground", type: "boolean", default: false },
      { key: "depth", label: "Underground means below Y", type: "number", default: 50, min: -64, max: 320 }
    ],
    build: ({ options, ns }) => {
      const range = Math.round(num(options, "range", 24));
      const undergroundOnly = bool(options, "undergroundOnly");
      const depth = Math.round(num(options, "depth", 50));
      const glow = HOSTILES.map(
        (type) => `execute at @s run effect give @e[type=minecraft:${type},distance=..${range}] minecraft:glowing 2 0 true`
      );
      return {
        functions: {
          load: ["scoreboard objectives add nc_ry dummy"],
          tick: undergroundOnly ? [
            "execute as @a store result score @s nc_ry run data get entity @s Pos[1]",
            `execute as @a[scores={nc_ry=..${depth}}] run function ${ns}:sweep`
          ] : [`execute as @a run function ${ns}:sweep`],
          sweep: glow
        }
      };
    }
  },
  {
    id: "speedrun-timer",
    name: "Speedrun Timer",
    tagline: "A clock in the action bar, with start and stop.",
    description: "Adds /trigger timer_start, /trigger timer_stop and /trigger timer_reset. Counts in real time and shows minutes and seconds to everyone.",
    icon: "timer",
    category: "Toys",
    options: [{ key: "autostart", label: "Start automatically when the world loads", type: "boolean", default: false }],
    build: ({ options, ns }) => ({
      functions: {
        load: [
          "scoreboard objectives add nc_t dummy",
          "scoreboard objectives add nc_trun dummy",
          "scoreboard objectives add nc_tc dummy",
          "scoreboard objectives add timer_start trigger",
          "scoreboard objectives add timer_stop trigger",
          "scoreboard objectives add timer_reset trigger",
          "scoreboard players set #sixty nc_tc 60",
          "scoreboard players set #twenty nc_tc 20",
          ...bool(options, "autostart") ? ["scoreboard players set #run nc_trun 1"] : ["scoreboard players set #run nc_trun 0"]
        ],
        tick: [
          "scoreboard players enable @a timer_start",
          "scoreboard players enable @a timer_stop",
          "scoreboard players enable @a timer_reset",
          "execute as @a[scores={timer_start=1..}] run function " + ns + ":start",
          "execute as @a[scores={timer_stop=1..}] run function " + ns + ":stop",
          "execute as @a[scores={timer_reset=1..}] run function " + ns + ":reset",
          "execute if score #run nc_trun matches 1 run scoreboard players add #ticks nc_t 1",
          `execute if score #run nc_trun matches 1 run function ${ns}:display`
        ],
        start: [
          "scoreboard players set @s timer_start 0",
          "scoreboard players set #run nc_trun 1",
          'tellraw @a [{"text":"[Timer] ","color":"green"},{"text":"Started.","color":"gray"}]'
        ],
        stop: [
          "scoreboard players set @s timer_stop 0",
          "scoreboard players set #run nc_trun 0",
          'tellraw @a [{"text":"[Timer] ","color":"yellow"},{"text":"Stopped.","color":"gray"}]'
        ],
        reset: [
          "scoreboard players set @s timer_reset 0",
          "scoreboard players set #ticks nc_t 0",
          'tellraw @a [{"text":"[Timer] ","color":"aqua"},{"text":"Reset.","color":"gray"}]'
        ],
        display: [
          // ticks -> seconds -> minutes and remainder
          "scoreboard players operation #sec nc_t = #ticks nc_t",
          "scoreboard players operation #sec nc_t /= #twenty nc_tc",
          "scoreboard players operation #min nc_t = #sec nc_t",
          "scoreboard players operation #min nc_t /= #sixty nc_tc",
          "scoreboard players operation #rem nc_t = #sec nc_t",
          "scoreboard players operation #rem nc_t %= #sixty nc_tc",
          'title @a actionbar ["",{"text":"⏱ ","color":"gold"},{"score":{"name":"#min","objective":"nc_t"},"color":"white"},{"text":"m ","color":"gray"},{"score":{"name":"#rem","objective":"nc_t"},"color":"white"},{"text":"s","color":"gray"}]'
        ]
      }
    })
  },
  {
    id: "stats-sidebar",
    name: "Stats Sidebar",
    tagline: "Your own statistics, pulled straight from the game.",
    description: "Puts one of Minecraft's own tracked statistics on the sidebar — playtime, mob kills, distance walked or jumps — and keeps it updated.",
    icon: "bar-chart",
    category: "Toys",
    options: [
      {
        key: "stat",
        label: "Show on the sidebar",
        type: "select",
        default: "mob_kills",
        choices: [
          { value: "mob_kills", label: "Mob kills" },
          { value: "play_time", label: "Playtime (minutes)" },
          { value: "walk_one_cm", label: "Distance walked (metres)" },
          { value: "jump", label: "Jumps" },
          { value: "damage_dealt", label: "Damage dealt" }
        ]
      }
    ],
    build: ({ options, ns }) => {
      const stat = str(options, "stat", "mob_kills");
      const scaled = stat === "play_time" ? 1200 : stat === "walk_one_cm" ? 100 : 1;
      const labels = {
        mob_kills: "Mob kills",
        play_time: "Minutes played",
        walk_one_cm: "Metres walked",
        jump: "Jumps",
        damage_dealt: "Damage dealt"
      };
      const load = [
        `scoreboard objectives add nc_raw minecraft.custom:minecraft.${stat}`,
        "scoreboard objectives add nc_stat dummy",
        "scoreboard objectives add nc_sc dummy",
        `scoreboard objectives modify nc_stat displayname "${labels[stat] ?? "Stat"}"`,
        "scoreboard objectives setdisplay sidebar nc_stat",
        `scoreboard players set #scale nc_sc ${scaled}`
      ];
      const tick = scaled === 1 ? ["execute as @a run scoreboard players operation @s nc_stat = @s nc_raw"] : [
        "execute as @a run scoreboard players operation @s nc_stat = @s nc_raw",
        "execute as @a run scoreboard players operation @s nc_stat /= #scale nc_sc"
      ];
      return { functions: { load, tick } };
    }
  },
  /* ================================================== loot and crafting */
  {
    id: "craft-the-uncraftables",
    name: "Craft the Uncraftables",
    tagline: "Recipes for the things vanilla never lets you make.",
    description: "Adds crafting recipes for saddles, name tags, horse armour and other items you can normally only find. Balanced to be expensive rather than free.",
    icon: "hammer",
    category: "Crafting",
    options: [
      { key: "saddle", label: "Saddle", type: "boolean", default: true },
      { key: "nameTag", label: "Name tag", type: "boolean", default: true },
      { key: "horseArmour", label: "Horse armour (iron, gold, diamond)", type: "boolean", default: true },
      { key: "elytra", label: "Elytra (very expensive)", type: "boolean", default: false }
    ],
    build: ({ options, format }) => {
      const result = (id2, count = 1) => format >= 41 ? { id: id2, count } : { item: id2, count };
      const json = [];
      const shaped = (name, pattern, key, out, count = 1) => {
        json.push({
          kind: "recipe",
          name,
          data: {
            type: "minecraft:crafting_shaped",
            pattern,
            key: Object.fromEntries(
              Object.entries(key).map(([k, v]) => [k, format >= 41 ? v : { item: v }])
            ),
            result: result(out, count)
          }
        });
      };
      if (bool(options, "saddle", true)) {
        shaped("saddle", ["LLL", "L L", "I I"], { L: "minecraft:leather", I: "minecraft:iron_ingot" }, "minecraft:saddle");
      }
      if (bool(options, "nameTag", true)) {
        shaped("name_tag", ["  P", " S ", "I  "], { P: "minecraft:paper", S: "minecraft:string", I: "minecraft:iron_ingot" }, "minecraft:name_tag");
      }
      if (bool(options, "horseArmour", true)) {
        for (const [metal, item] of [
          ["iron_ingot", "iron_horse_armor"],
          ["gold_ingot", "golden_horse_armor"],
          ["diamond", "diamond_horse_armor"]
        ]) {
          shaped(item, ["M  ", "MLM", "MMM"], { M: `minecraft:${metal}`, L: "minecraft:leather" }, `minecraft:${item}`);
        }
      }
      if (bool(options, "elytra")) {
        shaped(
          "elytra",
          ["PMP", "PDP", "P P"],
          { P: "minecraft:phantom_membrane", M: "minecraft:netherite_ingot", D: "minecraft:dragon_breath" },
          "minecraft:elytra"
        );
      }
      return { functions: { load: [] }, json };
    }
  },
  {
    id: "mob-heads",
    name: "Mob Heads",
    tagline: "Trophies from the things that tried to kill you.",
    description: "Killing a creeper, skeleton, zombie or wither skeleton has a chance to drop its head. Implemented with advancement triggers rather than loot tables, so it does not replace any vanilla drops.",
    icon: "skull",
    category: "Crafting",
    options: [
      { key: "chance", label: "Drop chance (%)", type: "number", default: 25, min: 1, max: 100 },
      { key: "players", label: "Also drop player heads in PvP", type: "boolean", default: false }
    ],
    build: ({ options, ns, format }) => {
      const chance = Math.max(1, Math.min(100, Math.round(num(options, "chance", 25))));
      const mobs = [
        ["creeper", "minecraft:creeper_head"],
        ["skeleton", "minecraft:skeleton_skull"],
        ["wither_skeleton", "minecraft:wither_skeleton_skull"],
        ["zombie", "minecraft:zombie_head"]
      ];
      const json = [];
      const functions = {
        load: ["scoreboard objectives add nc_roll dummy"]
      };
      for (const [mob, head] of mobs) {
        const entityCondition = format >= 41 ? [
          {
            condition: "minecraft:entity_properties",
            entity: "this",
            predicate: { type: `minecraft:${mob}` }
          }
        ] : { type: `minecraft:${mob}` };
        json.push({
          kind: "advancement",
          name: `kill_${mob}`,
          data: {
            criteria: {
              kill: {
                trigger: "minecraft:player_killed_entity",
                conditions: { entity: entityCondition }
              }
            },
            rewards: { function: `${ns}:drop_${mob}` }
          }
        });
        functions[`drop_${mob}`] = [
          // Re-rolling the advancement lets it fire on every kill.
          `advancement revoke @s only ${ns}:kill_${mob}`,
          `execute store result score @s nc_roll run random value 1..100`,
          `execute if score @s nc_roll matches ..${chance} at @s run summon minecraft:item ~ ~1 ~ {Item:{id:"${head}",count:1}}`
        ];
      }
      if (bool(options, "players")) {
        json.push({
          kind: "advancement",
          name: "kill_player",
          data: {
            criteria: { kill: { trigger: "minecraft:player_killed_entity", conditions: {} } },
            rewards: { function: `${ns}:drop_player` }
          }
        });
        functions.drop_player = [
          `advancement revoke @s only ${ns}:kill_player`,
          'execute at @s run summon minecraft:item ~ ~1 ~ {Item:{id:"minecraft:player_head",count:1}}'
        ];
      }
      return { functions, json };
    }
  },
  {
    id: "ore-harvest",
    name: "Ore Harvest",
    tagline: "Ores give more, and smelt themselves.",
    description: "Replaces the drop tables for coal, iron, gold, copper and diamond ore so they yield extra, and optionally drop ingots directly. Silk Touch and Fortune still behave normally.",
    icon: "pickaxe",
    category: "Crafting",
    options: [
      { key: "multiplier", label: "Extra drops per ore", type: "number", default: 2, min: 1, max: 5 },
      { key: "autoSmelt", label: "Smelt iron, gold and copper automatically", type: "boolean", default: false }
    ],
    build: ({ options, format }) => {
      const multiplier = Math.max(1, Math.min(5, Math.round(num(options, "multiplier", 2))));
      const autoSmelt = bool(options, "autoSmelt");
      const ores = [
        ["coal_ore", "minecraft:coal", "minecraft:coal"],
        ["deepslate_coal_ore", "minecraft:coal", "minecraft:coal"],
        ["iron_ore", "minecraft:raw_iron", "minecraft:iron_ingot"],
        ["deepslate_iron_ore", "minecraft:raw_iron", "minecraft:iron_ingot"],
        ["copper_ore", "minecraft:raw_copper", "minecraft:copper_ingot"],
        ["deepslate_copper_ore", "minecraft:raw_copper", "minecraft:copper_ingot"],
        ["gold_ore", "minecraft:raw_gold", "minecraft:gold_ingot"],
        ["deepslate_gold_ore", "minecraft:raw_gold", "minecraft:gold_ingot"],
        ["diamond_ore", "minecraft:diamond", "minecraft:diamond"],
        ["deepslate_diamond_ore", "minecraft:diamond", "minecraft:diamond"]
      ];
      const silkTouch = format >= 41 ? {
        condition: "minecraft:match_tool",
        predicate: { predicates: { "minecraft:enchantments": [{ enchantments: "minecraft:silk_touch", levels: { min: 1 } }] } }
      } : {
        condition: "minecraft:match_tool",
        predicate: { enchantments: [{ enchantment: "minecraft:silk_touch", levels: { min: 1 } }] }
      };
      const json = ores.map(([ore, raw, smelted]) => ({
        kind: "loot_table",
        namespace: "minecraft",
        name: `blocks/${ore}`,
        data: {
          type: "minecraft:block",
          pools: [
            {
              rolls: 1,
              entries: [
                {
                  type: "minecraft:alternatives",
                  children: [
                    // Silk Touch keeps the block itself, exactly as vanilla.
                    {
                      type: "minecraft:item",
                      name: `minecraft:${ore}`,
                      conditions: [silkTouch]
                    },
                    {
                      type: "minecraft:item",
                      name: autoSmelt ? smelted : raw,
                      functions: [
                        { function: "minecraft:set_count", count: multiplier, add: false },
                        { function: "minecraft:apply_bonus", enchantment: "minecraft:fortune", formula: "minecraft:ore_drops" },
                        { function: "minecraft:explosion_decay" }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }));
      return { functions: { load: [] }, json };
    }
  },
  /* ============================================================== arena */
  {
    id: "mob-arena",
    name: "Mob Arena",
    tagline: "Waves of mobs, right where you stand.",
    description: "Adds /trigger arena to start a wave-based fight at your position. Each wave is larger and harder than the last, tracked on a boss bar, with a reward when you clear the final wave.",
    icon: "swords",
    category: "Arena",
    options: [
      { key: "waves", label: "Number of waves", type: "number", default: 5, min: 1, max: 20 },
      { key: "perWave", label: "Mobs added each wave", type: "number", default: 3, min: 1, max: 10 },
      { key: "radius", label: "Spawn radius (blocks)", type: "number", default: 8, min: 3, max: 32 },
      { key: "reward", label: "Reward for clearing", type: "select", default: "diamond", choices: [
        { value: "none", label: "Nothing — just bragging rights" },
        { value: "diamond", label: "Diamonds" },
        { value: "netherite", label: "A netherite ingot" }
      ] }
    ],
    build: ({ options, ns }) => {
      const waves = Math.round(num(options, "waves", 5));
      const perWave = Math.round(num(options, "perWave", 3));
      const radius = Math.round(num(options, "radius", 8));
      const reward = str(options, "reward", "diamond");
      const spawns = ["zombie", "skeleton", "spider", "creeper"];
      const spawnLines = spawns.map(
        (mob) => `execute if score #wave nc_arena matches 1.. run summon minecraft:${mob} ~${radius} ~1 ~ {Tags:["nc_arena_mob"],PersistenceRequired:1b}`
      );
      const rewardLines = reward === "none" ? [] : reward === "netherite" ? ["give @a[distance=..48] minecraft:netherite_ingot 1"] : ["give @a[distance=..48] minecraft:diamond 5"];
      return {
        functions: {
          load: [
            "scoreboard objectives add nc_arena dummy",
            "scoreboard objectives add arena trigger",
            "scoreboard players set #wave nc_arena 0",
            "scoreboard players set #active nc_arena 0",
            'bossbar add nexuscraft:arena {"text":"Mob Arena"}',
            "bossbar set nexuscraft:arena color red",
            "bossbar set nexuscraft:arena visible false"
          ],
          tick: [
            "scoreboard players enable @a arena",
            `execute as @a[scores={arena=1..}] at @s run function ${ns}:start`,
            // Count what is still alive and move on when the field is clear.
            "execute if score #active nc_arena matches 1 store result score #alive nc_arena run execute if entity @e[tag=nc_arena_mob]",
            "execute if score #active nc_arena matches 1 store result score #alive nc_arena if entity @e[tag=nc_arena_mob]",
            `execute if score #active nc_arena matches 1 if score #alive nc_arena matches 0 run function ${ns}:next_wave`
          ],
          start: [
            "scoreboard players set @s arena 0",
            'execute if score #active nc_arena matches 1 run tellraw @s [{"text":"[Arena] ","color":"red"},{"text":"A fight is already running.","color":"gray"}]',
            `execute if score #active nc_arena matches 0 run function ${ns}:begin`
          ],
          begin: [
            "scoreboard players set #active nc_arena 1",
            "scoreboard players set #wave nc_arena 0",
            "bossbar set nexuscraft:arena visible true",
            "bossbar set nexuscraft:arena players @a",
            `bossbar set nexuscraft:arena max ${waves}`,
            'tellraw @a [{"text":"[Arena] ","color":"red"},{"text":"The fight begins.","color":"gray"}]',
            `function ${ns}:next_wave`
          ],
          next_wave: [
            "scoreboard players add #wave nc_arena 1",
            "execute store result bossbar nexuscraft:arena value run scoreboard players get #wave nc_arena",
            `execute if score #wave nc_arena matches ${waves + 1}.. run function ${ns}:finish`,
            `execute if score #wave nc_arena matches ..${waves} run function ${ns}:spawn_wave`
          ],
          spawn_wave: [
            'tellraw @a [{"text":"[Arena] ","color":"red"},{"text":"Wave ","color":"gray"},{"score":{"name":"#wave","objective":"nc_arena"},"color":"white"}]',
            "playsound minecraft:entity.wither.spawn master @a ~ ~ ~ 0.5 1.4",
            // Each wave spawns a growing ring of mobs around the starting point.
            ...Array.from({ length: perWave }, () => spawnLines).flat()
          ],
          finish: [
            "scoreboard players set #active nc_arena 0",
            "bossbar set nexuscraft:arena visible false",
            "kill @e[tag=nc_arena_mob]",
            'tellraw @a [{"text":"[Arena] ","color":"gold"},{"text":"All waves cleared.","color":"gray"}]',
            "playsound minecraft:ui.toast.challenge_complete master @a ~ ~ ~ 1 1",
            ...rewardLines
          ]
        }
      };
    }
  }
];
const log$4 = createLogger("datapacks");
const NAMESPACE = "nexuscraft";
function guessPackFormat(versionId) {
  const parts = versionId.split(".").map((n) => parseInt(n, 10));
  if (parts[0] >= 26) return 94;
  if (parts[0] === 1) {
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;
    if (minor >= 22) return 94;
    if (minor === 21) {
      if (patch >= 9) return 88;
      if (patch >= 5) return 71;
      if (patch >= 2) return 57;
      return 48;
    }
    if (minor === 20) {
      if (patch >= 5) return 41;
      if (patch >= 2) return 18;
      return 15;
    }
    if (minor === 19) return 10;
    if (minor === 18) return 8;
  }
  return 15;
}
function packMetadata(format, name) {
  const description = `${name} — generated by NexusCraft Launcher`;
  if (format <= 81) {
    return { pack: { pack_format: format, description } };
  }
  return {
    pack: {
      pack_format: format,
      min_format: format,
      max_format: format,
      description
    }
  };
}
async function readPackFormat(instance) {
  const versionId = instance.resolvedVersionId ?? instance.minecraftVersion;
  let baseId = instance.minecraftVersion;
  try {
    const version = await resolveVersion(versionId);
    baseId = version.resolvedBaseId ?? instance.minecraftVersion;
  } catch {
  }
  const jar = versionJarPath(baseId);
  if (node_fs.existsSync(jar)) {
    try {
      const entry = new AdmZip(jar).getEntry("version.json");
      if (entry) {
        const meta = JSON.parse(entry.getData().toString("utf8"));
        const packVersion = meta.pack_version;
        const data = typeof packVersion === "number" ? packVersion : packVersion?.data_major ?? packVersion?.data;
        if (typeof data === "number" && data > 0) {
          return { format: data, source: `version.json in ${baseId}.jar` };
        }
      }
    } catch (err) {
      log$4.warn(`could not read pack_version from ${baseId}.jar: ${err.message}`);
    }
  }
  const guess = guessPackFormat(baseId);
  return { format: guess, source: `estimated from the version number (${baseId})` };
}
const MODERN = {
  function: "function",
  advancement: "advancement",
  recipe: "recipe",
  loot_table: "loot_table",
  predicate: "predicate"
};
const LEGACY = {
  function: "functions",
  advancement: "advancements",
  recipe: "recipes",
  loot_table: "loot_tables",
  predicate: "predicates"
};
function layouts(format) {
  return format >= 48 ? [MODERN, LEGACY] : [LEGACY, MODERN];
}
function listDataPacks() {
  return PACKS.map(({ build, minPackFormat, ...definition }) => definition);
}
function findPack(id2) {
  const pack = PACKS.find((p) => p.id === id2);
  if (!pack) throw new LauncherError("NOT_FOUND", `no data pack named ${id2}`);
  return pack;
}
async function buildDataPack(instance, packId, options) {
  const pack = findPack(packId);
  const { format, source } = await readPackFormat(instance);
  if (pack.minPackFormat && format < pack.minPackFormat) {
    throw new LauncherError("INVALID_INPUT", `${pack.id} needs pack format ${pack.minPackFormat}, got ${format}`, {
      title: `${pack.name} needs a newer Minecraft version`,
      message: `This pack relies on features Minecraft only gained in a later release. Minecraft ${instance.minecraftVersion} uses data pack format ${format}, and this pack needs at least ${pack.minPackFormat}.`,
      actions: ["Use this pack on a newer instance", "Or pick a different pack"]
    });
  }
  const ns = `${NAMESPACE}_${pack.id.replace(/-/g, "_")}`;
  const context = { options, ns, format };
  const output = pack.build(context);
  const files = [
    {
      path: "pack.mcmeta",
      content: JSON.stringify(packMetadata(format, pack.name), null, 2)
    }
  ];
  const header = [
    `# ${pack.name}`,
    `# Generated by NexusCraft Launcher for Minecraft ${instance.minecraftVersion}`,
    "# Safe to edit by hand — it is a plain data pack.",
    ""
  ];
  const announce2 = `tellraw @a [{"text":"[NexusCraft] ","color":"aqua"},{"text":"${pack.name} loaded","color":"gray"}]`;
  for (const layout of layouts(format)) {
    for (const [name, lines] of Object.entries(output.functions)) {
      const body = name === "load" ? [...lines, announce2] : lines;
      if (body.length === 0 && name !== "load") continue;
      files.push({
        path: `data/${ns}/${layout.function}/${name}.mcfunction`,
        content: [...header, ...body, ""].join("\n")
      });
    }
    if ("load" in output.functions) {
      files.push({
        path: `data/minecraft/tags/${layout.function}/load.json`,
        content: JSON.stringify({ values: [`${ns}:load`] }, null, 2)
      });
    }
    if (output.functions.tick && output.functions.tick.length > 0) {
      files.push({
        path: `data/minecraft/tags/${layout.function}/tick.json`,
        content: JSON.stringify({ values: [`${ns}:tick`] }, null, 2)
      });
    }
    for (const entry of output.json ?? []) {
      files.push({
        path: jsonPath(entry, layout, ns),
        content: JSON.stringify(entry.data, null, 2)
      });
    }
  }
  return { fileName: `${pack.id}.zip`, files, packFormat: format, formatSource: source };
}
function jsonPath(entry, layout, ns) {
  const namespace = entry.namespace ?? ns;
  if (entry.kind === "raw") return `data/${namespace}/${entry.name}.json`;
  return `data/${namespace}/${layout[entry.kind]}/${entry.name}.json`;
}
function writeZip(built, outputFile) {
  const zip = new AdmZip();
  for (const file2 of built.files) zip.addFile(file2.path, Buffer.from(file2.content, "utf8"));
  zip.writeZip(outputFile);
}
async function installDataPack(instance, worldFolder2, packId, options) {
  const saves = instanceSubdir(instance, "saves");
  const world = assertInside(saves, node_path.join(saves, worldFolder2));
  if (!node_fs.existsSync(world)) {
    throw new LauncherError("NOT_FOUND", `world ${worldFolder2} does not exist`, {
      title: "That world no longer exists",
      message: "The world you chose has been deleted or renamed.",
      actions: ["Pick a different world", "Create a world in game first"]
    });
  }
  const built = await buildDataPack(instance, packId, options);
  const target = node_path.join(world, "datapacks");
  await promises.mkdir(target, { recursive: true });
  const output = node_path.join(target, built.fileName);
  writeZip(built, output);
  log$4.info(
    `installed data pack "${packId}" into ${worldFolder2} (pack_format ${built.packFormat}, ${built.files.length} files)`
  );
  return {
    world: worldFolder2,
    fileName: built.fileName,
    path: output,
    packFormat: built.packFormat,
    fileCount: built.files.length
  };
}
async function exportDataPack(instance, packId, options, outputFile) {
  const built = await buildDataPack(instance, packId, options);
  writeZip(built, outputFile);
  log$4.info(`exported data pack "${packId}" to ${outputFile}`);
  return { path: outputFile, packFormat: built.packFormat };
}
async function listInstalledDataPacks(instance, worldFolder2) {
  const saves = instanceSubdir(instance, "saves");
  const dir = node_path.join(assertInside(saves, node_path.join(saves, worldFolder2)), "datapacks");
  try {
    const names = await promises.readdir(dir);
    const out = [];
    for (const name of names) {
      const info = await promises.stat(node_path.join(dir, name)).catch(() => null);
      if (!info) continue;
      out.push({
        fileName: name,
        sizeBytes: info.isFile() ? info.size : 0,
        generated: PACKS.some((p) => name === `${p.id}.zip`)
      });
    }
    return out;
  } catch {
    return [];
  }
}
async function removeDataPack(instance, worldFolder2, fileName) {
  const saves = instanceSubdir(instance, "saves");
  const dir = node_path.join(assertInside(saves, node_path.join(saves, worldFolder2)), "datapacks");
  const target = assertInside(dir, node_path.join(dir, fileName));
  await promises.rm(target, { recursive: true, force: true });
  log$4.info(`removed data pack ${fileName} from ${worldFolder2}`);
}
function reportModpack(result) {
  toast(
    "success",
    `${result.instance.name} is ready`,
    `${result.installedFiles} files and ${result.overrides} config files installed.` + (result.skipped.length > 0 ? ` ${result.skipped.length} were skipped as untrusted downloads.` : "")
  );
}
function reportModpackServer(result) {
  const notes = [`${result.installedFiles} files and ${result.overrides} config files installed.`];
  if (result.clientOnlyMods.length > 0) {
    notes.push(
      `${result.clientOnlyMods.length} client-only mod${result.clientOnlyMods.length === 1 ? "" : "s"} turned off (${result.clientOnlyMods.slice(0, 3).join(", ")}${result.clientOnlyMods.length > 3 ? "…" : ""}).`
    );
  }
  if (result.skipped.length > 0) {
    notes.push(`${result.skipped.length} could not be downloaded automatically.`);
  }
  notes.push("Accept the EULA on the server to start it.");
  toast("success", `${result.server.name} is ready to host`, notes.join(" "));
}
const log$3 = createLogger("handlers");
function mainWindow$1() {
  return electron.BrowserWindow.getAllWindows()[0] ?? null;
}
const ALLOWED_EXTERNAL_DOMAINS = [
  // Microsoft identity and account surfaces used by the sign-in flow
  "microsoft.com",
  "microsoftonline.com",
  "live.com",
  "xbox.com",
  "aka.ms",
  "azure.com",
  // Mojang / Minecraft
  "minecraft.net",
  "mojang.com",
  // Mod ecosystem
  "fabricmc.net",
  "quiltmc.org",
  "minecraftforge.net",
  "neoforged.net",
  "modrinth.com",
  "curseforge.com",
  "github.com",
  // Where to get the relay agent the launcher can drive, for people whose
  // router cannot forward a port at all.
  "playit.gg"
];
function isAllowedExternalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return ALLOWED_EXTERNAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
function assertServerCanUse(kind, serverName) {
  if (kind === "mod" || kind === "modpack") return;
  const what = kind === "resourcepack" ? "Resource packs" : "Shaders";
  throw new LauncherError("INVALID_INPUT", `a server cannot use a ${kind}`, {
    title: `A server cannot use that`,
    message: `${what} are drawn by the game on each player's own machine, so installing one into "${serverName}" would do nothing.`,
    actions: [`Install it into the instance you play with instead`]
  });
}
let foreignFound = [];
function registerIpcHandlers() {
  handle("app:info", () => ({
    version: electron.app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    dataDir: dataRoot(),
    logsDir: logsRoot(),
    secureStorage: isEncryptionAvailable(),
    isPackaged: electron.app.isPackaged,
    /*
     * True when this copy was pointed at a throwaway data directory. Such a
     * window is empty by design and otherwise indistinguishable from the real
     * launcher, which has already caused one "where did all my instances go".
     */
    scratchData: Boolean(process.env.NEXUSCRAFT_DATA_DIR?.trim())
  }));
  handle("app:openExternal", async (payload) => {
    const url = new URL(payload.url);
    if (url.protocol !== "https:") {
      throw new LauncherError("INVALID_INPUT", `refused non-https url`, {
        title: "That link was blocked",
        message: "NexusCraft only opens secure https links.",
        actions: []
      });
    }
    if (!isAllowedExternalHost(url.hostname)) {
      throw new LauncherError("INVALID_INPUT", `refused external host ${url.hostname}`, {
        title: "That link was blocked",
        message: `NexusCraft only opens links to sites it knows: Microsoft, Mojang, and the mod loader projects. It refused to open ${url.hostname}.`,
        actions: ["Copy the address and open it yourself if you trust it"]
      });
    }
    await electron.shell.openExternal(url.toString());
    return true;
  });
  handle("app:openPath", async (payload) => {
    const root = dataRoot();
    const resolved = node_path.join(payload.path);
    if (!resolved.startsWith(root)) {
      throw new LauncherError("INVALID_INPUT", "path is outside the data directory");
    }
    if (!node_fs.existsSync(resolved)) throw new LauncherError("NOT_FOUND", "that folder does not exist yet");
    const error = await electron.shell.openPath(resolved);
    if (error) throw new LauncherError("UNKNOWN", error);
    return true;
  });
  handle("app:pickDirectory", async (payload) => {
    const window = mainWindow$1();
    if (!window) return null;
    const result = await electron.dialog.showOpenDialog(window, {
      title: payload?.title ?? "Choose a folder",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle(
    "app:pickFiles",
    async (payload) => {
      const window = mainWindow$1();
      if (!window) return [];
      const result = await electron.dialog.showOpenDialog(window, {
        title: payload?.title ?? "Choose files",
        properties: payload?.multi === false ? ["openFile"] : ["openFile", "multiSelections"],
        filters: payload?.extensions?.length ? [{ name: "Supported files", extensions: payload.extensions }] : void 0
      });
      return result.canceled ? [] : result.filePaths;
    }
  );
  handle(
    "app:pickSavePath",
    async (payload) => {
      const window = mainWindow$1();
      if (!window) return null;
      const result = await electron.dialog.showSaveDialog(window, {
        title: payload.title ?? "Save as",
        defaultPath: payload.defaultName,
        filters: payload.extensions?.length ? [{ name: "Supported files", extensions: payload.extensions }] : void 0
      });
      return result.canceled ? null : result.filePath ?? null;
    }
  );
  handle("app:window", (payload) => {
    const window = mainWindow$1();
    if (!window) return false;
    switch (payload.action) {
      case "minimize":
        window.minimize();
        break;
      case "maximize":
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case "close":
        window.close();
        break;
    }
    return true;
  });
  handle(
    "app:reportError",
    (payload) => {
      log$3.error(
        `renderer failure [${payload.source}]: ${payload.message}` + (payload.stack ? `
  stack: ${payload.stack}` : "") + (payload.componentStack ? `
  components: ${payload.componentStack}` : "")
      );
      return true;
    }
  );
  handle(
    "app:diagnostics",
    async (payload) => {
      const result = await writeDiagnostics(payload.outputPath, {
        instanceId: payload.instanceId,
        note: payload.note
      });
      toast(
        "success",
        "Diagnostics saved",
        `${result.files} files, ${(result.bytes / 1024).toFixed(0)} KB. Open it to see exactly what it contains.`
      );
      return result;
    }
  );
  handle("app:systemMemory", () => {
    const recommended = recommendedRamMb();
    return {
      totalMb: Math.floor(node_os.totalmem() / 1024 / 1024),
      freeMb: Math.floor(node_os.freemem() / 1024 / 1024),
      ...recommended
    };
  });
  handle("settings:get", () => ({ ...getSettings(), dataDir: dataRoot() }));
  handle("settings:update", (patch) => {
    if (typeof patch.dataDir === "string" && patch.dataDir !== dataRoot()) {
      writeBootstrap({ dataDir: patch.dataDir });
      toast("info", "Data folder updated", "Restart NexusCraft for the new location to take effect.");
      delete patch.dataDir;
    }
    const next = updateSettings(patch);
    if (patch.discordPresence === false) clearPresence();
    else if (patch.discordPresence === true) void showIdlePresence();
    return { ...next, dataDir: dataRoot() };
  });
  handle("auth:begin", async () => await beginSignIn());
  handle("auth:cancel", () => {
    cancelSignIn();
    return true;
  });
  handle("auth:list", () => listAccounts());
  handle("auth:setActive", (payload) => setActiveAccount(payload.accountId));
  handle("auth:logout", (payload) => {
    logout(payload.accountId);
    return true;
  });
  handle("auth:refresh", async (payload) => await refreshAccount(payload.accountId));
  handle(
    "versions:manifest",
    async (payload) => await getManifestInfo(payload?.refresh ?? false)
  );
  handle("versions:installed", async () => {
    const ids = await listInstalledVersionIds();
    const details = await Promise.all(
      ids.map(async (id2) => {
        try {
          const version = await resolveVersion(id2);
          return {
            id: id2,
            type: version.type,
            javaMajor: version.javaVersion?.majorVersion ?? null,
            releaseTime: version.releaseTime ?? null,
            isLoaderProfile: (version.resolvedBaseId ?? id2) !== id2
          };
        } catch {
          return { id: id2, type: "unknown", javaMajor: null, releaseTime: null, isLoaderProfile: false };
        }
      })
    );
    return details;
  });
  handle(
    "versions:loaderVersions",
    async (payload) => await listLoaderVersions(payload.loader, payload.minecraftVersion)
  );
  handle("versions:delete", async (payload) => {
    const inUse = listInstances().some(
      (i) => i.resolvedVersionId === payload.versionId || i.minecraftVersion === payload.versionId
    );
    if (inUse) {
      throw new LauncherError("INVALID_INPUT", "version is in use", {
        title: "That version is still in use",
        message: "At least one instance uses this version. Remove or change those instances first.",
        actions: ["Open the Instances screen and change the version", "Or delete the instances that use it"]
      });
    }
    await deleteVersion(payload.versionId);
    return true;
  });
  handle("instances:list", () => listInstances());
  handle("instances:create", async (payload) => await createInstance(payload));
  handle(
    "instances:update",
    (payload) => updateInstance(payload.id, payload.patch)
  );
  handle("instances:delete", async (payload) => {
    if (isRunning(payload.id)) throw new LauncherError("ALREADY_RUNNING", "cannot delete a running instance");
    await deleteInstance(payload.id, payload.deleteFiles);
    return true;
  });
  handle(
    "instances:duplicate",
    async (payload) => await duplicateInstance(payload.id, payload.name)
  );
  handle("instances:stats", async (payload) => await instanceStats(payload.id));
  handle("instances:openFolder", async (payload) => {
    const instance = getInstance(payload.id);
    await ensureInstanceLayout(instance);
    const target = payload.sub ? instanceSubdir(instance, payload.sub) : instance.gameDir;
    const error = await electron.shell.openPath(target);
    if (error) throw new LauncherError("UNKNOWN", error);
    return true;
  });
  handle("instances:install", async (payload) => await installInstance(payload.id));
  handle("instances:repair", async (payload) => await repairInstance(payload.id));
  handle(
    "instances:export",
    async (payload) => {
      const instance = getInstance(payload.id);
      const exported = await exportInstance(payload.id, payload.outputPath, {
        includeWorlds: payload.includeWorlds,
        includeScreenshots: payload.includeScreenshots
      });
      toast("success", `${instance.name} exported`, `${exported.entries} files written.`);
      return exported;
    }
  );
  handle(
    "instances:inspectArchive",
    async (payload) => await inspectInstanceArchive(payload.filePath)
  );
  handle(
    "instances:import",
    async (payload) => await importInstance(payload.filePath, payload.name)
  );
  handle("instances:snapshots", async (payload) => await listSnapshots(payload.id));
  handle("instances:snapshot", async (payload) => {
    const snapshot = await createSnapshot(payload.id, payload.name, payload.note ?? "");
    toast(
      "success",
      `Snapshot "${snapshot.name}" taken`,
      snapshot.linked ? `${snapshot.files} files, using almost no extra disk.` : `${snapshot.files} files copied (${(snapshot.bytes / 1024 / 1024).toFixed(0)} MB — this drive does not support hard links).`
    );
    return snapshot;
  });
  handle("instances:restoreSnapshot", async (payload) => {
    const snapshot = await restoreSnapshot(payload.id, payload.snapshotId);
    toast("success", `Restored "${snapshot.name}"`, "What was there before was snapshotted first.");
    return snapshot;
  });
  handle("instances:deleteSnapshot", async (payload) => {
    await deleteSnapshot(payload.id, payload.snapshotId);
    return true;
  });
  handle(
    "instances:diffSnapshot",
    async (payload) => await diffSnapshot(payload.id, payload.snapshotId)
  );
  handle(
    "instances:exportPack",
    async (payload) => {
      const instance = getInstance(payload.id);
      const result = await exportInstanceAsPack(instance, payload.outputPath, {
        name: payload.name,
        version: payload.version,
        summary: payload.summary,
        includeConfigs: payload.includeConfigs,
        includeWorlds: payload.includeWorlds
      });
      const detail = `${result.linked} mod${result.linked === 1 ? "" : "s"} linked to Modrinth, ${result.overrides} file${result.overrides === 1 ? "" : "s"} bundled.` + (result.unmatched.length > 0 ? ` ${result.unmatched.length} jar${result.unmatched.length === 1 ? " was" : "s were"} not on Modrinth and shipped as copies.` : "");
      toast("success", `${instance.name} exported as a modpack`, detail);
      return result;
    }
  );
  handle("instances:findForeign", async () => {
    foreignFound = await findForeignInstances();
    return foreignFound;
  });
  handle("instances:importForeign", async (payload) => {
    const entry = foreignFound.find((candidate) => candidate.id === payload.id);
    if (!entry) {
      throw new LauncherError("NOT_FOUND", "that instance was not in the last scan", {
        title: "Scan again first",
        message: "The list of importable instances is from a scan that has since been replaced.",
        actions: ["Press Scan and try again"]
      });
    }
    const result = await importForeignInstance(entry, payload.name);
    toast(
      "success",
      `${result.name} imported`,
      `Copied ${result.copiedFolders.join(", ") || "nothing"}. Game files are downloaded fresh on first launch.`
    );
    return result;
  });
  handle("launch:start", async (payload) => {
    const state = await launchInstance({ instanceId: payload.instanceId, serverAddress: payload.serverAddress });
    if (payload.serverAddress) noteServerJoin(payload.serverAddress);
    return state;
  });
  handle("launch:stop", (payload) => {
    stopInstance(payload.instanceId);
    return true;
  });
  handle("launch:state", () => launchStates());
  handle(
    "launch:logs",
    (payload) => recentLogs(payload.instanceId, payload.limit ?? 500)
  );
  handle("launch:autopsyAvailable", async () => ({ available: await autopsyAvailable() }));
  handle("launch:autopsy", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const state = launchStates().find((entry) => entry.instanceId === payload.instanceId);
    return await diagnoseWithModel(instance, state?.crash ?? null);
  });
  handle("launch:applyFix", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const { fix } = payload;
    switch (fix.kind) {
      case "disable-mod": {
        if (!fix.modFileName) throw new LauncherError("INVALID_INPUT", "no mod named");
        await setModEnabled(instance, fix.modFileName, false);
        toast("success", "Mod disabled", `${fix.modFileName} is turned off. Try launching again.`);
        return { applied: "disable-mod" };
      }
      case "update-mod": {
        if (!fix.modFileName) throw new LauncherError("INVALID_INPUT", "no mod named");
        const updates = await checkModUpdates(instance);
        const match = updates.find((update) => update.fileName === fix.modFileName);
        if (!match) {
          throw new LauncherError("NOT_FOUND", "no newer build", {
            title: "There is no newer build of that mod",
            message: `Modrinth has nothing newer than the ${fix.modFileName} you already have for this version.`,
            actions: ["Try disabling it instead", "Or check the mod page for a build matching this Minecraft version"]
          });
        }
        await applyModUpdate(instance, match);
        toast("success", `${match.modName} updated`, `Now on ${match.newVersion}. Try launching again.`);
        return { applied: "update-mod" };
      }
      case "more-memory":
      case "less-memory": {
        const recommended = recommendedRamMb();
        const current = instance.java.maxRamMb;
        const step = 1024;
        const next = fix.kind === "more-memory" ? Math.min(current + step, recommended.ceiling) : Math.max(current - step, 1024);
        if (next === current) {
          throw new LauncherError("INVALID_INPUT", "memory already at the limit", {
            title: "Memory is already as far as it goes",
            message: fix.kind === "more-memory" ? `This instance already has ${current} MB, which is the most this machine can safely give it.` : `This instance is already at ${current} MB; lowering it further would not leave enough to start.`,
            actions: ["Try one of the other fixes"]
          });
        }
        updateInstance(instance.id, { java: { ...instance.java, maxRamMb: next } });
        toast("success", "Memory changed", `${instance.name} now has ${next} MB. Try launching again.`);
        return { applied: fix.kind, maxRamMb: next };
      }
      case "repair": {
        await repairInstance(instance.id);
        toast("success", "Instance repaired", "Missing and damaged files were downloaded again.");
        return { applied: "repair" };
      }
      default:
        return { applied: "manual" };
    }
  });
  handle("downloads:state", () => activeTasks());
  handle("downloads:pause", (payload) => {
    getTask(payload.taskId)?.pause();
    return true;
  });
  handle("downloads:resume", (payload) => {
    getTask(payload.taskId)?.resume();
    return true;
  });
  handle("downloads:cancel", (payload) => {
    getTask(payload.taskId)?.cancel();
    return true;
  });
  handle("downloads:retry", async (payload) => {
    const task = getTask(payload.taskId);
    if (!task) throw new LauncherError("NOT_FOUND", "that download is no longer tracked");
    task.retryFailed();
    await task.run();
    task.markDone();
    return true;
  });
  handle(
    "java:list",
    async (payload) => await detectJavaInstallations(payload?.refresh ?? false)
  );
  handle("java:test", async (payload) => {
    const probed = await probeJava(payload.path);
    if (!probed) {
      throw new LauncherError("JAVA_NOT_FOUND", `not a usable java executable: ${payload.path}`, {
        title: "That is not a working Java runtime",
        message: 'NexusCraft could not run that file to ask its version. Pick the java.exe inside a JRE or JDK "bin" folder.',
        actions: ["Browse to something like C:\\Program Files\\Java\\jdk-21\\bin\\java.exe"]
      });
    }
    return probed;
  });
  handle("java:installRuntime", async (payload) => {
    const component = componentForMajor(payload.majorVersion);
    const task = createTask({ label: `Java ${payload.majorVersion}`, phase: "java-runtime" });
    const path2 = await installManagedRuntime(component, task);
    task.markDone();
    await detectJavaInstallations(true);
    toast("success", "Java installed", `Java ${payload.majorVersion} is ready to use.`);
    return { path: path2, component };
  });
  handle("java:recommend", async (payload) => {
    try {
      const version = await resolveVersion(payload.minecraftVersion);
      return {
        majorVersion: version.javaVersion?.majorVersion ?? null,
        component: version.javaVersion?.component ?? null
      };
    } catch {
      return { majorVersion: null, component: null };
    }
  });
  handle("mods:list", async (payload) => await analyseMods(getInstance(payload.instanceId)));
  handle("mods:setEnabled", async (payload) => {
    await setModEnabled(getInstance(payload.instanceId), payload.fileName, payload.enabled);
    return true;
  });
  handle("mods:delete", async (payload) => {
    await deleteMod(getInstance(payload.instanceId), payload.fileName);
    return true;
  });
  handle("mods:import", async (payload) => {
    const count = await importMods(getInstance(payload.instanceId), payload.files);
    return { imported: count };
  });
  handle("mods:openFolder", async (payload) => {
    const error = await electron.shell.openPath(modsDir(getInstance(payload.instanceId)));
    if (error) throw new LauncherError("UNKNOWN", error);
    return true;
  });
  handle(
    "content:list",
    async (payload) => await listContent(getInstance(payload.instanceId), payload.kind)
  );
  handle("content:import", async (payload) => {
    const count = await importContent(getInstance(payload.instanceId), payload.kind, payload.files);
    return { imported: count };
  });
  handle(
    "content:setEnabled",
    async (payload) => {
      await setContentEnabled(getInstance(payload.instanceId), payload.kind, payload.fileName, payload.enabled);
      return true;
    }
  );
  handle("content:delete", async (payload) => {
    await deleteContent(getInstance(payload.instanceId), payload.kind, payload.fileName);
    return true;
  });
  handle(
    "content:openFolder",
    async (payload) => {
      const instance = getInstance(payload.instanceId);
      const dir = payload.kind === "screenshots" ? instanceSubdir(instance, "screenshots") : contentDir(instance, payload.kind);
      const error = await electron.shell.openPath(dir);
      if (error) throw new LauncherError("UNKNOWN", error);
      return true;
    }
  );
  handle(
    "content:screenshots",
    async (payload) => await listScreenshots(getInstance(payload.instanceId))
  );
  handle(
    "modrinth:search",
    async (payload) => await searchProjects({
      query: payload.query,
      kind: payload.kind,
      gameVersion: payload.gameVersion,
      loader: payload.loader,
      offset: payload.offset,
      limit: payload.limit,
      instance: payload.instanceId ? findInstance(payload.instanceId) : null
    })
  );
  handle(
    "modrinth:versions",
    async (payload) => await listVersions(payload.projectId, payload.kind, payload.gameVersion, payload.loader)
  );
  handle("modrinth:install", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const result = await installVersionToInstance(instance, payload.versionId, payload.kind);
    const total = result.installed.length + result.dependencies.length;
    if (total === 0 && result.skipped.length > 0) {
      toast("info", "Already installed", `${result.skipped[0]} is already in this instance.`);
    } else {
      toast(
        "success",
        `Added to ${instance.name}`,
        result.dependencies.length > 0 ? `${result.installed.join(", ")} plus ${result.dependencies.length} required dependenc${result.dependencies.length === 1 ? "y" : "ies"}.` : result.installed.join(", ")
      );
    }
    return result;
  });
  handle("modrinth:project", async (payload) => await getProjectBody(payload.projectId));
  handle("modpack:inspect", async (payload) => await inspectModpack(payload.filePath));
  handle("modpack:installFile", async (payload) => {
    const result = await installModpackFromFile(payload.filePath, payload.name);
    reportModpack(result);
    return result;
  });
  handle("modpack:installModrinth", async (payload) => {
    const result = await installModpackFromModrinth(payload.versionId, payload.name);
    reportModpack(result);
    return result;
  });
  handle("mods:checkUpdates", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const [modrinth, curseforge] = await Promise.allSettled([
      checkModUpdates(instance),
      checkCurseForgeUpdates(instance)
    ]);
    if (modrinth.status === "rejected") {
      log$3.warn(`Modrinth update check failed: ${String(modrinth.reason)}`);
    }
    if (curseforge.status === "rejected") {
      log$3.warn(`CurseForge update check failed: ${String(curseforge.reason)}`);
    }
    const found = [
      ...modrinth.status === "fulfilled" ? modrinth.value : [],
      ...curseforge.status === "fulfilled" ? curseforge.value : []
    ];
    const seen = /* @__PURE__ */ new Set();
    return found.filter((update) => {
      if (seen.has(update.fileName)) return false;
      seen.add(update.fileName);
      return true;
    });
  });
  handle("mods:applyUpdate", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const update = payload.update;
    if (typeof update?.newVersionId !== "string" || typeof update?.fileName !== "string") {
      throw new LauncherError("INVALID_INPUT", "malformed update payload");
    }
    if (update.source === "curseforge") await applyCurseForgeUpdate(instance, update);
    else await applyModUpdate(instance, update);
    toast("success", `${update.modName} updated`, `Now on ${update.newVersion}. The old jar is kept so you can undo this.`);
    return true;
  });
  handle("mods:changelog", async (payload) => {
    getInstance(payload.instanceId);
    const update = payload.update;
    if (typeof update?.newVersionId !== "string") {
      throw new LauncherError("INVALID_INPUT", "malformed update payload");
    }
    return await modChangelog(update);
  });
  handle("mods:autoUpdateSettings", () => modUpdateSettings());
  handle(
    "mods:setAutoUpdateSettings",
    (payload) => setModUpdateSettings(payload.patch)
  );
  handle(
    "mods:bundledStatus",
    async (payload) => await allBundledModStatuses(getInstance(payload.instanceId))
  );
  handle("mods:installBundled", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const result = await installBundledMod(instance, payload.modId);
    toast(
      result.warning ? "warning" : "success",
      `${result.name} installed`,
      result.warning ?? (result.model ? `Configured to use ${result.model} on your local Ollama.` : "Installed. Launch the instance to try it.")
    );
    return result;
  });
  handle("voice:status", async () => ({
    ...currentStatus(),
    servingToGame: isRunning$1(),
    builds: BUILDS
  }));
  handle("voice:prepare", async (payload) => {
    await ensureLoaded(payload.build ?? "q4");
    return currentStatus();
  });
  handle("voice:speak", async (payload) => {
    const wav = await speak(payload.text, payload.voice, payload.build ?? "q4");
    return { wav: wav.toString("base64") };
  });
  handle("voice:serveToGame", async (payload) => {
    if (payload.on) {
      await start();
      toast(
        "success",
        "Voice shared with Minecraft",
        `Set voice=speech in config/hollow.properties and Hollow will speak with this voice. It already points at port ${SPEECH_PORT}.`
      );
    } else {
      await stop();
    }
    return { running: isRunning$1() };
  });
  handle("mods:checkAllNow", async () => await sweepForModUpdates("checked by hand"));
  handle(
    "mods:rollbacks",
    async (payload) => await listRollbacks(getInstance(payload.instanceId))
  );
  handle("mods:rollback", async (payload) => {
    const entry = await rollbackModUpdate(getInstance(payload.instanceId), payload.fileName);
    toast("success", `${entry.modName} rolled back`, `Back on ${entry.fromVersion ?? "the previous build"}.`);
    return entry;
  });
  handle(
    "host:installModrinth",
    async (payload) => {
      const server2 = getHostedServer(payload.id);
      assertServerCanUse(payload.kind, server2.name);
      const target = serverModTarget(server2);
      const result = await installVersionToDir(
        { dir: target.dir, taskId: server2.id, loader: target.loader, minecraftVersion: target.minecraftVersion },
        payload.versionId,
        payload.kind
      );
      const total = result.installed.length + result.dependencies.length;
      if (total === 0 && result.skipped.length > 0) {
        toast("info", "Already on the server", `${result.skipped[0]} is already there.`);
      } else {
        toast(
          "success",
          `Added to ${server2.name}`,
          result.dependencies.length > 0 ? `${result.installed.join(", ")} plus ${result.dependencies.length} required dependenc${result.dependencies.length === 1 ? "y" : "ies"}. Restart the server to load it.` : `${result.installed.join(", ")}. Restart the server to load it.`
        );
      }
      return result;
    }
  );
  handle(
    "host:installCurseForge",
    async (payload) => {
      const server2 = getHostedServer(payload.id);
      assertServerCanUse(payload.kind, server2.name);
      const target = serverModTarget(server2);
      const result = await installCurseForgeFileToDir(
        { dir: target.dir, taskId: server2.id },
        payload.projectId,
        payload.fileId,
        server2.name
      );
      toast("success", `Added to ${server2.name}`, `${result.installed.join(", ")}. Restart the server to load it.`);
      return result;
    }
  );
  handle("host:share", async (payload) => await shareDetails(payload.id));
  handle("host:forwardStatus", async (payload) => {
    const server2 = getHostedServer(payload.id);
    const [host] = connectAddress(server2).split(":");
    return await forwardingStatus(server2.port, host);
  });
  handle("host:openPort", async (payload) => {
    const server2 = getHostedServer(payload.id);
    if (!server2.onlineMode && !payload.acceptUnverified) {
      throw new LauncherError("INVALID_INPUT", "refusing to expose an unverified server", {
        title: "This server does not check who joins",
        message: `"${server2.name}" has "Verify players with Mojang" switched off, which is what lets an AI companion join without its own Minecraft account. Opening it to the internet as well means anyone who finds the address can join under any name they like — including yours, or an operator's.`,
        actions: [
          'Turn "Verify players with Mojang" back on, and forward the port',
          "Or keep it off and play over your local network only",
          "The launcher will still do it if you confirm you understand"
        ]
      });
    }
    const gateway = await discoverGateway();
    if (!gateway) {
      throw new LauncherError("NETWORK_ERROR", "no UPnP gateway on this network", {
        title: "No router offered to forward the port",
        message: "Nothing on this network answered a UPnP search. Routers often ship with it switched off.",
        actions: [
          "Turn on UPnP in the router settings and try again",
          `Or forward TCP port ${server2.port} to this machine by hand`
        ]
      });
    }
    const [host] = connectAddress(server2).split(":");
    const label = `NexusCraft — ${server2.name}`;
    await openPort(gateway, server2.port, host, label);
    log$3.info(`opened port ${server2.port} for "${server2.name}" via ${gateway.description}`);
    keepPortOpen(server2.port, host, label);
    return await forwardingStatus(server2.port, host);
  });
  handle("host:closePort", async (payload) => {
    const server2 = getHostedServer(payload.id);
    stopKeepingPortOpen(server2.port);
    const gateway = await discoverGateway();
    if (!gateway) return { closed: false };
    const closed = await closePort(gateway, server2.port);
    if (closed) log$3.info(`closed port ${server2.port} for "${server2.name}"`);
    return { closed };
  });
  handle("curseforge:status", () => ({ configured: isConfigured() }));
  handle(
    "curseforge:verify",
    async (payload) => await verifyApiKey(payload?.key)
  );
  handle("datapacks:list", () => listDataPacks());
  handle(
    "datapacks:preview",
    async (payload) => {
      const built = await buildDataPack(getInstance(payload.instanceId), payload.packId, payload.options);
      return {
        fileName: built.fileName,
        packFormat: built.packFormat,
        formatSource: built.formatSource,
        files: built.files
      };
    }
  );
  handle(
    "datapacks:install",
    async (payload) => {
      const instance = getInstance(payload.instanceId);
      const result = await installDataPack(instance, payload.worldFolder, payload.packId, payload.options);
      toast(
        "success",
        "Data pack installed",
        `${result.fileName} added to ${result.world}. Reload or reopen the world to activate it.`
      );
      return result;
    }
  );
  handle(
    "datapacks:installed",
    async (payload) => await listInstalledDataPacks(getInstance(payload.instanceId), payload.worldFolder)
  );
  handle("datapacks:remove", async (payload) => {
    await removeDataPack(getInstance(payload.instanceId), payload.worldFolder, payload.fileName);
    return true;
  });
  handle(
    "datapacks:export",
    async (payload) => {
      const result = await exportDataPack(
        getInstance(payload.instanceId),
        payload.packId,
        payload.options,
        payload.outputPath
      );
      toast("success", "Data pack exported", payload.outputPath);
      return result;
    }
  );
  handle(
    "curseforge:search",
    async (payload) => await searchCurseForge({
      query: payload.query,
      kind: payload.kind,
      gameVersion: payload.gameVersion,
      loader: payload.loader,
      offset: payload.offset,
      limit: payload.limit,
      instance: payload.instanceId ? findInstance(payload.instanceId) : null
    })
  );
  handle(
    "curseforge:files",
    async (payload) => await listCurseForgeFiles(payload.projectId, payload.kind, payload.gameVersion, payload.loader)
  );
  handle(
    "curseforge:install",
    async (payload) => {
      const instance = getInstance(payload.instanceId);
      const result = await installCurseForgeFile(instance, payload.projectId, payload.fileId, payload.kind);
      if (result.installed.length > 0) {
        toast("success", `Added to ${instance.name}`, result.installed.join(", "));
      } else if (result.skipped.length > 0) {
        toast("info", "Already installed", result.skipped.join(", "));
      }
      return result;
    }
  );
  handle(
    "modpack:serverFromFile",
    async (payload) => {
      const result = await installModpackAsServerFromFile(payload.filePath, {
        name: payload.name,
        port: payload.port,
        memoryMb: payload.memoryMb
      });
      reportModpackServer(result);
      return result;
    }
  );
  handle(
    "modpack:serverFromModrinth",
    async (payload) => {
      const result = await installModpackAsServerFromModrinth(payload.versionId, {
        name: payload.name,
        port: payload.port,
        memoryMb: payload.memoryMb
      });
      reportModpackServer(result);
      return result;
    }
  );
  handle(
    "modpack:serverFromCurseForge",
    async (payload) => {
      const result = await installModpackAsServerFromCurseForge(payload.projectId, payload.fileId, {
        name: payload.name,
        port: payload.port,
        memoryMb: payload.memoryMb
      });
      reportModpackServer(result);
      return result;
    }
  );
  handle("modpack:installCurseForge", async (payload) => {
    const result = await installCurseForgeModpack(payload.projectId, payload.fileId, payload.name);
    reportModpack(result);
    return result;
  });
  handle("worlds:list", async (payload) => await listWorlds(getInstance(payload.instanceId)));
  handle("worlds:openFolder", async (payload) => {
    const instance = getInstance(payload.instanceId);
    const root = savesDir(instance);
    const target = payload.folderName ? node_path.join(root, payload.folderName) : root;
    if (!node_fs.existsSync(target)) throw new LauncherError("NOT_FOUND", "that folder does not exist");
    const error = await electron.shell.openPath(target);
    if (error) throw new LauncherError("UNKNOWN", error);
    return true;
  });
  handle("worlds:backup", async (payload) => {
    const instance = getInstance(payload.instanceId);
    if (isRunning(payload.instanceId)) {
      throw new LauncherError("ALREADY_RUNNING", "cannot back up while the game is running", {
        title: "Close Minecraft first",
        message: "Backing up a world while the game has it open can capture a half-written save.",
        actions: ["Quit Minecraft, then back up the world"]
      });
    }
    const backup = await backupWorld(instance, payload.folderName);
    toast("success", "Backup created", backup.fileName);
    return backup;
  });
  handle("worlds:map", async (payload) => {
    const map = await worldMap(getInstance(payload.instanceId), payload.folderName);
    if (!map) {
      throw new LauncherError("NOT_FOUND", "no region data", {
        title: "Nothing to map yet",
        message: "This world has no generated region files — play in it a little first.",
        actions: []
      });
    }
    return map;
  });
  handle(
    "worlds:listBackups",
    async (payload) => await listBackups(getInstance(payload.instanceId))
  );
  handle("worlds:deleteBackup", async (payload) => {
    await deleteBackup(getInstance(payload.instanceId), payload.fileName);
    return true;
  });
  handle("worlds:restore", async (payload) => {
    if (isRunning(payload.instanceId)) {
      throw new LauncherError("ALREADY_RUNNING", "cannot restore while the game is running", {
        title: "Close Minecraft first",
        message: "Replacing a world Minecraft has open would corrupt the save it writes on exit.",
        actions: ["Quit Minecraft, then restore the backup"]
      });
    }
    const world = await restoreBackup(getInstance(payload.instanceId), payload.fileName);
    toast("success", `${world.name} restored`, "The world it replaced was backed up first.");
    return world;
  });
  handle("worlds:import", async (payload) => {
    const world = await importWorldArchive(getInstance(payload.instanceId), payload.filePath);
    toast("success", `${world.name} imported`, "It is in your world list, ready to play.");
    return world;
  });
  handle("worlds:delete", async (payload) => {
    if (isRunning(payload.instanceId)) {
      throw new LauncherError("ALREADY_RUNNING", "cannot delete a world while the game is running");
    }
    const backup = await deleteWorld(getInstance(payload.instanceId), payload.folderName);
    toast("info", "World deleted", `A backup was kept: ${backup.fileName}`);
    return backup;
  });
  handle("directory:list", async () => {
    let source = "bundled";
    try {
      source = (await loadRemoteCatalogue()).source;
    } catch (err) {
      log$3.warn(`custom server directory failed, using the built-in list: ${err.message}`);
      toast("warning", "Could not load your server list", "Showing the built-in list instead.");
    }
    return {
      servers: catalogue(),
      categories: categories(),
      statuses: cachedDirectoryStatuses(),
      source
    };
  });
  handle(
    "directory:refresh",
    async (payload) => await refreshDirectory(payload?.force ?? false)
  );
  handle("directory:ping", async (payload) => await pingDirectoryServer(payload.id));
  handle("directory:lookup", async (payload) => await lookupAddress(payload.address));
  handle("directory:add", (payload) => {
    const existing = listServers().find(
      (server2) => server2.address.toLowerCase() === payload.address.toLowerCase() && server2.port === payload.port
    );
    if (existing) {
      toast("info", "Already saved", `${existing.name} is already in your servers.`);
      return existing;
    }
    const saved = saveServer({
      id: null,
      name: payload.name,
      address: payload.address,
      port: payload.port
    });
    toast("success", `${saved.name} saved`, "Find it on the Servers screen.");
    return saved;
  });
  handle("directory:compatibility", () => {
    const instances = listInstances();
    const result = {};
    for (const status2 of cachedDirectoryStatuses()) {
      if (status2.online !== true) continue;
      const { candidates, serverVersions } = rankInstancesForServer(status2, instances);
      result[status2.serverId] = {
        ok: candidates.length > 0,
        instanceName: candidates[0]?.instance.name ?? null,
        serverVersions: serverVersions.slice(0, 6),
        reason: candidates.length > 0 ? null : serverVersions.length === 0 ? "it did not say which version it runs" : `needs ${serverVersions[0]}`
      };
    }
    return result;
  });
  handle("directory:joinTargets", async (payload) => {
    const status2 = await lookupAddress(`${payload.address}:${payload.port}`).then(
      (found) => found.status,
      () => null
    );
    const { candidates, serverVersions } = rankInstancesForServer(status2, listInstances());
    return {
      serverVersions,
      protocol: status2?.protocol ?? null,
      versionName: status2?.versionName ?? null,
      candidates: candidates.map((c) => ({ instance: c.instance, reason: c.reason }))
    };
  });
  handle("directory:join", async (payload) => {
    const instances = listInstances();
    if (instances.length === 0) {
      throw new LauncherError("NOT_FOUND", "no instances exist", {
        title: "There is no instance to join with",
        message: "Joining a server means launching Minecraft, and no instance has been created yet.",
        actions: ["Open the Instances screen and create one", "Then come back and press Join"]
      });
    }
    const address = `${payload.address}:${payload.port}`;
    if (payload.instanceId) {
      const chosen = instances.find((i) => i.id === payload.instanceId);
      if (!chosen) throw new LauncherError("NOT_FOUND", "that instance no longer exists");
      return await launchInstance({ instanceId: chosen.id, serverAddress: address });
    }
    const status2 = await lookupAddress(address).then(
      (found) => found.status,
      () => null
    );
    if (status2?.online !== true) {
      throw new LauncherError("NETWORK_ERROR", "the server did not answer a ping", {
        title: "That server is not answering",
        message: status2?.error ?? "The launcher could not reach it just now, so it cannot tell which version to join with.",
        actions: ["Press Refresh and try again", "Check the address is still right"]
      });
    }
    const { candidates, serverVersions } = rankInstancesForServer(status2, instances);
    if (candidates.length === 0) {
      const have = [...new Set(instances.map((i) => i.minecraftVersion))].sort().join(", ");
      if (serverVersions.length === 0) {
        throw new LauncherError("INVALID_INPUT", "the server did not report a usable version", {
          title: `${payload.address} did not say which version it runs`,
          message: (status2.versionName ? `It answered "${status2.versionName}", which names its software rather than a Minecraft version. ` : "") + "Without a version the launcher cannot tell which of your instances would work, and guessing wrong fails during connection with an error that does not explain itself.",
          actions: [
            'Pick an instance yourself with the "Join with" selector, then press Join',
            "Most large servers accept a wide range of versions, so your newest instance is a good first try"
          ]
        });
      }
      const wanted = serverVersions[0];
      throw new LauncherError("INVALID_INPUT", `no instance matches protocol ${status2.protocol ?? "?"}`, {
        title: `Nothing installed can join a ${wanted} server`,
        message: `${payload.address} is running Minecraft ${wanted}` + (status2.versionName ? ` (it calls itself "${status2.versionName}")` : "") + `, and the instances on this machine are ${have || "none"}. Joining with the wrong version fails during connection with an error that does not say why, so the launcher stopped here instead.`,
        actions: [
          `Create an instance on ${wanted} and press Join again`,
          "Or pick an instance yourself with the selector next to Join"
        ]
      });
    }
    const best = candidates[0];
    log$3.info(
      `joining ${payload.address} (${serverVersions[0] ?? "unknown"}) with "${best.instance.name}" — ${best.reason}`
    );
    return await launchInstance({ instanceId: best.instance.id, serverAddress: address });
  });
  handle("servers:list", () => ({ servers: listServers(), statuses: cachedStatuses() }));
  handle("servers:save", (payload) => saveServer(payload));
  handle("servers:delete", (payload) => {
    deleteServer(payload.id);
    return true;
  });
  handle("servers:favorite", (payload) => setFavorite(payload.id, payload.favorite));
  handle("servers:ping", async (payload) => await checkServer(payload.id));
  handle("servers:pingAll", async () => await checkAllServers());
  handle("servers:import", async (payload) => {
    const count = await importFromInstance(getInstance(payload.instanceId));
    if (count > 0) toast("success", "Servers imported", `${count} server${count === 1 ? "" : "s"} added.`);
    else toast("info", "Nothing new to import", "Every server in that instance is already saved.");
    return { imported: count };
  });
  handle("skins:list", () => listSkins());
  handle(
    "skins:import",
    async (payload) => await importSkin(payload.filePath, payload.name, payload.variant)
  );
  handle("skins:delete", async (payload) => {
    await deleteSkin(payload.id);
    return true;
  });
  handle("skins:favorite", (payload) => favoriteSkin(payload.id, payload.favorite));
  handle("skins:apply", async (payload) => {
    const account = getActiveAccount();
    if (!account) throw new LauncherError("TOKEN_EXPIRED", "no active account");
    await applySkin(account, payload.id);
    const updated = await refreshAccount(account.id);
    toast("success", "Skin applied", "Your new skin is live on your Minecraft profile.");
    return updated;
  });
  handle("skins:resetToCurrent", async () => {
    const account = getActiveAccount();
    if (!account) throw new LauncherError("TOKEN_EXPIRED", "no active account");
    await resetSkin(account);
    const updated = await refreshAccount(account.id);
    toast("success", "Skin reset", "Your profile is back to the default skin.");
    return updated;
  });
  handle("companion:toolSizes", () => hostResolve.toolSetSizes());
  handle("companion:setMicrophone", (payload) => {
    setMicrophoneWanted(payload.wanted);
    return { wanted: payload.wanted };
  });
  handle("companion:list", () => listCompanions());
  handle("companion:states", () => allCompanionStates());
  handle("companion:create", (payload) => createCompanion(payload.name));
  handle("companion:delete", (payload) => {
    deleteCompanion(payload.id);
    toast("info", "Companion removed");
    return true;
  });
  handle("companion:settings", (payload) => getCompanion(payload.id));
  handle(
    "companion:updateSettings",
    (payload) => updateCompanion(payload.id, payload.patch)
  );
  handle(
    "companion:routines",
    () => hostResolve.ROUTINES.map((routine) => ({
      id: routine.id,
      label: routine.label,
      description: routine.description,
      needs: routine.needs
    }))
  );
  handle("companion:start", (payload) => startCompanion(payload.id));
  handle("companion:stop", (payload) => stopCompanion(payload.id));
  handle("companion:state", (payload) => getCompanionState(payload.id));
  handle("companion:instruct", (payload) => {
    instructCompanion(payload.id, payload.text);
    return true;
  });
  handle("companion:camera", (payload) => {
    setCameraEnabled(payload.id, payload.on);
    return true;
  });
  handle("companion:interrupt", (payload) => {
    interruptCompanion(payload.id);
    return true;
  });
  handle("companion:usage", () => companionUsage());
  handle("companion:resetUsage", (payload) => {
    resetUsage(payload?.id);
    return true;
  });
  handle("companion:builds", () => listBuilds());
  handle("companion:undoBuild", (payload) => {
    undoBuild(payload.buildId, payload.companionId);
    toast("info", "Undoing the build", "The companion is removing what it placed.");
    return true;
  });
  handle("companion:blueprints", () => {
    const bundled = hostResolve.BLUEPRINT_LIBRARY.map((entry) => {
      const size = hostResolve.blueprintSize(entry.blueprint);
      const bill = [...hostResolve.billOfMaterials(entry.blueprint)].sort((a, b) => b[1] - a[1]);
      return {
        id: entry.id,
        name: entry.blueprint.name,
        blurb: entry.blurb,
        category: entry.category ?? "building",
        width: size.width,
        height: size.height,
        depth: size.depth,
        blocks: bill.reduce((total, [, count]) => total + count, 0),
        materials: bill.slice(0, 12).map(([block, count]) => ({ block, count }))
      };
    });
    return [...bundled, ...listImports()];
  });
  handle("companion:importSchematic", async (payload) => {
    const name = payload.filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Imported structure";
    const loaded = await loadSchematic(payload.filePath, name);
    const id2 = `import:${node_crypto.randomUUID()}`;
    const summary = {
      id: id2,
      name: loaded.info.name,
      blurb: `Imported — ${loaded.info.width}x${loaded.info.height}x${loaded.info.length}, ${loaded.info.blockCount} blocks`,
      width: loaded.info.width,
      height: loaded.info.height,
      depth: loaded.info.length,
      blocks: loaded.info.blockCount,
      materials: loaded.info.materials.slice(0, 12),
      imported: true,
      notes: loaded.info.notes
    };
    rememberImport(id2, loaded.blueprint, summary);
    toast("success", `${summary.name} imported`, `${summary.blocks} blocks. Pick a companion and press Build.`);
    return summary;
  });
  handle("companion:build", (payload) => {
    const imported = getImport(payload.blueprintId);
    if (imported) {
      buildWithCompanion(payload.id, imported.blueprint, imported.summary.name);
      return true;
    }
    const entry = hostResolve.findLibraryBlueprint(payload.blueprintId);
    if (!entry) throw new LauncherError("NOT_FOUND", `no blueprint called ${payload.blueprintId}`);
    buildWithCompanion(payload.id, entry.blueprint, entry.blueprint.name);
    return true;
  });
  handle(
    "blueprints:export",
    async (payload) => {
      const imported = getImport(payload.blueprintId);
      const entry = imported ? null : hostResolve.findLibraryBlueprint(payload.blueprintId);
      if (!imported && !entry) {
        throw new LauncherError("NOT_FOUND", `no blueprint called ${payload.blueprintId}`);
      }
      const blueprint = imported?.blueprint ?? entry?.blueprint;
      const name = imported?.summary.name ?? entry?.blueprint.name ?? "structure";
      const fileName = `${safeFileName(name)}.${payload.format}`;
      if (payload.serverId) {
        const server2 = getHostedServer(payload.serverId);
        const root = hostedServerDir(payload.serverId);
        const world = await serverWorldName(root);
        const target2 = node_path.join(structuresDir(node_path.join(root, world)), fileName);
        const written2 = await exportBlueprint(blueprint, target2, payload.format, server2.minecraftVersion);
        toast(
          "success",
          `${name} sent to ${server2.name}`,
          payload.format === "nbt" ? `Place a structure block, set it to Load, and enter "${safeFileName(name).toLowerCase()}".` : "Saved into the server world. Note that a structure block only reads .nbt."
        );
        return written2;
      }
      if (!payload.instanceId) throw new LauncherError("INVALID_INPUT", "no export target given");
      const instance = getInstance(payload.instanceId);
      await ensureInstanceLayout(instance);
      const target = node_path.join(schematicsDir(instance.gameDir), fileName);
      const written = await exportBlueprint(blueprint, target, payload.format, instance.minecraftVersion);
      toast(
        "success",
        `${name} exported`,
        payload.format === "schem" ? `In game press M, load it, then Execute Operation → Paste Schematic in World. Loading alone only shows a hologram — it places no blocks.` : `Saved to the instance's schematics folder. For a structure block, export to a server instead.`
      );
      return written;
    }
  );
  handle("blueprints:setupLitematica", async (payload) => {
    const instance = getInstance(payload.instanceId);
    if (instance.loader === "vanilla") {
      throw new LauncherError("INVALID_INPUT", "litematica needs a mod loader", {
        title: "That instance has no mod loader",
        message: `Litematica is a client mod, so it needs Fabric, Forge or NeoForge. "${instance.name}" is vanilla.`,
        actions: ["Make a Fabric instance on the same Minecraft version", "Then set Litematica up on that one"]
      });
    }
    const installed = [];
    const missing = [];
    for (const [label, projectId] of [
      ["MaLiLib", "GcWjdA9I"],
      ["Litematica", "bEpr0Arc"]
    ]) {
      const versions = await listVersions(projectId, "mod", instance.minecraftVersion, instance.loader);
      if (versions.length === 0) {
        missing.push(label);
        continue;
      }
      await installVersionToInstance(instance, versions[0].versionId, "mod");
      installed.push(`${label} ${versions[0].versionNumber}`);
    }
    if (missing.length > 0 && installed.length === 0) {
      const anyLoader = await listVersions("bEpr0Arc", "mod", instance.minecraftVersion, null).catch(() => []);
      const loadersAvailable = [...new Set(anyLoader.flatMap((version) => version.loaders))];
      if (loadersAvailable.length > 0) {
        throw new LauncherError("NOT_FOUND", `litematica has no ${instance.loader} build`, {
          title: `Litematica does not support ${instance.loader} on ${instance.minecraftVersion}`,
          message: `There are builds for ${instance.minecraftVersion}, but only for ${loadersAvailable.join(" and ")} — "${instance.name}" is ${instance.loader}. Litematica stopped shipping Forge builds after 1.16.5, and no equivalent projection mod exists for modern Forge.`,
          actions: [
            "Export the blueprint as .nbt instead and place it with a structure block — that needs no mods at all",
            "Or have a companion build it, which works on any loader",
            `Litematica would work on a ${loadersAvailable[0]} instance, but a ${loadersAvailable[0]} client cannot join a ${instance.loader} server`
          ]
        });
      }
      throw new LauncherError("NOT_FOUND", "no litematica build for this version", {
        title: `No Litematica build for Minecraft ${instance.minecraftVersion}`,
        message: `${missing.join(" and ")} ${missing.length === 1 ? "has" : "have"} no release for this Minecraft version yet. Litematica usually follows a new Minecraft release by a few weeks.`,
        actions: [
          "Export as .nbt and use a structure block in the meantime",
          "Or have a companion build it instead"
        ]
      });
    }
    toast(
      "success",
      `Litematica set up on ${instance.name}`,
      `${installed.join(", ")}. Launch the game and press M to open it.`
    );
    return { installed, missing };
  });
  handle("companion:clearMemory", (payload) => {
    clearCompanionMemory(payload.id);
    toast("info", "Companion memory cleared");
    return true;
  });
  handle("companion:listModels", async (payload) => {
    const settings = getCompanion(payload.id);
    const apiKey2 = getSecret(`companion-llm-key-${payload.id}`) ?? "";
    try {
      return await hostResolve.listModels({ baseUrl: settings.baseUrl, apiKey: apiKey2, model: settings.model, timeoutMs: 2e4 });
    } catch (err) {
      llmFailure(err);
    }
  });
  handle("companion:testModel", async (payload) => {
    const settings = getCompanion(payload.id);
    const apiKey2 = getSecret(`companion-llm-key-${payload.id}`) ?? "";
    const started2 = Date.now();
    let reply;
    try {
      reply = await hostResolve.chat(
        { baseUrl: settings.baseUrl, apiKey: apiKey2, model: settings.model, timeoutMs: 3e4 },
        [
          { role: "system", content: "Reply with exactly the word: ready" },
          { role: "user", content: "Are you there?" }
        ],
        []
      );
    } catch (err) {
      llmFailure(err);
    }
    return {
      ok: true,
      ms: Date.now() - started2,
      model: settings.model,
      reply: (reply.content ?? "").trim().slice(0, 120)
    };
  });
  handle("crew:list", () => listCrews());
  handle("crew:create", (payload) => {
    const crew = createCrew(payload.name, payload.foremanId, payload.memberIds);
    toast("success", `Crew "${crew.name}" formed`, `${crew.memberIds.length + 1} companions, one in charge.`);
    return crew;
  });
  handle(
    "crew:update",
    (payload) => updateCrew(payload.id, payload.patch)
  );
  handle("crew:delete", (payload) => {
    deleteCrew(payload.id);
    toast("info", "Crew disbanded", "The companions themselves are untouched.");
    return true;
  });
  handle("crew:start", (payload) => {
    const result = startCrew(payload.id);
    if (result.started.length > 0) {
      toast("success", `${result.started.length} joining`, result.started.join(", "));
    }
    for (const failure of result.failed) {
      toast("warning", `${failure.username} could not start`, failure.reason);
    }
    return result;
  });
  handle("crew:stop", (payload) => {
    const stopped = stopCrew(payload.id);
    if (stopped.length > 0) toast("info", `${stopped.length} leaving`, stopped.join(", "));
    return stopped;
  });
  handle("crew:notes", (payload) => crewNotes(payload.id));
  handle("crew:clearNotes", (payload) => {
    clearCrewNotes(payload.id);
    return true;
  });
  handle("host:list", () => listHostedServers());
  handle("host:states", () => allHostedServerStates());
  handle("host:eulaUrl", () => MINECRAFT_EULA_URL);
  handle("host:software", () => listServerSoftware());
  handle("host:mods", (payload) => listServerMods(payload.id));
  handle("host:importMods", async (payload) => {
    const picked = await electron.dialog.showOpenDialog({
      title: "Add to the server",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Mod or plugin jars", extensions: ["jar"] }]
    });
    if (picked.canceled || picked.filePaths.length === 0) return 0;
    const added = await importServerMods(payload.id, picked.filePaths);
    if (added > 0) toast("success", `Added ${added} file${added === 1 ? "" : "s"}`, "Restart the server to load them");
    return added;
  });
  handle("host:toggleMod", async (payload) => {
    await setServerModEnabled(payload.id, payload.fileName, payload.enabled);
    return true;
  });
  handle("host:deleteMod", async (payload) => {
    await deleteServerMod(payload.id, payload.fileName);
    return true;
  });
  handle("host:installMod", async (payload) => {
    const result = await installServerModFromModrinth(payload.id, payload.versionId);
    toast("success", "Installed to the server", "Restart the server to load it");
    return result;
  });
  handle("host:openFolder", (payload) => {
    void electron.shell.openPath(hostedServerDir(payload.id));
    return true;
  });
  handle("host:syncMods", async (payload) => {
    const result = await syncServerModsToInstance(payload.id, getInstance(payload.instanceId));
    const message = result.copied.length === 0 ? `${result.instanceName} already had every mod` : `Copied ${result.copied.length} mod${result.copied.length === 1 ? "" : "s"} to ${result.instanceName}`;
    toast("success", message);
    return result;
  });
  handle(
    "host:joinTargets",
    (payload) => instancesThatCanJoin(getHostedServer(payload.id), listInstances())
  );
  handle("host:backups", async (payload) => await listServerBackups(payload.id));
  handle("host:backup", async (payload) => {
    const info = await backupHostedServer(payload.id);
    toast("success", "Snapshot taken", `${info.fileName} — ${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB.`);
    return info;
  });
  handle("host:restoreBackup", async (payload) => {
    await restoreServerBackup(payload.id, payload.fileName);
    toast("success", "World restored", "The world it replaced was snapshotted first. Start the server to play it.");
    return true;
  });
  handle("host:deleteBackup", async (payload) => {
    await deleteServerBackup(payload.id, payload.fileName);
    return true;
  });
  handle("host:restartSettings", (payload) => ({
    ...serverRestartSettings(payload.id),
    nextAt: nextRestartAt(payload.id)
  }));
  handle(
    "host:setRestartSettings",
    (payload) => ({
      ...setServerRestartSettings(payload.id, payload.patch),
      nextAt: nextRestartAt(payload.id)
    })
  );
  handle("host:backupSettings", (payload) => serverBackupSettings(payload.id));
  handle("host:inviteLink", async (payload) => {
    const server2 = getHostedServer(payload.id);
    const share = await shareDetails(payload.id);
    const address = share.publicAddress ?? share.localAddress;
    const [host, portText] = address.split(":");
    const loader = server2.software === "fabric" || server2.software === "forge" || server2.software === "neoforge" ? server2.software : "vanilla";
    return {
      link: buildJoinLink({
        host,
        port: Number(portText) || server2.port,
        name: server2.name,
        minecraftVersion: server2.minecraftVersion,
        loader
      }),
      address,
      isPublic: Boolean(share.publicAddress),
      note: share.publicAddress ? share.reachable === false ? "The public address did not answer from this machine, which is normal from inside your own network. Ask your friend to try it." : null : 'This link only works for people on your network. Use "Play with friends online" to open the port first.'
    };
  });
  handle("host:tunnelSettings", (payload) => tunnelSettings(payload.id));
  handle(
    "host:setTunnelSettings",
    (payload) => setTunnelSettings(payload.id, payload.patch)
  );
  handle("host:tunnelState", (payload) => tunnelState(payload.id));
  handle("host:startTunnel", (payload) => {
    const server2 = getHostedServer(payload.id);
    if (!server2.onlineMode) {
      throw new LauncherError("INVALID_INPUT", "refusing to relay an unverified server", {
        title: "This server does not check who joins",
        message: `"${server2.name}" has "Verify players with Mojang" switched off. Putting it behind a relay means anyone with the address can join under any name they like — including yours.`,
        actions: [
          'Turn "Verify players with Mojang" back on before opening it up',
          "A companion needs it off, so run the companion on a server you keep to your own network"
        ]
      });
    }
    return startTunnel(payload.id, server2.port);
  });
  handle("host:stopTunnel", (payload) => stopTunnel(payload.id));
  handle("links:pendingInvite", () => currentPendingInvite());
  handle(
    "links:acceptInvite",
    async (payload) => {
      const result = await acceptInvite(payload);
      takePendingInvite();
      return { instanceId: result.instance.id, instanceName: result.instance.name, address: result.address };
    }
  );
  handle(
    "host:setBackupSettings",
    (payload) => setServerBackupSettings(payload.id, payload.patch)
  );
  handle("host:stewards", (payload) => stewardsFor(payload.id));
  handle("host:deploySteward", (payload) => {
    const result = deploySteward(payload.id, payload.companionId);
    if (result.warning) {
      toast("info", `${result.companion.username} is assigned`, result.warning);
    } else {
      toast(
        "success",
        `${result.companion.username} is on the server`,
        result.created ? "Set up a model for it on the Companion screen so it can talk." : "It joins and leaves with the server from now on."
      );
    }
    return result;
  });
  handle("host:dismissSteward", (payload) => {
    const companion = dismissSteward(payload.companionId);
    toast("info", `${companion.username} left the server`, "The companion itself is still set up.");
    return companion;
  });
  handle("host:join", async (payload) => {
    const server2 = getHostedServer(payload.id);
    if (!isHostedServerRunning(payload.id)) {
      throw new LauncherError("NOT_FOUND", "that server is not running", {
        title: "Start the server first",
        message: "The game would have nothing to connect to.",
        actions: ["Press Start, wait for it to say ready, then Join"]
      });
    }
    const loader = server2.software === "fabric" ? "fabric" : server2.software === "neoforge" ? "neoforge" : server2.software === "forge" ? "forge" : "vanilla";
    let instance = payload.instanceId ? getInstance(payload.instanceId) : listInstances().find(
      (entry) => entry.minecraftVersion === server2.minecraftVersion && entry.loader === loader
    );
    if (!instance) {
      log$3.info(`no client for "${server2.name}"; making one on ${server2.minecraftVersion} ${loader}`);
      instance = await createInstance({
        name: `${server2.name} (client)`,
        minecraftVersion: server2.minecraftVersion,
        loader
      });
      toast("info", "Made a client for this server", `${instance.name} — matching ${server2.minecraftVersion} ${loader}.`);
    }
    if (!serverUsesPlugins(server2)) {
      try {
        const synced = await syncServerModsToInstance(server2.id, instance);
        if (synced.copied.length > 0) {
          toast(
            "success",
            "Matched the server's mods",
            `Copied ${synced.copied.length} into ${instance.name}: ${synced.copied.slice(0, 3).join(", ")}${synced.copied.length > 3 ? "…" : ""}`
          );
        }
      } catch (err) {
        log$3.warn(`could not copy server mods into "${instance.name}": ${err.message}`);
      }
    }
    return await launchInstance({ instanceId: instance.id, serverAddress: serverAddress(server2) });
  });
  handle("host:console", (payload) => getHostedServerConsole(payload.id));
  handle("host:save", (input) => saveHostedServer(input));
  handle("host:delete", async (payload) => {
    await deleteHostedServer(payload.id, payload.deleteWorld);
    toast("info", "Server removed");
    return true;
  });
  handle("host:install", (payload) => installHostedServer(payload.id));
  handle("host:acceptEula", (payload) => acceptEula(payload.id));
  handle("host:start", (payload) => startHostedServer(payload.id));
  handle("host:stop", (payload) => stopHostedServer(payload.id));
  handle("host:command", (payload) => {
    sendHostedServerCommand(payload.id, payload.command);
    return true;
  });
  assertAllChannelsHandled();
  log$3.info(`registered IPC handlers`);
}
function llmFailure(err) {
  if (!(err instanceof hostResolve.LlmError)) throw err;
  const message = err.message ?? "";
  const unknownModel = err.status === 404 || /模型不存在|model.*(not found|does not exist|not exist)|invalid model|unknown model/i.test(message);
  if (unknownModel) {
    throw new LauncherError("INVALID_INPUT", `the endpoint rejected the model name: ${message}`, {
      title: "That model name does not exist on this endpoint",
      message: "The endpoint answered and your key was accepted, but it does not serve a model by that name. Providers rename and retire models regularly.",
      actions: ['Press "Load models" next to the model box to see what this endpoint offers']
    });
  }
  const outOfCredit = /余额不足|资源包|请充值|insufficient balance|quota|out of credit|billing/i.test(message);
  if (outOfCredit) {
    throw new LauncherError("INVALID_INPUT", `the endpoint reported no available credit: ${message}`, {
      title: "That account has no credit for this call",
      message: "The endpoint accepted your key but reported an empty balance or no usable plan. A GLM Coding Plan only covers a call when the endpoint and the model both qualify — otherwise the call bills your wallet instead, which is what this message means.",
      actions: [
        'For a Coding Plan, choose the "GLM Coding Plan" provider in Setup',
        "That plan covers only GLM-4.7, GLM-5-Turbo and GLM-5.3",
        "Otherwise top up the wallet, or switch to Ollama which is free and local"
      ]
    });
  }
  if (err.status === 401 || err.status === 403) {
    throw new LauncherError("INVALID_INPUT", `the endpoint rejected the key: ${message}`, {
      title: "The endpoint rejected your API key",
      message: "The key was sent but refused.",
      actions: ["Check the key is for this provider", "GLM keys differ between the Chinese and international endpoints"]
    });
  }
  throw new LauncherError("UNKNOWN", message, {
    title: "The model endpoint returned an error",
    message: message.slice(0, 200),
    actions: ["Press Test to try again", "Check the endpoint URL in Setup"]
  });
}
function noteServerJoin(address) {
  const [host, port] = splitAddress(address);
  const match = listServers().find(
    (server2) => server2.address.toLowerCase() === host.toLowerCase() && server2.port === port
  );
  if (match) recordJoin(match.id);
}
const log$2 = createLogger("updater");
let started = false;
async function initAutoUpdate() {
  if (started) return;
  started = true;
  if (!electron.app.isPackaged) {
    log$2.info("skipping the update check: not a packaged build");
    return;
  }
  let autoUpdater;
  try {
    const module2 = await import("electron-updater");
    autoUpdater = module2.autoUpdater ?? module2.default?.autoUpdater;
  } catch (err) {
    log$2.warn("electron-updater is not available:", err.message);
    return;
  }
  if (!autoUpdater) {
    log$2.warn("electron-updater loaded but exposed no autoUpdater; skipping the update check");
    return;
  }
  const noFeedConfigured = /app-update\.yml|ENOENT|not packed|dev-app-update/i;
  autoUpdater.logger = {
    info: (message) => log$2.info(String(message)),
    warn: (message) => log$2.warn(String(message)),
    error: (message) => {
      const text = String(message);
      if (noFeedConfigured.test(text)) log$2.info(`no update feed configured (${text.slice(0, 80)})`);
      else log$2.error(text);
    },
    debug: (message) => log$2.debug(String(message))
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    log$2.info(`update available: ${info.version}`);
    toast("info", `Version ${info.version} is available`, "Downloading it in the background.");
  });
  autoUpdater.on("update-downloaded", (info) => {
    log$2.info(`update downloaded: ${info.version}`);
    toast("success", `Version ${info.version} is ready`, "It will be installed the next time you close NexusCraft.");
  });
  autoUpdater.on("error", (err) => {
    const message = err?.message ?? String(err);
    if (noFeedConfigured.test(message)) log$2.info("no update feed is configured; self-updating is off");
    else log$2.warn("update check failed:", message);
  });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log$2.info("no update feed configured, or it could not be reached");
  }
}
const log$1 = createLogger("tray");
let tray = null;
let refreshTimer = null;
let hooks = null;
function trayIconPath() {
  return electron.app.isPackaged ? node_path.join(process.resourcesPath, "icon.ico") : node_path.join(electron.app.getAppPath(), "build", "icon.ico");
}
function statusLines() {
  const lines = [];
  const games = runningInstanceIds().length;
  if (games > 0) lines.push(`${games} game${games === 1 ? "" : "s"} running`);
  const servers = allHostedServerStates().filter(
    (s) => s.status === "running" || s.status === "starting"
  ).length;
  if (servers > 0) lines.push(`${servers} server${servers === 1 ? "" : "s"} hosting`);
  const downloads = activeTasks().filter((t) => t.active && !t.paused);
  if (downloads.length > 0) {
    const pct = downloads[0].totalBytes > 0 ? ` ${Math.floor(downloads[0].downloadedBytes / downloads[0].totalBytes * 100)}%` : "";
    lines.push(
      downloads.length === 1 ? `Downloading ${downloads[0].label}${pct}` : `${downloads.length} downloads active`
    );
  }
  return lines.length > 0 ? lines : ["Idle"];
}
function rebuildMenu() {
  if (!tray || !hooks) return;
  const status2 = statusLines();
  tray.setToolTip(["NexusCraft", ...status2].join("\n"));
  tray.setContextMenu(
    electron.Menu.buildFromTemplate([
      { label: "Open NexusCraft", click: () => hooks?.showWindow() },
      { type: "separator" },
      ...status2.map((label) => ({ label, enabled: false })),
      { type: "separator" },
      { label: "Quit NexusCraft", click: () => hooks?.quit() }
    ])
  );
}
function initTray(newHooks) {
  if (tray) return;
  hooks = newHooks;
  const image = electron.nativeImage.createFromPath(trayIconPath());
  if (image.isEmpty()) {
    log$1.warn("tray icon could not be loaded; the tray will use a blank icon");
  }
  tray = new electron.Tray(image);
  tray.on("click", () => hooks?.showWindow());
  tray.on("double-click", () => hooks?.showWindow());
  rebuildMenu();
  refreshTimer = setInterval(rebuildMenu, 4e3);
  refreshTimer.unref();
  log$1.info("tray icon ready");
}
function destroyTray() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  tray?.destroy();
  tray = null;
  hooks = null;
}
const log = createLogger("main");
const isDev = !electron.app.isPackaged;
let wantsMicrophone = false;
function setMicrophoneWanted(wanted) {
  wantsMicrophone = wanted;
}
function microphoneWanted() {
  return wantsMicrophone;
}
const CSP = [
  "default-src 'self'",
  // Vite injects styles at runtime in both dev and production builds.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Images are inlined as data URLs by the main process; nothing remote loads.
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
  // The renderer never talks to the network directly — only the main process does.
  isDev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'none'"
].join("; ");
function applySecurityPolicies() {
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
        "X-Content-Type-Options": ["nosniff"]
      }
    });
  });
  const ALLOWED_PERMISSIONS = /* @__PURE__ */ new Set(["clipboard-sanitized-write"]);
  electron.session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const isMedia = permission === "media";
    const allowed = ALLOWED_PERMISSIONS.has(permission) || isMedia && microphoneWanted();
    if (!allowed) log.warn(`denied a "${permission}" permission request`);
    callback(allowed);
  });
  electron.session.defaultSession.setPermissionCheckHandler((_contents, permission) => {
    const isMedia = permission === "media";
    return ALLOWED_PERMISSIONS.has(permission) || isMedia && microphoneWanted();
  });
  electron.app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => {
      log.warn("blocked a webview attachment");
      event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void electron.shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      const isDevServer = isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "http://localhost");
      if (!isDevServer && !url.startsWith("file://")) {
        log.warn(`blocked navigation to ${new URL(url).origin}`);
        event.preventDefault();
      }
    });
  });
}
let mainWindow = null;
let quitting = false;
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
function createWindow() {
  const window = new electron.BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#070a10",
    // A frameless window lets the launcher draw its own title bar.
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // Blocks file:// pages from reading arbitrary local files.
      webSecurity: true,
      spellcheck: false
    }
  });
  trustWebContents(window.webContents);
  window.webContents.on("render-process-gone", (_event, details) => {
    log.error(`the renderer process stopped: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  window.webContents.on("unresponsive", () => log.warn("the renderer stopped responding"));
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.error(`the preload script failed to load (${preloadPath})`, error);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 3) log.error(`renderer console: ${message} (${sourceId}:${line})`);
  });
  window.once("ready-to-show", () => {
    window.show();
    if (isDev) window.webContents.openDevTools({ mode: "detach" });
  });
  window.on("close", (event) => {
    if (quitting || !getSettings().closeToTray) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    mainWindow = null;
  });
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  return window;
}
const separateDataDir = Boolean(process.env.NEXUSCRAFT_DATA_DIR?.trim());
const gotLock = separateDataDir || electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, argv) => {
    showMainWindow();
    const link = findLinkInArgv(argv);
    if (link) void handleDeepLink(link).catch((err) => log.error("a link could not be handled", err));
  });
  electron.app.on("open-url", (event, url) => {
    event.preventDefault();
    showMainWindow();
    void handleDeepLink(url).catch((err) => log.error("a link could not be handled", err));
  });
  electron.app.whenReady().then(async () => {
    if (process.platform === "win32") electron.app.setAppUserModelId("com.nexuscraft.launcher");
    const bootstrap = readBootstrap();
    const root = initPaths(bootstrap.dataDir ?? null);
    log.info(`NexusCraft starting — data directory: ${root}`);
    initDatabase();
    getSettings();
    applySecurityPolicies();
    registerIpcHandlers();
    initStewards();
    initBackupScheduler();
    initRestartScheduler();
    initModUpdateScheduler();
    initTunnels();
    mainWindow = createWindow();
    initTray({
      showWindow: showMainWindow,
      quit: () => electron.app.quit()
    });
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
    void restoreSession();
    setTimeout(() => {
      void initAutoUpdate().catch((err) => log.warn("the update check failed to start:", err));
    }, 8e3);
    initPresence();
    registerProtocol();
    const startupLink = findLinkInArgv(process.argv);
    if (startupLink) {
      mainWindow.webContents.once("did-finish-load", () => {
        void handleDeepLink(startupLink).catch((err) => log.error("a startup link could not be handled", err));
      });
    }
  });
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") electron.app.quit();
  });
  electron.app.on("before-quit", () => {
    quitting = true;
    log.info("shutting down");
    destroyTray();
    shutdownPresence();
    cancelAll();
    shutdownCompanion();
    void shutdownHostedServers();
    shutdownTunnels();
    closeDatabase();
    closeLogger();
    setTimeout(() => {
      log.info("shutdown took too long; exiting anyway");
      process.exit(0);
    }, 5e3).unref();
  });
}
process.on("uncaughtException", (err) => {
  log.error("uncaught exception in the main process", err);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection in the main process", reason);
});
exports.setMicrophoneWanted = setMicrophoneWanted;
exports.stopAll = stopAll;
