# Meridian Community Edition — Start here

You need **nothing but Node.js** (one-time) and a double-click to start journaling.

## 1. Check whether you already have Node.js

Meridian auto-checks this for you — **`Start Meridian.bat` will tell you.** Still, to check yourself:

- **Windows:** open a Command Prompt (type `cmd` in the Start menu) and run:
  ```
  node --version
  npm --version
  ```
- If both print a version number, **you're done — skip step 2 and just start Meridian**.
- If you get *"'node' is not recognized..."* or an empty result, you need to install it (step 2).

## 2. Install Node.js (only if it's missing)

Go to <https://nodejs.org/> and download the **LTS** version for your computer. Install it with the default options. You can close any window that opens at the end.

> Already have Node.js? Just start Meridian — the launcher checks for it automatically and skips straight to running.

## 3. Start Meridian

Double-click **`Start Meridian.bat`** in this folder.

The first launch installs dependencies and takes a few minutes — this only happens once. Then two windows open:

- **Meridian** — your journal, opens in the browser automatically at `http://localhost:5173`
- **Meridian Sync Server** — keep this open; its window lists every address for this PC

Keep both windows open while you use Meridian. Close them (or press `Ctrl+C`) to stop.

## 4. Using it on your phone (optional)

On the **same WiFi**, open the address printed in the **Meridian Sync Server** window (e.g. `http://192.168.x.x:5173`) on your phone. Everything else you need to know — syncing, installing the app, exporting, and using it — is in the [full README](README.md).

---

**Your writing stays on your device.** Meridian keeps its journal only in your browser — there is no cloud, no account, and no server storing your words unless you start the optional sync the README describes.