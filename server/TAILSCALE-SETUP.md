# Syncing your phone and PC over the internet (Tailscale)

Meridian already syncs your phone and PC over the **same WiFi**. This guide adds
the one missing piece: reaching your PC **from anywhere** — a café, mobile data,
another city — without putting your journal in anyone else's cloud.

## The idea in one paragraph

Your PC keeps running the little sync server (it holds the one true copy of your
journal). **Tailscale** builds a private, encrypted network between *your own*
devices — this PC and your phone. When they're on the same WiFi, Tailscale talks
to them **directly** over the LAN (no internet). When they're apart but both
online, it builds an encrypted tunnel between them. Tailscale never stores your
journal — it's just the pipe. If the PC is off, the phone keeps working offline
and syncs the moment the PC is back, exactly like today.

```
Same WiFi / hotspot          Phone  ─── direct LAN ───►  PC   (no internet)
Apart, both online           Phone  ─ encrypted tunnel ─►  PC  (via Tailscale)
PC off                       Phone  works offline, queues, syncs when PC returns
```

Your PC's Tailscale address (printed at the top of the sync-server window when it starts): **`<your-pc>.tailXXXX.ts.net`**

---

## One-time setup

### 1. Enable HTTPS certificates (PC, in the browser — 30 seconds)

The Meridian app is served over **https://** (from your hosting provider), and browsers refuse to
let an https page talk to a plain `http://` address. Tailscale fixes this by giving
your PC a real HTTPS certificate for `<your-pc>.tailXXXX.ts.net`. You just have to
switch it on once:

1. Open the Tailscale admin console: <https://login.tailscale.com/admin/dns>
2. Confirm **MagicDNS** is **enabled** (it already is on your tailnet).
3. Find **HTTPS Certificates** and click **Enable HTTPS**.

That's the only setting change. It's free on the Personal plan.

### 2. Install Tailscale on your phone

1. Install **Tailscale** from the App Store / Play Store.
2. Sign in with the **same account** you use on this PC.
3. Toggle it **on**. Your phone joins your private network automatically.

### 3. Start the server with the internet door open (PC)

Double-click **`Start Sync Server (Internet).bat`** (next to this file).

It does two things:
- runs the normal sync server on port 8787, and
- runs `tailscale serve --bg 8787`, which publishes
  `https://<your-pc>.tailXXXX.ts.net` → your local server, with a valid certificate.

Leave the window open while syncing (just like the normal launcher).

### 4. Point the phone at your PC (in Meridian)

On the phone, in the Meridian app:

1. Go to **Data → 🔄 Sync**.
2. Set the device role to **Phone**.
3. Enter the server address:

   ```
   https://<your-pc>.tailXXXX.ts.net
   ```

   (No port number — Tailscale serves it on the standard HTTPS port 443.)
4. If you set a `SYNC_TOKEN` on the PC, enter the same token here.
5. Tap **Connect**, then tick **Auto-sync**.

On the PC's own browser you can keep using `http://localhost:8787` (device role
**PC**) — localhost doesn't have the https restriction.

Done. The phone now syncs to your PC whether you're on the same WiFi or on the
other side of the world.

---

## Keeping the PC "always on"

For the phone to sync while you're out, the PC must be awake and running the
server. Options, easiest first:

- **Leave the PC on** and keep the launcher window open.
- **Prevent sleep:** Settings → System → Power → Screen and sleep → set *"When
  plugged in, put my device to sleep"* to **Never**.
- **Auto-start on login (optional):** press `Win+R`, type `shell:startup`, and drop
  a shortcut to `Start Sync Server (Internet).bat` into that folder. Now it starts
  whenever you log in.

The `--bg` flag means the Tailscale HTTPS door stays open across reboots on its
own; only the Node server needs the launcher.

---

## How this maps to "same WiFi still works with no internet"

You don't have to choose. With both devices on Tailscale:
- On the **same WiFi/hotspot**, Tailscale detects the direct LAN path and uses it —
  no internet round-trip, full speed, works even if the router has no internet.
- **Apart**, it falls back to an encrypted tunnel over the internet.

So a single address (`https://<your-pc>.tailXXXX.ts.net`) works everywhere, and you
never re-type the old `http://192.168.x.x:8787` LAN address again. (That LAN address
still works too, if you ever want it — it's printed in the server window.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phone says "couldn't reach the server" | Is the PC awake with the launcher window open? Is Tailscale **on** on both devices (check the Tailscale app)? |
| Browser blocks the request / cert warning | HTTPS Certificates not enabled yet — do step 1. Then restart the launcher so `tailscale serve` re-provisions the cert. |
| `serve` errors in the launcher | Run `"C:\Program Files\Tailscale\tailscale.exe" serve status` to see current config; `… serve reset` clears it and you can re-run the launcher. |
| Works on WiFi but not on mobile data | Make sure the phone's Tailscale toggle is ON (mobile VPNs / battery savers sometimes drop it). |
| Want to close the internet door | Run `"C:\Program Files\Tailscale\tailscale.exe" serve reset`. LAN sync via `http://192.168.x.x:8787` still works. |

---

## Security notes

- Only devices signed into **your** Tailscale account can reach the server. This is
  `tailscale serve` (tailnet-private), **not** `tailscale funnel` (public internet) —
  nothing here is exposed to strangers.
- Traffic between your phone and PC is encrypted end-to-end by WireGuard.
- For a second layer, set a `SYNC_TOKEN` on the PC (see the main `README.md`) so even
  a device on your tailnet needs the shared token to sync.
- Your journal data never leaves your two devices — Tailscale relays only encrypted
  packets when a direct connection isn't possible, and stores none of it.
