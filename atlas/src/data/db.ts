import type { Database, SqlJsStatic } from 'sql.js';
import type { AnyEvent, EventType, JournalEntry, Place, MediaAttachment } from '../types';
import { mirrorToFile } from './fileLink';

const DB_NAME = 'atlas.db';

let db: Database | null = null;
let SQL: SqlJsStatic | null = null;
let ready: Promise<void> | null = null;

/** Debounce persistDb so rapid sequential saves coalesce into one write. */
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _persistDirty = false;

async function loadPersisted(): Promise<Uint8Array | null> {
  try {
    const dbs = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = dbs.transaction('db', 'readonly');
    const store = tx.objectStore('db');
    const val = await new Promise<Uint8Array | undefined>((res) => {
      const req = store.get('data');
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(undefined);
    });
    dbs.close();
    return val ?? null;
  } catch {
    return null;
  }
}

/** Write the current DB to IndexedDB (and linked file). Debounced: multiple
 *  rapid calls coalesce into one write, avoiding N full DB exports per sync.
 *  Callers that need immediate durability should await flushDb() instead. */
async function _writeNow() {
  if (!db) return;
  _persistDirty = false;
  const data = db.export();
  const dbs = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('db');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = dbs.transaction('db', 'readwrite');
  const store = tx.objectStore('db');
  store.put(data, 'data');
  tx.oncomplete = () => dbs.close();
  void mirrorToFile(data);
}

function persistDb() {
  _persistDirty = true;
  if (_persistTimer) return; // already queued
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    void _writeNow();
  }, 200);
}

/** Force an immediate persist, bypassing the debounce. Safe to await for
 *  beforeunload or when durability is required right now. */
export async function flushDb() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  if (_persistDirty) await _writeNow();
}

/** Create the schema if it doesn't exist yet. Idempotent. */
function applySchema(target: Database) {
  target.run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    location_name TEXT,
    tags TEXT DEFAULT '[]',
    content_markdown TEXT,
    mood TEXT,
    weather_condition TEXT,
    weather_temperature REAL,
    media_attachments TEXT DEFAULT '[]',
    trip TEXT,
    amount REAL,
    currency TEXT,
    expense_category TEXT,
    visited INTEGER,
    rating INTEGER,
    isbn TEXT,
    author TEXT,
    pages INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`);
  target.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`);
  target.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);
  // Migration: databases created before soft-delete lack the `deleted_at`
  // column. Add it on the fly so existing journals gain delete-sync support
  // without losing data. ALTER throws if the column already exists — ignore that.
  if (!hasColumn(target, 'events', 'deleted_at')) {
    try { target.run(`ALTER TABLE events ADD COLUMN deleted_at TEXT`); } catch { /* already present */ }
  }
  // Migration: the `trip` column (manual trip/expedition tagging) was added later.
  if (!hasColumn(target, 'events', 'trip')) {
    try { target.run(`ALTER TABLE events ADD COLUMN trip TEXT`); } catch { /* already present */ }
  }
}

/** Whether `table` has a column named `column` (used to gate migrations). */
function hasColumn(target: Database, table: string, column: string): boolean {
  const res = target.exec(`PRAGMA table_info(${table})`);
  if (!res.length) return false;
  const nameIdx = res[0].columns.indexOf('name');
  return res[0].values.some((row) => row[nameIdx] === column);
}

/**
 * Open raw bytes as a SQLite database, *verifying* they really are one. A blob
 * that isn't a valid SQLite file constructs without error but throws "file is not
 * a database" on the first real query — so we touch the catalog here to surface
 * that immediately, before the bad handle can replace good data.
 */
function openValidated(bytes: Uint8Array): Database {
  if (!SQL) throw new Error('DB not initialized');
  const candidate = new SQL.Database(bytes);
  try {
    candidate.exec('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    candidate.close();
    throw new Error('The file is not a readable SQLite database.', { cause: e });
  }
  return candidate;
}

/** Stash an unreadable blob under a side key so it's never silently destroyed. */
async function backupCorruptBlob(bytes: Uint8Array): Promise<void> {
  try {
    const dbs = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = dbs.transaction('db', 'readwrite');
    tx.objectStore('db').put(bytes, 'data_corrupt_backup');
    await new Promise<void>((res) => { tx.oncomplete = () => res(); });
    dbs.close();
  } catch {
    // best-effort; never block startup on this
  }
}

/**
 * Replace the in-memory database with the contents of a file (its raw SQLite
 * bytes), e.g. after the user opens or reconnects a linked file. Validates the
 * bytes FIRST and throws on an invalid file, so a wrong/corrupt file can never
 * overwrite the good in-memory database. Only persists once the swap succeeds.
 */
export function replaceDbFromBytes(bytes: Uint8Array) {
  const candidate = openValidated(bytes); // throws on a non-database file
  db?.close();
  db = candidate;
  applySchema(db);
  // Persist immediately rather than on the 200 ms debounce. Swapping the whole
  // database (opening a file, reconnecting, loading a linked file) is exactly when
  // the new contents must reach IndexedDB before anything can interrupt — a crash
  // or a tab closed right after would otherwise lose them until the next autosave.
  persistDb();
  void flushDb();
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export async function initDb() {
  if (ready) return ready;
  ready = (async () => {
    // Load sql.js (and resolve its WASM binary URL) lazily, so this ~large engine
    // is its own chunk fetched at startup rather than bloating the initial bundle.
    const [{ default: initSqlJs }, { default: sqlWasmUrl }] = await Promise.all([
      import('sql.js'),
      import('sql.js/dist/sql-wasm.wasm?url'),
    ]);
    SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const persisted = await loadPersisted();
    if (persisted) {
      try {
        db = openValidated(persisted);
      } catch (e) {
        // A corrupt/invalid saved blob must NOT brick the app. Keep the bad bytes
        // under a backup key (in case they're recoverable) and start fresh, so the
        // app always boots. The on-disk linked file / sync can then restore data.
        console.warn('Saved database was unreadable; starting a fresh one.', e);
        await backupCorruptBlob(persisted);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    applySchema(db);

    setInterval(persistDb, 10000);
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => void flushDb());
    }
  })();
  return ready;
}

/** Parse a JSON-array column defensively: a malformed value yields [] instead of
 *  throwing, so a single bad row can never blow up `getAllEvents()` (which would
 *  brick startup). saveEvent always writes valid JSON; this guards external/legacy
 *  or partially-written data. */
function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function rowToEvent(row: Record<string, unknown>): AnyEvent {
  const base = {
    id: row.id as string,
    type: row.type as EventType,
    title: row.title as string,
    timestamp: row.timestamp as string,
    longitude: row.longitude as number,
    latitude: row.latitude as number,
    location_name: row.location_name as string | undefined,
    tags: parseJsonArray<string>(row.tags),
    trip: (row.trip as string | null) || undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string | null) || undefined,
  };
  switch (base.type) {
    case 'journal':
      return {
        ...base,
        type: 'journal',
        content_markdown: (row.content_markdown as string) || '',
        mood: row.mood as string | undefined,
        weather_condition: row.weather_condition as string | undefined,
        weather_temperature: row.weather_temperature as number | undefined,
        media_attachments: parseJsonArray<MediaAttachment>(row.media_attachments),
      } as JournalEntry;
    case 'place':
      return {
        ...base,
        type: 'place',
        visited: (row.visited as number) === 1,
        rating: row.rating as number | undefined,
        media_attachments: parseJsonArray<MediaAttachment>(row.media_attachments),
      } as Place;
    default:
      return base as AnyEvent;
  }
}

function rowsToEvents(rows: { columns: string[]; values: unknown[][] }): AnyEvent[] {
  return rows.values.map((v: unknown[]) => {
    const obj: Record<string, unknown> = {};
    rows.columns.forEach((col: string, i: number) => { obj[col] = v[i]; });
    return rowToEvent(obj);
  });
}

/** Every live entry, for display. Tombstones (soft-deleted) are hidden. */
export function getAllEvents(): AnyEvent[] {
  const rows = getDb().exec('SELECT * FROM events WHERE deleted_at IS NULL ORDER BY timestamp DESC');
  if (!rows.length) return [];
  return rowsToEvents(rows[0]);
}

/**
 * Every record INCLUDING tombstones — what sync operates on, so deletions
 * propagate to the other device. Never use this for display; use getAllEvents.
 */
export function getAllRecords(): AnyEvent[] {
  const rows = getDb().exec('SELECT * FROM events ORDER BY timestamp DESC');
  if (!rows.length) return [];
  return rowsToEvents(rows[0]);
}

export function getEvent(id: string): AnyEvent | null {
  const stmt = getDb().prepare('SELECT * FROM events WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return rowToEvent(row);
  }
  stmt.free();
  return null;
}

export function saveEvent(event: AnyEvent) {
  const d = getDb();
  const existing = d.exec('SELECT id FROM events WHERE id = ?', [event.id]);
  const now = new Date().toISOString();
  // Respect the event's own timestamps when present (so imported entries keep
  // their real created/updated times and merge correctly); fall back to now for
  // freshly composed entries that don't carry them yet.
  const createdAt = event.created_at || now;
  const updatedAt = event.updated_at || now;

  if (existing.length && existing[0].values.length) {
    d.run(`UPDATE events SET
      title = ?, timestamp = ?, longitude = ?, latitude = ?,
      location_name = ?, tags = ?, trip = ?, content_markdown = ?, mood = ?,
      weather_condition = ?, weather_temperature = ?, media_attachments = ?,
      visited = ?, rating = ?, updated_at = ?, deleted_at = ?
      WHERE id = ?`, [
      event.title, event.timestamp, event.longitude, event.latitude,
      event.location_name || null, JSON.stringify(event.tags), event.trip || null,
      (event as JournalEntry).content_markdown || null,
      (event as JournalEntry).mood || null,
      (event as JournalEntry).weather_condition || null,
      (event as JournalEntry).weather_temperature ?? null,
      JSON.stringify((event as JournalEntry).media_attachments || []),
      event.type === 'place' ? ((event as Place).visited ? 1 : 0) : null,
      (event as Place).rating ?? null,
      updatedAt, event.deleted_at || null,
      event.id,
    ]);
  } else {
    d.run(`INSERT INTO events (
      id, type, title, timestamp, longitude, latitude, location_name, tags, trip,
      content_markdown, mood, weather_condition, weather_temperature, media_attachments,
      visited, rating, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      event.id, event.type, event.title, event.timestamp, event.longitude, event.latitude,
      event.location_name || null, JSON.stringify(event.tags), event.trip || null,
      (event as JournalEntry).content_markdown || null,
      (event as JournalEntry).mood || null,
      (event as JournalEntry).weather_condition || null,
      (event as JournalEntry).weather_temperature ?? null,
      JSON.stringify((event as JournalEntry).media_attachments || []),
      event.type === 'place' ? ((event as Place).visited ? 1 : 0) : null,
      (event as Place).rating ?? null,
      createdAt, updatedAt, event.deleted_at || null,
    ]);
  }
  persistDb();
}

/**
 * Soft-delete: turn the row into a *tombstone* rather than removing it, so the
 * deletion can travel through sync and remove the entry on the other device too.
 * The heavy fields (content, photos) are cleared — a tombstone only needs its id,
 * type/title, and a fresh `updated_at`/`deleted_at` to win the newest-wins merge.
 * The row stays hidden from every view (see getAllEvents). A no-op if the id is
 * already gone.
 */
export function deleteEvent(id: string) {
  const now = new Date().toISOString();
  getDb().run(
    `UPDATE events SET deleted_at = ?, updated_at = ?,
       content_markdown = NULL, media_attachments = '[]'
     WHERE id = ?`,
    [now, now, id],
  );
  persistDb();
}

export function searchEvents(query: string): AnyEvent[] {
  const rows = getDb().exec(
    `SELECT * FROM events WHERE
      (title LIKE ? OR
       content_markdown LIKE ? OR
       tags LIKE ?)
      AND deleted_at IS NULL
    ORDER BY timestamp DESC`,
    [`%${query}%`, `%${query}%`, `%${query}%`]
  );
  if (!rows.length) return [];
  return rowsToEvents(rows[0]);
}

export function getEventsByType(type: EventType): AnyEvent[] {
  const rows = getDb().exec('SELECT * FROM events WHERE type = ? AND deleted_at IS NULL ORDER BY timestamp DESC', [type]);
  if (!rows.length) return [];
  return rowsToEvents(rows[0]);
}

export function exportDb(): Uint8Array {
  return db!.export();
}
