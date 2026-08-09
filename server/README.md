# Meridian local sync server

A tiny, zero-dependency Node server that holds your journal's shared sync file on
**your PC**. Your phone and the PC's browser sync to it over your home WiFi — no
cloud, no accounts, no third-party software. All the merge + photo-trim logic lives
in the app (`atlas/src/data/sync.ts`); this server is just the rendezvous point.

## Run it

You need Node installed (you already do — the app uses it).

```powershell
cd server
node sync-server.mjs
```

…or double-click **`Start Sync Server.bat`**. Leave the window open while you sync.
(It also starts automatically when you launch the app with `Start Meridian.bat`.)

The window prints where your data is stored and the addresses to use:

```
On this PC's browser:  http://localhost:8787
On your phone (same WiFi):
    http://192.168.x.x:8787
```

## Choosing where your data is stored

By default the journal file is `server/data/meridian-journal.json`. To put it
somewhere else (Documents, a USB drive, a OneDrive/Drive folder for auto-backup):

- Double-click **`Choose Data Folder.bat`**, pick a folder, and restart the server.
- Your existing journal is copied into the new folder automatically.
- The choice is remembered in `server/storage-config.json` (a machine-local file,
  not committed to Git). Delete that file to fall back to the default folder.

Resolution order: `DATA_FILE` env var → `storage-config.json` → `./data/`.

Settings (optional, via environment variables):

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | Port to listen on |
| `DATA_FILE` | _(see above)_ | Full path override for the sync file |
| `SYNC_TOKEN` | _(none)_ | If set, requests must send `Authorization: Bearer <token>` |

## Reaching it from your phone (same WiFi)

1. Make sure the phone and PC are on the **same WiFi network**.
2. Read the `http://192.168.x.x:8787` address from this server's window.
3. In Meridian on the phone → **Data → 🔄 Sync** → set the device to **Phone**,
   enter that address, tap **Connect**, and tick **Auto-sync**.
4. On the PC's browser, use `http://localhost:8787` with the device set to **PC**.

If Windows asks, allow Node.js on **Private networks** so the phone can reach it.

## Reaching it from anywhere (over the internet)

Same-WiFi sync needs nothing extra. To also sync when your phone and PC are on
**different networks** — mobile data, a café, another city — without putting your
data in any cloud, use **Tailscale** (a free private mesh network between your own
devices). Your PC keeps the only copy; Tailscale is just an encrypted pipe.

- On the same WiFi it still connects **directly over the LAN** (no internet).
- Apart, it builds an encrypted tunnel between the two devices.
- The phone uses one address everywhere: `https://<your-pc>.tailXXXX.ts.net`.

Full step-by-step (including the one HTTPS toggle that lets the https app talk to
your PC) is in **`TAILSCALE-SETUP.md`**. Start it with
**`Start Sync Server (Internet).bat`** instead of the plain launcher.

## Notes

- **Two devices, last-write-wins per entry.** Each sync sends a fully merged file,
  and auto-sync re-merges on the next tick, so the two devices converge.
- **The PC is the home.** If the PC/server is off, the phone keeps working offline
  and syncs when the PC is back.
- Writes are atomic (temp file + rename), so a crash mid-write can't corrupt your
  data.
