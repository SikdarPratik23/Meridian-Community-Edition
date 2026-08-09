# Meridian Community Edition — A Journal for Geographers

Meridian Community Edition is built for people who want a private, lasting, and practical way to record life, field notes, observations, and memories without depending on cloud subscriptions or internet access. It is meant for general-purpose use and for the wider community: you are welcome to fork it, use it freely, adapt it, and contribute if you want to improve it. The app is fully local-first, so your journal stays on your own device and works offline, whether you prefer pen and paper or a digital space for reflection. I built this mainly for myself, but I made it public because I believe useful tools should be shared, improved, and used openly.

A local-first, offline-capable **field journal for geographers**. You write Markdown entries, optionally pin them where you are, and attach photos (audio is coming). It's a **journal app first** — the map is a small supporting view, not the centre of attention. Built with React 19, TypeScript, Vite, MapLibre GL, and SQLite (running in your browser via WebAssembly). Your data lives **only** in your browser until you choose to export it, and a local sync server can keep a PC and phone in step over your home WiFi (or from anywhere via Tailscale). It reads and writes Bengali (বাংলা) and other scripts, exports to GeoJSON/GPX for GIS tools, and offers field-journal templates.

Everything is a single kind of thing: a **journal entry**. Each entry is your Markdown writing, and can optionally carry a **place** (a location + place name), a **date you choose** (so you can write for a past day), and media. "Place" isn't a separate item type — it's just the location attached to an entry. (A legacy `place` type still exists in the database for backward compatibility, but new entries are all journal entries.)

---

## Quick start & full walkthrough

Meridian has three moving parts, and it helps to know which does what:

| Part | What it is | Where it runs |
|---|---|---|
| **The app** | The journal you write in (HTML/JS) | On **your PC**, opened in the browser (or hosted yourself on any static site) |
| **Your data** | Every entry + photo | **Only on your device**, in the browser's database — never on any server |
| **The sync server** | The little relay that copies entries PC ↔ phone | On **your PC** (started by `Start Meridian.bat`), on port `8787` |

> **Your writing is always local.** Creating and editing entries works fully offline, in a browser tab or the installed app, with or without internet. Sync is a separate, optional layer — it never gates your ability to write.

### 1 · Start it on your PC

You need **Node.js** installed once (LTS from <https://nodejs.org/>). Then **double-click `Start Meridian.bat`** in the project root. The first launch installs dependencies (a few minutes, once), then opens two windows:

- **Meridian** — the app, at `http://localhost:5173`
- **Meridian Sync Server** — keep this open while syncing; it prints **every address for this PC** (see below)

Keep both windows open while you use Meridian. Closing a window (or `Ctrl+C`) stops that part.

### 2 · The addresses (the sync-server window prints these live)

`app` = the URL you open in a browser · `sync` = the server address you paste into the app's Sync panel. Your `192.168.x` (WiFi) address is handed out by your router and **can change** — always trust the address the sync-server window prints. Example values:

| Where you are | app (open in browser) | sync (server address) |
|---|---|---|
| **On this PC** | `http://localhost:5173` | `http://localhost:8787` (automatic) |
| **Same WiFi** (no Tailscale) | `http://<your-pc-ip>:5173`¹ | `http://<your-pc-ip>:8787` |
| **Away, Tailscale IP** | `http://<your-tailscale-ip>:5173` | `http://<your-tailscale-ip>:8787` |
| **Away, Tailscale HTTPS**² | your hosted HTTPS app URL | `https://<your-pc>.tailXXXX.ts.net` |

¹ Read the `<your-pc-ip>` values live from the **Meridian Sync Server** window — it prints this PC's actual addresses on startup.
² The HTTPS sync URL needs `server/Start Sync Server (Internet).bat` (it runs `tailscale serve` + the server) and Tailscale signed in on both devices. See `server/TAILSCALE-SETUP.md`.

### "Why do the addresses look confusing?"

The exact URLs vary by setup. On this PC they will be whatever `Start Meridian.bat` prints. Two things stay true no matter what:

- If you also publish the app somewhere online (see [Deploying it on the web](#deploying-it-on-the-web)), you get extra URLs from that host. Pick **one** and always use the same one — your journal is stored **per web address**, so opening a *different* URL behaves like a brand-new, empty app; you'd have to Export/Import or sync to see your entries there.
- The sync-server window always shows the correct addresses for **this** computer, right now.

### 3 · Install it on your phone (as an app)

Pick **one** of these two setups — they can't be mixed, because a browser will **not** let a page loaded over **https** talk to a plain **http** server ("mixed content"):

**Setup A — recommended (works home *and* away):**
1. On the phone, open your **HTTPS app URL** — the one from wherever you published the app (see [Deploying it on the web](#deploying-it-on-the-web)) — in Chrome (Android) or Safari (iPhone). (Always use the same URL, per the note above.)
2. Install it: iPhone → Share → **Add to Home Screen**; Android → menu → **Install app / Add to Home screen**. (An https address gives a real installed, offline-capable app.)
3. Turn **Tailscale on** on both the phone and the PC, and start the PC with `server/Start Sync Server (Internet).bat`.
4. In the app: **Data → Sync**, role **Phone**, **Primary address** = the HTTPS sync URL the server window prints (e.g. `https://<your-pc>.tailXXXX.ts.net`), **Connect**, tick **Auto-sync**. (On the same WiFi, Tailscale still routes directly over your LAN, so it's fast.)

**Setup B — same WiFi only, no Tailscale:**
1. On the phone (same WiFi as the PC), open the LAN app address the sync-server window prints (e.g. `http://192.168.x.x:5173`) in the browser. *(This is an `http` page, so it's allowed to reach the `http` LAN sync server. The phone may create a shortcut rather than a full offline app for an `http` address — that's the trade-off.)*
2. **Data → Sync**, role **Phone**, **Primary address** = the LAN sync address from the window, **Connect**, tick **Auto-sync**.

> **Set-once tip:** if you want the fallback to happen automatically, open the app over **http** (the LAN URL), set **Primary** = your Tailscale HTTPS URL and **Same-WiFi address (fallback)** = your LAN `http://192.168.x.x:8787`. Meridian tries the primary first and drops to the same-WiFi address on its own when Tailscale isn't reachable — so you never edit it again moving between home and away.

### Pair your phone by QR (the quick way)

Instead of typing the addresses on the phone, you can scan them in one go:

1. On the **PC**, open **Data → Sync**, fill in the **Primary address** (and optionally the same-WiFi fallback + token) as above, then click **📱 Pair a phone**.
2. A **QR code** appears. Above it, the **"App address the phone opens"** is the URL the phone will launch — leave it as your HTTPS app URL for the recommended https setup, or change it to the LAN app address for the same-WiFi-only setup.
3. On the **phone**, point the **camera** at the QR and open the link. Meridian launches, fills in the sync address, role (**Phone**) and token for you, and starts syncing. A green **"📱 Paired…"** bar confirms it.

The QR just encodes a link back to the app with the addresses as parameters — nothing secret beyond what you'd type by hand, and it's only ever scanned by your own phone. **Manual entry always stays available** (steps 1–2 above); the QR is only a shortcut, and you can re-pair the same way any time your WiFi/IP changes.

### 4 · On the PC side

In the PC's browser (`http://localhost:5173`) → **Data → Sync**, role **PC**, address `http://localhost:8787`, **Connect**. Auto-sync is on by default; the **Sync** button at the top of the sidebar forces a one-off sync any time. If nothing seems to move, check that *both* devices show a reachable address and **"Last synced …"** — a device pointed at an unreachable address (e.g. the Tailscale URL while Tailscale is off) can neither send nor receive.

### Moving the data folder

If you want the shared journal file somewhere else on the PC, run `server/Choose Data Folder.bat` and pick a new folder, then restart Meridian so the sync server picks up the new location.

---

## Run it on your computer (easiest)

You need **Node.js** installed once. If you don't have it, get the **LTS** version from <https://nodejs.org/> and install it (default options are fine).

Then just **double-click `Start Meridian.bat`** (there's one in this `atlas` folder and one in the project root — either works).

What it does automatically:

1. Checks that Node.js is available.
2. Installs dependencies the first time (this takes a few minutes — only happens once).
3. Starts the app and opens it in your browser at `http://localhost:5173`.

Keep the black command window open while you use Meridian. Closing it (or pressing `Ctrl+C`) stops the app. To use Meridian again later, just double-click the file again — after the first run it starts in a few seconds.

> Tip: right-click `Start Meridian.bat` → *Send to* → *Desktop (create shortcut)* to launch it from your desktop. You can change the shortcut's icon to `public/favicon.svg`.

### Testing the "real" (production / offline) version

Double-click **`Preview Production Build.bat`**. This builds the optimized bundle and serves it the same way the deployed site behaves — this is the mode where the PWA / offline caching and "install to home screen" work.

---

## Using Meridian

- **Allow location access** when the browser asks — Meridian uses your GPS so new entries are pinned where you are. (You can still write entries if you decline; they just won't be auto-located, and they simply won't show a map pin.)
- Use the **+ New entry** button in the left sidebar to start writing. Entries are written and read full-size in the main area.
- **Entries are titled by their date automatically** — there's no title to fill in. If you want to give a particular entry a custom name, use the optional **Name this entry** field further down the editor; leave it blank and the entry stays titled by its date (and re-titles itself if you change the date).
- Set the **🗓️ Date & time** field to journal for any day — it defaults to now, but you can pick a past date (the "Now" button resets it). Entries sort on the timeline by that date.
- **🖼️ Add image here** drops a photo (or several) **inline, right where your cursor is** in the text — so a picture can sit between paragraphs, exactly where you want it. Each image gets an optional **caption**, and clicking any image when reading expands it full-screen.
- **🎤 Dictate** (mic button, bottom-right of the writing box) turns speech into text at the cursor, hands-free. Availability depends on the browser (best in Chrome/Edge); it simply doesn't appear where unsupported. The language it listens for is set in **Settings → Dictation** (defaults to your device language; includes **বাংলা** / Bengali for India and Bangladesh, plus English, Hindi and German).
- **🗒️ Insert template** (dropdown above the writing hints) drops a ready-made field-journal outline at your cursor — **Field observation, Species sighting, Geology note, Weather log,** or **Travel day** — then you just fill in the blanks.
- **Write in any language, including Bengali (বাংলা).** Meridian bundles proper Bengali fonts (offline, no internet needed), so Bengali text reads cleanly in both the editor and the finished entry.
- **🗺️ Set location on map** lets you place the entry by clicking the map (it expands so you can aim); or press **Use current** to take your GPS position, and **Clear** to leave it unlocated.
- Name the spot in the **Place name** field — that's how a "place" is captured (folded into the entry, not a separate item). When you set a location, Meridian **auto-fills this name** for you (e.g. "Erlangen") if online lookups are on; just type to override it.
- You **don't have to write Markdown by hand** — plain text works, and any Markdown you do use (headings, **bold**, lists) is rendered automatically when you read the entry.
- The **map is a small card in the top-right** — click an entry and the map flies to it; press **⤢ Expand** to enlarge the map, **✕ Minimize map** to shrink it again.
- Browse with the left-sidebar tabs: **Timeline** (entries by month, with a **List / Tiles** toggle), **Search**, **Data**, and **Settings**.
- **Settings** holds your details (name, title, home region) and a few preferences: **coordinate format** (decimal degrees or D°M′S″), temperature unit, **dictation language** (for the 🎤 mic — including Bengali), the **map's default zoom** (how tightly the map zooms in when you select an entry, drop a pin, or locate yourself — City → Street → Building), whether to **look up place names online** (turn off to stay fully offline), auto-fill on pin drop, and the welcome screen's seasonal animation / daily prompt. Everything is stored only in this browser and isn't part of journal exports.
- The **welcome screen** greets you by name, shows today's date and **local season**, names where you are (with a short Wikipedia blurb + photo when online lookups are on), surfaces **"On this day"** past entries, a daily writing prompt, and a **geographer's almanac** — a fresh geography fact each reload (some computed from your own coordinates, e.g. your antipode or distance from the equator). On wider screens these cards lay out side-by-side; on a phone they stack.
- Data autosaves to your browser every 10 seconds and on close.

> **Quick check:** to see exactly what has been recorded, open the **Data** tab. It lists every entry with all of its stored fields, a per-record "view raw record" toggle (the literal JSON that is saved), and a **Copy JSON** button for the whole dataset. Expand **"Where & how is this stored?"** at the top of that tab for a short version of the section below.

---

# Your data: where, how, and what

This section is the heart of the documentation: it explains **where** your data physically lives, **how** it is stored, **what** the structure is, and **how to inspect it** yourself.

## There are no files on disk (and where export would fit)

A natural assumption is that entries are saved as files on disk. **They are not.** Meridian has **no cloud backend and writes no files to your computer from the browser** — everything is kept inside the browser (details below).

> Media you place in `public/data/` (see that folder's README) is the one exception — those are files *you* drop in to reference from entries by URL. They are not where your entries are stored.

**JSON export/import works today** (Data tab → **Export all** / **Import file**) — this is the manual backup path and also a way to move entries between devices when you do not use the local sync server (see the quick-start section above). **GeoJSON and GPX export also work now** (Data tab → **🗺️ Export for maps & GIS**): a `.geojson` (for QGIS/ArcGIS, EPSG:4326, `[lon, lat]`) and a `.gpx` (for Google Earth / handheld GPS), generated on demand from located entries. A **Markdown bundle** export is still on the roadmap.

## Where it is stored

| Layer | What it is |
|---|---|
| **In memory (while open)** | A SQLite database running in the page via WebAssembly (`sql.js`). All reads/writes happen here first — instant, no network. |
| **On disk (persistent)** | The whole SQLite database is serialized to a byte array and saved into the browser's **IndexedDB**. This is per-browser, per-device, and survives reloads and restarts. |

Exact IndexedDB location:

- **Database name:** `atlas.db`
- **Object store:** `db`
- **Key:** `data`
- **Value:** a `Uint8Array` — the full SQLite file, as bytes.

> Because it's per-browser: clearing site data / "cookies and site data" for this origin **erases your entries**, and a different browser or device starts empty. There's no automatic sync — use **Export / Import** (below) to move entries between devices, and as your backup.

## Moving entries between your PC and phone

There is **no cloud server** — each browser keeps its own private copy until you export/import or sync it through the local PC server. To carry entries across (or to back them up):

1. On the source device, open the **Data** tab → **⬇ Export all**. You get a `meridian-backup-YYYY-MM-DD.json` file with every entry (images included).
2. Move that file to the other device however you like — email it to yourself, drop it in a cloud drive, or use a cable.
3. On the target device, open the **Data** tab → **⬆ Import file** and pick it.

Importing **merges by entry id with a timestamp check**: new entries are added, and for an entry that exists on both sides the **newer copy (by `updated_at`) wins** — an older file can't overwrite a newer edit. This makes it safe to re-run and to import in **both directions**; both devices converge on the latest version of each entry. Nothing is uploaded anywhere — you move the file yourself (cable, Bluetooth / Quick Share, etc.).

## How it is stored (the write path)

1. You save an entry → it's written to the in-memory SQLite `events` table (`INSERT`/`UPDATE`).
2. The database is exported to bytes and `put()` into IndexedDB. This happens **immediately on every save**, again on a **10-second autosave** timer, and once more on **`beforeunload`** (closing/refreshing the tab).
3. On next launch, Meridian loads the bytes back from IndexedDB and reopens the same database.

Relevant code:

- `src/data/db.ts` — SQLite init, the `events` schema, all CRUD, and IndexedDB persistence (`persistDb` / `loadPersisted`).
- `src/store/atlas.ts` — in-memory app state (Zustand) that mirrors the DB for the UI.
- `src/types/index.ts` — the TypeScript shape of every record (below).

## What is stored — the schema

Everything is **one table, `events`** — every journal entry and place is a row, distinguished by its `type`. Columns that don't apply to a given type are simply left `NULL` (e.g. a place has no `mood`). The table still contains a few unused legacy columns from earlier versions (e.g. `amount`); they're harmless and simply stay `NULL`.

### Shared columns (every record has these)

| Column | Type | Meaning |
|---|---|---|
| `id` | TEXT (UUID) | Unique id (`crypto.randomUUID()`). |
| `type` | TEXT | One of `journal` \| `place`. |
| `title` | TEXT | Short headline shown on the map/timeline. Defaults to the entry's formatted date; an optional custom name typed in the editor overrides it. |
| `timestamp` | TEXT (ISO 8601) | When the event happened / was recorded. |
| `longitude` | REAL | **GeoJSON order** — longitude first. EPSG:4326. |
| `latitude` | REAL | Latitude. |
| `location_name` | TEXT? | Optional human-readable place name. |
| `tags` | TEXT (JSON array) | e.g. `["travel","work"]`. |
| `created_at` | TEXT (ISO) | Row creation time. |
| `updated_at` | TEXT (ISO) | Last edit time. |

### Type-specific columns

| Column | Type | Used by | Meaning |
|---|---|---|---|
| `content_markdown` | TEXT | journal | The entry body (Markdown). |
| `mood` | TEXT | journal | e.g. "thoughtful". |
| `weather_condition` | TEXT | journal | e.g. "clear". |
| `weather_temperature` | REAL | journal | °C. |
| `media_attachments` | TEXT (JSON array) | journal, place | Media attached to the entry. Each item: `{ id, kind: 'image'\|'audio', mime, name, data }` where `data` is a data URL. **Images are live** (attached via 🖼️ Add image); audio capture is still pending (see Roadmap). |
| `visited` | INTEGER (0/1) | place | Whether you've been there. |
| `rating` | INTEGER | place | 1–5 stars. |

> **Coordinate convention (important for the GIS side):** internally and on export, coordinates are always **`[longitude, latitude]`** (GeoJSON / EPSG:4326). The UI *displays* them human-readably with cardinal hints, e.g. `49.4521° N, 11.0767° E` (see `formatLatLng` in `src/utils/index.ts`), but the stored values are signed decimals in `[lon, lat]` order.

### Example record (what one row looks like as JSON)

```json
{
  "id": "f7c1…-uuid",
  "type": "journal",
  "title": "Morning by the Pegnitz",
  "timestamp": "2026-06-14T08:12:00.000Z",
  "longitude": 11.0767,
  "latitude": 49.4521,
  "location_name": "Nuremberg",
  "tags": ["walk", "river"],
  "content_markdown": "Cool air, low water…",
  "mood": "calm",
  "media_attachments": [],
  "created_at": "2026-06-14T08:12:03.114Z",
  "updated_at": "2026-06-14T08:12:03.114Z"
}
```

## How to inspect your data yourself

You have three ways, from easiest to most technical:

1. **In the app → Data tab.** Friendly per-record view of every populated field, a raw-JSON toggle per record, and **Copy JSON** for the whole dataset. Best for a quick "what did I record?" check.
2. **Browser DevTools (no code).** Open DevTools (F12) → **Application** → **IndexedDB** → **`atlas.db`** → **`db`** → key `data`. You'll see the stored bytes. To read the rows as a table, use the **Console**: the app keeps the live data in memory, so you can also just read the Data tab.
3. **SQL, offline.** Export the database bytes (roadmap) or grab them from IndexedDB and open the file in any SQLite tool (e.g. **DB Browser for SQLite**) to run `SELECT * FROM events;`. The bytes in IndexedDB *are* a valid `.sqlite` file.

---

# Roadmap — planned data & how it will be recorded

These are wanted features, documented here so the data model and intent are clear before they're built. Each notes **how the data should be recorded** so storage stays consistent with the schema above.

### 🎙️ Dictation (speech-to-text) — ✅ done

- **What it does:** a 🎤 button in the Journal editor (bottom-right of the writing box). Tap it, speak, and the transcript is inserted as **plain text at the cursor** in `content_markdown` — no new column; a dictated entry is just an ordinary journal entry whose body happened to be spoken. Tap again to stop.
- **How:** the browser's built-in **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`), no upload. Availability varies by browser (best in Chrome/Edge); where unsupported the button is hidden and you simply type.
- **Possible next step:** optionally also save an audio recording of the dictation as a media attachment (see below).

### 🖼️🎧 Media attachments (images & audio; **video deferred**)

- **Images: ✅ done.** Attach photos from the editor (**🖼️ Add image**); they're stored in `media_attachments` as data URLs and shown as a gallery in the reader.
- **Audio: pending.** Playback already works if an audio attachment exists, but there's **no record/upload button yet** — that's the next media task (a 🎤 control in the editor, same `MediaAttachment` shape with `kind: 'audio'`).
- **Video is intentionally out of scope for now** — large files would bloat browser storage; revisit later, likely only once a real backend exists.
- **Storage note:** images are embedded as base64 data URLs inside the browser database, so very large photos add up. Fine for journaling; a future backend would move big binaries out.
- **Formats are open-ended.** The image picker uses `accept="image/*"` (audio will use `audio/*`), so the browser takes common types (JPEG, PNG, WebP, GIF, SVG; MP3, WAV, OGG, M4A, WebM) rather than a fixed list. The file's MIME type is stored so previews/playback adapt.
- **How it's stored:** each attachment is a descriptor in the `media_attachments` JSON array — `{ id, kind, mime, name, data }` — saved **inside the SQLite/IndexedDB database** (not as a loose file). `data` is currently a base64 data URL; a future option for very large files is a separate blob store referenced by `id`.
- **Storage caution:** browser storage is finite, so large media adds up — this is why video is deferred. When export lands, attachments will be bundled so nothing is trapped in the browser.

### ✍️ Markdown "cues" / embeds

- **Inline image embeds: ✅ done.** Images are placed inline in the body where you add them, via an `![caption](attachment:<id>)` tag that resolves to the bytes stored in `media_attachments`. The text stays small and readable (only a short id, not the base64), captions are the Markdown alt text, and clicking an image opens a full-screen lightbox. Multiple images can sit under any section of text.
- **Still planned:** a **location link** cue that flies the map to where a photo was taken when clicked, and fenced **code/script** blocks. Both build on the Markdown rendering already in place.

### Other planned items

- **Export:** JSON is **done** (Data tab; also used for PC↔phone transfer). **GeoJSON** (EPSG:4326, `[lon, lat]`, for QGIS/ArcGIS) and **GPX** (Google Earth / GPS) are **done** too (Data tab → 🗺️ Export for maps & GIS). Still planned: a Markdown bundle.
- **Reverse geocoding** to auto-fill `location_name` on pin drop. (The **welcome screen already** turns your current coordinates into a place name and a short Wikipedia blurb + photo — read-only lookups to public services that fail soft to coordinates when offline; auto-filling an *entry's* `location_name` is the remaining piece.)
- **FastAPI + PostGIS backend** for multi-device sync — deferred by design (front-end first).
- **Multiple independent users on the same WiFi** — not supported yet. The smallest change would be to give each user their own sync namespace so the PC server keeps one shared journal file per user instead of one file for everyone. The least invasive version would be:
  - a user name or profile chosen in the app,
  - a per-user sync file or folder on the PC,
  - and a per-user sync token or share code so only the intended devices connect.

  Possible implementation options, from smallest to biggest:
  1. **Per-user file path only.** Keep the current two-device sync model, but let each user point at a different server file/folder. This is the least invasive change.
  2. **User namespace in the transport.** Add `userId` or `journalId` to the sync URL and store separate JSON files server-side. This keeps the UI mostly the same, but makes the server explicitly multi-tenant.
  3. **Real accounts.** Add sign-in or invite codes and isolate each journal on the backend. This is the cleanest long-term model, but it is the biggest change.

---

## For developers (manual commands)

```bash
npm install      # one-time
npm run dev      # start dev server with hot reload  (http://localhost:5173)
npm run build    # type-check + production build into /dist
npm run preview  # serve the built /dist locally
npm run lint     # eslint
```

### Project structure

```
src/
  components/   MainPane (journal-first layout), map (MapLibre), sidebar UI
  features/     journal, places, timeline, data (domain modules)
  data/db.ts    SQLite (sql.js / WASM) + IndexedDB persistence  ← storage lives here
  store/        Zustand global state
  hooks/        useGeolocation
  types/        shared TypeScript interfaces  ← the record schema
  utils/        id, date, and coordinate helpers
```

### Code map

`useAtlasStore` in `atlas/src/store/atlas.ts` is the central hub everything routes through; the storage layer lives in `atlas/src/data/db.ts`.

---

## Deploying it on the web

The app is a static site (no server needed) and ships with `vercel.json` already configured for single-page-app routing.

**Vercel (simplest):**
1. Push this `atlas` folder to a Git repo (GitHub/GitLab).
2. Import the repo at <https://vercel.com>. Framework preset: **Vite**.
3. Build command `npm run build`, output directory `dist`. Deploy.

**Netlify:** build command `npm run build`, publish directory `dist`, and add a redirect rule `/* /index.html 200` (or a `_redirects` file with that line).

**Any static host (GitHub Pages, S3, nginx, etc.):** run `npm run build` and upload the contents of `dist/`. Make sure unknown routes fall back to `index.html`.

After deploying over HTTPS, the PWA becomes installable ("Add to Home Screen" on mobile, install icon in the desktop address bar) and works offline.

---

## Notes & current limitations

- **All data is local to the browser.** Clearing site data / browser storage erases entries. Use **Data → Export all / Import file** (JSON) to back up and to move entries manually between devices; use the local sync server started by `Start Meridian.bat` to keep a PC and phone in step over WiFi. **Copy JSON** is a quick clipboard copy. **GeoJSON / GPX export** work today (Data tab → 🗺️ Export for maps & GIS); a Markdown bundle is still on the roadmap.
- **Inline images and dictation work today.** Images embed inline in your text (with captions and click-to-expand), and the 🎤 mic dictates speech into the entry. Audio *capture* and the remaining Markdown cues (location links, code blocks) are still on the roadmap; the `media_attachments` field already holds images and will hold audio.
- Earlier versions had **expense** and **book** entry types; these have been removed to keep Meridian a focused journal app. A few now-unused columns remain in the database table but are ignored.
- A **FastAPI + PostGIS backend** for sync is planned but intentionally not built yet (front-end first, per the project brief).
- Map tiles come from OpenStreetMap; offline tile availability depends on what you've already viewed (cached by the service worker).
