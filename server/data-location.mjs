// Where Meridian's shared journal file is stored.
//
// The sync server keeps ONE JSON file (meridian-journal.json) that every device
// syncs into. By default it lives in ./data next to this server, but you can move
// it anywhere — Documents, a USB drive, a OneDrive/Drive folder — by running
// "Choose Data Folder.bat". That choice is remembered in storage-config.json.
//
// Resolution order (first match wins):
//   1. DATA_FILE env var  — explicit full-path override (tests / advanced use)
//   2. storage-config.json's dataDir + meridian-journal.json  — your chosen folder
//   3. ./data/meridian-journal.json  — the default

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const CONFIG_PATH = join(here, 'storage-config.json');
export const DATA_FILE_NAME = 'meridian-journal.json';
const DEFAULT_DIR = join(here, 'data');

/** The folder currently chosen for storage (config, else the default). */
export function getDataDir() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg && typeof cfg.dataDir === 'string' && cfg.dataDir.trim()) {
      return resolve(cfg.dataDir);
    }
  } catch {
    // no config yet, or unreadable — fall back to the default
  }
  return DEFAULT_DIR;
}

/** Full path to the journal file the server should read/write. */
export function resolveDataFile() {
  if (process.env.DATA_FILE) return resolve(process.env.DATA_FILE);
  return join(getDataDir(), DATA_FILE_NAME);
}

/**
 * Point storage at `newDir` and remember it. To make sure no entries appear to
 * vanish, the existing journal is copied into the new folder when the new folder
 * doesn't already have one. Returns a small summary for the caller to print.
 */
export function setDataDir(newDir) {
  const target = resolve(newDir);
  const currentFile = resolveDataFile(); // where data lives BEFORE we switch
  mkdirSync(target, { recursive: true });
  const newFile = join(target, DATA_FILE_NAME);

  let migrated = false;
  if (existsSync(currentFile) && !existsSync(newFile) && currentFile !== newFile) {
    copyFileSync(currentFile, newFile);
    migrated = true;
  }

  writeFileSync(CONFIG_PATH, JSON.stringify({ dataDir: target }, null, 2), 'utf8');
  return { target, newFile, migrated };
}
