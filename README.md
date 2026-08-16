# NexusCraft Launcher

A modern, Windows-first launcher for **Minecraft: Java Edition**, built with Electron, TypeScript, React and Vite.

NexusCraft manages fully isolated instances, installs mod loaders, downloads and verifies game files straight from Mojang, picks the right Java runtime, and launches the real game as a child process using your own Microsoft account.

> **You need to own Minecraft: Java Edition.** NexusCraft signs in through Microsoft's official OAuth flow and checks your licence against Mojang's entitlement API on every sign-in. It contains no offline-mode bypass, no cracked accounts and no way to play without a valid licence.

---

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuring Microsoft authentication](#configuring-microsoft-authentication)
  - [Getting your app approved by Mojang](#getting-your-app-approved-by-mojang)
- [Building the Windows installer](#building-the-windows-installer)
- [Project layout](#project-layout)
- [How it works](#how-it-works)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Legal](#legal)

---

## What it does

| Area | Behaviour |
|---|---|
| **Sign-in** | Microsoft OAuth 2.0 — device code or PKCE loopback. Xbox Live → XSTS → Minecraft services chain. Live entitlement check. |
| **Instances** | Fully isolated game directories. Mods, worlds, resource packs, shaders, screenshots and configs never mix. |
| **Versions** | Live from Mojang's `version_manifest_v2`. Releases, snapshots and old betas. Nothing is hardcoded. |
| **Mod loaders** | Fabric and Quilt via their metadata APIs; Forge and NeoForge by running their official installers. |
| **Java** | Detects existing runtimes, or downloads the exact runtime Mojang ships for the version. |
| **Downloads** | Concurrent, SHA-1 verified, resumable queue with pause, cancel, retry-failed-only, live speed and ETA. |
| **Mods** | Reads `fabric.mod.json`, `quilt.mod.json`, `mods.toml`, `neoforge.mods.toml` and `mcmod.info`. Flags loader mismatches and duplicate mod IDs before they crash the game. |
| **Servers** | Real Server List Ping over TCP, with SRV resolution. Status, player count, MOTD, favicon and latency. Imports `servers.dat`. |
| **Worlds** | Parses `level.dat` NBT for name, version, game mode and last played. Streaming ZIP backups that never block the UI. |
| **Skins** | Library of saved skins, applied through Mojang's official profile API. |

---

## Requirements

- **Windows 10 or 11** (the codebase is cross-platform, but packaging targets Windows)
- **Node.js 20 or newer** — [nodejs.org](https://nodejs.org)
- **A Microsoft account that owns Minecraft: Java Edition**
- An **Azure application (client) ID**, and **Mojang's approval for that app** — both free, see below.
  Without the approval, sign-in reaches Xbox Live and then fails with HTTP 403.

Java is **not** a prerequisite: NexusCraft downloads the runtime Mojang publishes for whichever version you play.

---

## Quick start

```bash
git clone <your-repo-url> nexuscraft-launcher
cd nexuscraft-launcher

npm install          # also rebuilds native modules for Electron
npm run dev          # start in development with hot reload
```

On first launch the app walks you through the whole setup: welcome → Microsoft sign-in → licence check → version choice → instance creation → download → play.

Before signing in, set your Azure client ID in **Settings → Sign-in**, or export it:

```bash
# PowerShell
$env:NEXUSCRAFT_CLIENT_ID = "your-client-id"; npm run dev
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Typecheck, then bundle main, preload and renderer into `out/` |
| `npm start` | Preview the production bundle |
| `npm run typecheck` | Typecheck both the Node and the browser sides |
| `npm run build:win` | Build and produce the NSIS installer in `release/` |
| `npm run build:dir` | Build an unpacked app directory (fast, no installer) |
| `node scripts/generate-icon.js` | Regenerate `build/icon.ico` from code |

---

## Configuring Microsoft authentication

NexusCraft needs an **Azure application (client) ID** to identify itself to Microsoft. This is a *public identifier*, not a secret — it is safe to paste into the app, commit in a private config, or ship in a build. There is no client secret anywhere in this project, because a desktop app cannot keep one.

### Create one

1. Sign in to the [Azure portal](https://portal.azure.com) with any Microsoft account.
2. Go to **Microsoft Entra ID → App registrations → New registration**.
3. **Name:** anything, e.g. `NexusCraft Launcher`.
4. **Supported account types:** select **Personal Microsoft accounts only**.
   Minecraft: Java Edition accounts are personal Microsoft accounts.
5. Leave **Redirect URI** empty for now. Click **Register**.
6. Open the new app → **Authentication**:
   - Scroll to **Advanced settings → Allow public client flows** and set it to **Yes**. This is required for the device code flow.
   - *Only if you want the browser redirect flow:* click **Add a platform → Mobile and desktop applications** and tick `http://localhost`.
7. Go to **Overview** and copy the **Application (client) ID**.

### Getting your app approved by Mojang

**A client ID on its own is not enough, and this step catches everyone out.**

Since 2022, Mojang requires every Azure application to be individually approved before it may call the Minecraft
services API. Until your app is approved, sign-in behaves like this:

1. Microsoft sign-in succeeds ✅
2. Xbox Live authorises the account ✅
3. `api.minecraftservices.com/authentication/login_with_xbox` returns **HTTP 403** ❌

Because the first two steps work, it looks like an Azure misconfiguration — it isn't. NexusCraft detects this exact
case and reports it as *"This Azure app is not approved for Minecraft yet"* rather than a generic failure.

**Apply here:** <https://aka.ms/mce-reviewappid> — supply your Azure application (client) ID.
Mojang's guidance: <https://help.minecraft.net/hc/en-us/articles/16254801392141>

Approval is free and is a one-time step **for the application**, not for each player. Turnaround is typically several
days. Nothing in the launcher needs changing afterwards — the same client ID simply starts working.

### Give it to the launcher

Either paste it into **Settings → Sign-in → Azure application (client) ID**, or set the environment variable:

```bash
NEXUSCRAFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

The environment variable takes precedence, which is how you ship a packaged build with a client ID baked in.

### Choosing a sign-in method

| Method | How it feels | Azure setup |
|---|---|---|
| **Device code** (default) | A short code is shown; you enter it on Microsoft's page in your browser | Only "Allow public client flows" |
| **Browser redirect** | Browser opens, you sign in, it returns automatically | Also needs `http://localhost` as a redirect URI |

Both are official OAuth flows in which **credentials are only ever typed into Microsoft's own web page**. The launcher never sees, requests or stores a password.

---

## Building the Windows installer

```bash
npm run build:win
```

This produces, in `release/`:

- `NexusCraft Launcher-1.0.0-Setup.exe` — NSIS installer with a directory picker, Start Menu and desktop shortcuts
- an unpacked `win-unpacked/` directory for inspection

Configuration lives in [`electron-builder.yml`](electron-builder.yml).

### Code signing

Unsigned installers trigger a SmartScreen warning. To sign, uncomment in `electron-builder.yml`:

```yaml
win:
  certificateFile: ./cert.pfx
  certificatePassword: ${env.CSC_KEY_PASSWORD}
```

then build with `CSC_KEY_PASSWORD` set. For EV or Azure Trusted Signing, see the [electron-builder code signing docs](https://www.electron.build/code-signing).

### Portable build

```bash
npx electron-builder --win portable
```

### A note on native modules

`better-sqlite3` is an **optional** dependency. `npm install` runs `electron-builder install-app-deps` to rebuild it for Electron, and `asarUnpack` keeps it loadable from the packaged app.

If the compiled module cannot load on a given machine, the launcher does **not** crash: it probes the module in a throwaway child process at startup and silently falls back to an equivalent JSON-backed store. The verdict is cached, so the probe costs one process spawn per install. Everything works identically either way — check **Settings → About** to see which backend is active.

---

## Project layout

```
src/
├── shared/                      # contracts used by every process
│   ├── types.ts                 # domain model (deliberately token-free)
│   ├── channels.ts              # IPC allowlist, zero dependencies
│   └── ipc.ts                   # zod schema per channel
│
├── preload/index.ts             # the only bridge: invoke + subscribe, nothing else
│
├── main/
│   ├── index.ts                 # lifecycle, window, security policies
│   ├── core/                    # paths, logger, errors, database, http, events
│   ├── ipc/                     # validated handler registry
│   └── services/
│       ├── auth/                # OAuth, Xbox chain, secure token storage
│       ├── minecraft/           # manifest, rules, installer, argument builder
│       ├── loaders/             # Fabric, Quilt, Forge, NeoForge
│       ├── java/                # detection and Mojang runtime installs
│       ├── downloads/           # concurrent verified download manager
│       ├── instances/           # instance CRUD and preparation
│       ├── launch/              # process spawn, tracking, log capture
│       ├── mods/                # jar metadata parsing and conflict detection
│       ├── content/             # resource packs, shaders, screenshots
│       ├── worlds/              # NBT parsing and backups
│       ├── servers/             # Server List Ping
│       ├── skins/               # profile skin API
│       └── backup/              # streaming ZIP writer
│
└── renderer/src/
    ├── api.ts                   # typed client over the preload bridge
    ├── store/useStore.ts        # zustand state + event subscriptions
    ├── components/              # logo, background, skin renderer, UI primitives
    └── screens/                 # Home, Play, Instances, Versions, Mods,
                                 # Worlds, Servers, Skins, Account, Settings
```

---

## How it works

### Launching a game

1. **Prepare** — ensure the instance's directory layout exists.
2. **Resolve the version** — install the mod loader profile if needed, then flatten the `inheritsFrom` chain into one resolved version.
3. **Verify** — check the client jar, every rule-filtered library and the asset index; download whatever is missing, with SHA-1 verification.
4. **Check mods** — block the launch if an enabled mod would certainly crash it (wrong loader, duplicate mod ID), with an explanation naming the files.
5. **Select Java** — instance override → global override → managed runtime → detected runtime → download Mojang's.
6. **Build arguments** — evaluate Mojang's rule-gated JVM and game argument lists, substitute placeholders, apply memory and window settings.
7. **Spawn** — start `javaw.exe` as a child process in the instance's game directory.
8. **Track** — stream stdout and stderr into a bounded log buffer, watch for exit, record playtime, and bring the launcher back to the foreground.

The launcher stays fully responsive throughout: downloads stream, hashing is incremental, ZIP compression is async, and the UI only ever receives progress events.

### Instance isolation

Every instance owns `instances/<uuid>/minecraft/`, containing its own `mods`, `saves`, `resourcepacks`, `shaderpacks`, `screenshots`, `config` and `logs`. That directory is passed as `--gameDir`, so Minecraft itself has no path back to any other instance. Shared, content-addressed data (versions, libraries, assets, Java runtimes) is stored once at the data root and never mutated per instance.

Filesystem operations driven by renderer input pass through `assertInside()`, which resolves the target and rejects anything that escapes its parent directory.

---

## Security model

Electron's recommended posture, applied and verified:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`
- The preload exposes exactly two functions — `invoke` and `on` — both restricted to the shared allowlist. It imports **no third-party code**, so it stays loadable in the sandbox.
- Every IPC request is validated against a zod schema before a handler runs. Unknown channels are refused at registration time; unknown senders are refused at call time.
- Strict CSP with **no remote origins**. Fonts are bundled; skins, capes, mod icons, world thumbnails and server favicons are all fetched by the main process and passed to the renderer as data URLs. The renderer makes no network requests of its own.
- `will-navigate` and `setWindowOpenHandler` block navigation and popups. External links go to the system browser, restricted to a known host allowlist.
- Permission requests are denied by default.

### Handling of credentials

- **No password is ever seen, requested or stored.** Credentials are entered on Microsoft's own page.
- Only the OAuth **refresh token** is persisted, encrypted with Electron `safeStorage` (Windows DPAPI, keyed to the logged-in Windows user). If the OS cannot provide encryption, the launcher **refuses to write the token in plaintext** and asks you to sign in again next session.
- Minecraft access tokens live in main-process memory only, never in the database, never over IPC, never in the renderer.
- The logger redacts bearer tokens, JWTs, MSA tokens and OAuth query parameters from every line, and launch arguments are written to disk with the access token stripped.

---

## Troubleshooting

**"Microsoft sign-in is not configured"**
No client ID. See [Configuring Microsoft authentication](#configuring-microsoft-authentication).

**"Microsoft rejected this application ID"**
The app registration is missing **Allow public client flows**, or is not set to *Personal Microsoft accounts only*.

**"This Azure app is not approved for Minecraft yet" (HTTP 403 at the last step)**
Your Azure app has not been approved by Mojang. Sign-in and Xbox Live both succeed; only the final Minecraft call is
refused. Apply at <https://aka.ms/mce-reviewappid>. See [Getting your app approved by Mojang](#getting-your-app-approved-by-mojang).

**"No Minecraft: Java Edition on this account"**
The entitlement API reported no access for the signed-in account. Check you used the right Microsoft account. Game Pass accounts must launch Minecraft once from the official launcher to activate the entitlement.

**"No Xbox profile on this account"**
Sign in at minecraft.net once in a browser to create the Xbox Live profile, then retry.

**Mod loader installation failed**
Forge and NeoForge run their own installer, which needs Java and write access to the data directory. Check the loader build matches the Minecraft version, and that antivirus is not blocking Java.

**A download keeps failing its checksum**
Almost always antivirus rewriting files mid-download. Add the data directory to your exclusions and press **Retry**.

**Minecraft closes immediately**
Open the launch log from the Play screen. The last few lines are captured on abnormal exit. Mods are the usual cause — disable recent additions, or use **Repair instance** to re-verify every file.

Logs live in `<data folder>/logs/launcher.log`, reachable from **Settings → About → Open logs folder**. They contain no tokens.

---

## Legal

NexusCraft is an independent project. It is **not affiliated with, endorsed by, or associated with Mojang Studios or Microsoft**. Minecraft is a trademark of Mojang Studios.

Game files are downloaded from Mojang's official servers, and authentication uses Microsoft's official identity platform. You must own Minecraft: Java Edition to play.

Licensed under the MIT Licence.
