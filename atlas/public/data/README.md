# `data/` — optional media drop folder

This is where you put files that Meridian should load **from disk** (as opposed to
attaching them through the browser UI). It lives under `public/`, so everything here is
served by the app at the matching URL:

| File on disk | URL inside the app |
|---|---|
| `public/data/images/kaiserburg.jpg` | `/data/images/kaiserburg.jpg` |
| `public/data/audio/voice-note.m4a`  | `/data/audio/voice-note.m4a`  |

## Folders

- **`images/`** — photos / pictures for entries. Open-ended formats (JPEG, PNG, WebP, GIF, SVG, …).
- **`audio/`** — voice notes / audio clips. Open-ended formats (MP3, WAV, OGG, M4A/AAC, WebM, …).
- *(Video is intentionally not included for now — large files; revisit later.)*

## How entries reference these files

Most media is added straight from the editor: the **🖼️ Add image** button picks a file from
your device and stores it *inside the database* (as a data URL). **You don't need this folder
for that.** It's only the alternative for files you'd rather keep on disk and reference by URL —
e.g. in a journal entry's Markdown:

```markdown
![Kaiserburg at dusk](/data/images/kaiserburg.jpg)
```

> Note: expense tracking and spreadsheet import were removed — Meridian is a focused journal
> app (journal entries with location + images; audio coming). Coordinates follow the app's
> convention: **`[longitude, latitude]`**, EPSG:4326.
