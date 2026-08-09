// Regression + smoke tests for delete-propagation (tombstones) and merge logic.
// Runs the REAL merge.ts via Node's type-stripping; syncPass is mirrored 1:1
// from sync.ts (the app uses bundler-resolved extensionless imports that Node
// can't follow without a shim). Run: npm test
//
// Coverage:
//   - The original resurrection bug (delete → sync → entry comes back)
//   - PC deletes, phone deletes, both delete
//   - Concurrent edits (same entry modified on both devices simultaneously)
//   - Tombstone beats an older incoming copy (stale-backup import)
//   - A newer edit after a delete intentionally revives the entry
//   - Import of mixed valid+invalid records
//   - Empty/missing field tolerance in parseSyncFile
//   - Device-stamp advancement

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvents, isTombstone, stampOf, isValidEvent } from './merge.ts';

// ---------- 1:1 mirror of sync.ts exported functions -----------------------
const maxStamp = (evs) => evs.reduce((m, e) => (stampOf(e) > m ? stampOf(e) : m), '');
function syncPass(role, file, local, trim = false) {
  const intoLocal = mergeEvents(local, file.entries);
  const intoFile  = mergeEvents(file.entries, intoLocal.merged);
  const devices   = { ...file.devices };
  const my        = maxStamp(intoLocal.merged);
  devices[role]   = my > devices[role] ? my : devices[role];
  return { toSave: intoLocal.changed, file: { version: 1, devices, entries: intoFile.merged }, stats: intoLocal.stats };
}
const serialize   = (f) => JSON.stringify(f, null, 2);
const parse       = (s) => {
  const p = JSON.parse(s);
  return { version: 1,
    devices: { pc: String(p.devices?.pc || ''), phone: String(p.devices?.phone || '') },
    entries: Array.isArray(p.entries) ? p.entries : [] };
};
// ---------- helpers ---------------------------------------------------------
const ev    = (id, t, extra = {}) => ({ id, type: 'journal', title: id, timestamp: t, longitude: 0, latitude: 0, tags: [], created_at: t, updated_at: t, ...extra });
const tomb  = (id, at) => ev(id, at, { deleted_at: at, updated_at: at });
const visible = (rows) => rows.filter((r) => !r.deleted_at).map((r) => r.id).sort();
const emptyFile = () => ({ version: 1, devices: { pc: '', phone: '' }, entries: [] });

// Tiny device model matching the app's sync path.
class Device {
  constructor(role, rows = []) { this.role = role; this._db = new Map(rows.map((r) => [r.id, r])); }
  allRecords() { return [...this._db.values()]; }
  allEvents()  { return [...this._db.values()].filter((r) => !r.deleted_at); }
  save(ev)     { this._db.set(ev.id, { ...ev }); }
  delete(id, at) { const r = this._db.get(id); if (r) this._db.set(id, { ...r, deleted_at: at, updated_at: at }); }
  sync(file) {
    const out = syncPass(this.role, file, this.allRecords(), false);
    for (const e of out.toSave) this.save(e);
    return out.file;
  }
}

// ============================================================
// DELETION PROPAGATION
// ============================================================

test('BUG-REPRO: old behaviour — delete resurfaces (proves the bug existed)', () => {
  // Run the BROKEN logic (sync against visible-only, no tombstones) to confirm
  // the test itself would have failed before the fix.
  const A = ev('A', '2026-01-T00:00:00Z');  // intentionally mangled stamp
  const broken = mergeEvents([], [A]);       // add A
  const afterDelete = broken.merged.filter((e) => e.id !== 'A'); // hard-delete (old way)
  const reSync = mergeEvents(afterDelete, [A]); // sync brings it back
  assert.equal(reSync.stats.added, 1, 'old hard-delete is invisible to merge → re-added');
});

test('PC-delete propagates to phone and stays gone', () => {
  const A = ev('A', '2026-01-01T10:00:00Z');
  const B = ev('B', '2026-02-01T10:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(B), phone: stampOf(B) }, entries: [A, B] };
  const pc    = new Device('pc',    [A, B]);
  const phone = new Device('phone', [A, B]);

  pc.delete('A', '2026-03-01T10:00:00Z');
  assert.deepEqual(visible(pc.allEvents()), ['B'], 'hidden locally immediately');

  file = pc.sync(file);
  assert.deepEqual(visible(pc.allEvents()),   ['B'], 'PC: A does not come back after sync');
  assert.ok(file.entries.find((e) => e.id === 'A')?.deleted_at, 'tombstone in server file');

  file = phone.sync(file);
  assert.deepEqual(visible(phone.allEvents()), ['B'], 'phone: deletion propagates');
});

test('phone-delete propagates to PC', () => {
  const A = ev('A', '2026-01-01T10:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  phone.delete('A', '2026-02-01T10:00:00Z');
  file = phone.sync(file);
  file = pc.sync(file);

  assert.deepEqual(visible(pc.allEvents()), [], 'PC receives phone-side deletion');
});

test('both devices delete the same entry independently — converges on empty', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  pc.delete('A',    '2026-02-01T10:00:00Z');
  phone.delete('A', '2026-02-01T09:00:00Z'); // slightly earlier

  file = pc.sync(file);   // PC's later tombstone wins
  file = phone.sync(file);
  file = pc.sync(file);

  assert.deepEqual(visible(pc.allEvents()),    [], 'PC: both deleted — stays empty');
  assert.deepEqual(visible(phone.allEvents()), [], 'phone: stays empty');
});

test('repeated syncs stay converged (idempotent)', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  pc.delete('A', '2026-03-01T00:00:00Z');
  for (let i = 0; i < 5; i++) {
    file = pc.sync(file);
    file = phone.sync(file);
  }
  assert.deepEqual(visible(pc.allEvents()),    []);
  assert.deepEqual(visible(phone.allEvents()), []);
});

// ============================================================
// TOMBSTONE WINS OVER STALE INCOMING
// ============================================================

test('importing an old backup cannot resurrect a tombstoned entry', () => {
  const stale = ev('A', '2026-01-01T00:00:00Z');
  const local  = [tomb('A', '2026-05-01T00:00:00Z')];
  const { merged, stats } = mergeEvents(local, [stale]);
  assert.equal(stats.kept, 1, 'local tombstone (newer) is kept');
  assert.ok(isTombstone(merged.find((e) => e.id === 'A')), 'entry stays deleted');
});

test('a newer edit after delete intentionally revives (opt-in resurrection)', () => {
  const t = tomb('A', '2026-03-01T00:00:00Z');
  const revive = ev('A', '2026-04-01T00:00:00Z', { title: 'rewritten' });
  const pc    = new Device('pc',    [t]);
  const phone = new Device('phone', [t]);
  let file = { version: 1, devices: { pc: '', phone: '' }, entries: [t] };

  pc.save(revive); // PC writes a newer copy, no deleted_at
  file = pc.sync(file);
  file = phone.sync(file);

  assert.deepEqual(visible(phone.allEvents()), ['A'], 'newer edit beats the older tombstone');
  assert.equal(phone.allRecords().find((e) => e.id === 'A')?.title, 'rewritten');
});

// ============================================================
// CONCURRENT EDITS (conflict resolution)
// ============================================================

test('concurrent edits to same entry — later timestamp wins', () => {
  const base = ev('A', '2026-01-01T00:00:00Z', { title: 'original' });
  const pcEdit    = { ...base, title: 'pc-version',    updated_at: '2026-02-01T10:00:00Z' };
  const phoneEdit = { ...base, title: 'phone-version', updated_at: '2026-02-01T09:00:00Z' };
  let file = { version: 1, devices: { pc: '', phone: '' }, entries: [base] };
  const pc    = new Device('pc',    [pcEdit]);
  const phone = new Device('phone', [phoneEdit]);

  file = pc.sync(file);    // PC's later version goes into the file
  file = phone.sync(file); // phone gets PC's version (it's newer)
  file = pc.sync(file);    // PC stays on its own version

  const pcTitle    = pc.allRecords().find((e) => e.id === 'A')?.title;
  const phoneTitle = phone.allRecords().find((e) => e.id === 'A')?.title;
  assert.equal(pcTitle,    'pc-version', 'PC keeps its later version');
  assert.equal(phoneTitle, 'pc-version', 'phone converges to the later version');
});

test('brand-new entry on one device appears on the other after sync', () => {
  const existing = ev('X', '2026-01-01T00:00:00Z');
  const newEntry = ev('Y', '2026-02-01T00:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(existing), phone: stampOf(existing) }, entries: [existing] };
  const pc    = new Device('pc',    [existing, newEntry]);
  const phone = new Device('phone', [existing]);

  file = pc.sync(file);
  file = phone.sync(file);

  assert.deepEqual(visible(phone.allEvents()), ['X', 'Y'], 'new PC entry appears on phone');
});

// ============================================================
// MERGE EDGE CASES
// ============================================================

test('invalid records in incoming are skipped, valid ones are applied', () => {
  const good = ev('G', '2026-01-01T00:00:00Z');
  const bad  = [{ not_an_event: true }, null, 'string', 42, { id: 123 }];
  const { merged, stats } = mergeEvents([], [good, ...bad]);
  assert.equal(stats.added,   1, 'one valid record added');
  assert.equal(stats.skipped, 5, 'five invalid records skipped');
  assert.equal(merged.length, 1);
});

test('isValidEvent rejects records missing required fields', () => {
  assert.equal(isValidEvent({ id: 'x', type: 'journal' }), false, 'missing title');
  assert.equal(isValidEvent({ id: 'x', title: 't' }), false, 'missing type');
  assert.equal(isValidEvent({ type: 'journal', title: 't' }), false, 'missing id');
  assert.equal(isValidEvent({ id: 'x', type: 'journal', title: 't' }), true, 'all required fields');
});

test('merge with empty incoming is a no-op', () => {
  const local = [ev('A', '2026-01-01T00:00:00Z'), ev('B', '2026-02-01T00:00:00Z')];
  const { merged, stats } = mergeEvents(local, []);
  assert.deepEqual(stats, { added: 0, updated: 0, kept: 0, skipped: 0 });
  assert.equal(merged.length, 2);
});

test('merge from empty local adds all incoming', () => {
  const incoming = [ev('A', '2026-01-01T00:00:00Z'), ev('B', '2026-02-01T00:00:00Z')];
  const { merged, stats } = mergeEvents([], incoming);
  assert.equal(stats.added, 2);
  assert.equal(merged.length, 2);
});

// ============================================================
// SERIALIZATION / PARSE ROUND-TRIP
// ============================================================

test('parse → serialize → parse round-trips entries and devices', () => {
  const file = { version: 1, devices: { pc: 'p', phone: 'q' }, entries: [ev('A', '2026-01-01T00:00:00Z')] };
  const back = parse(serialize(file));
  assert.deepEqual(back.devices,        file.devices);
  assert.equal(back.entries.length,     1);
  assert.equal(back.entries[0].id,      'A');
});

test('parse tolerates missing devices field', () => {
  const raw = JSON.stringify({ version: 1, entries: [ev('A', '2026-01-01T00:00:00Z')] });
  const f   = parse(raw);
  assert.deepEqual(f.devices, { pc: '', phone: '' });
});

test('parse tolerates missing entries field', () => {
  const raw = JSON.stringify({ version: 1, devices: { pc: 'x', phone: 'y' } });
  const f   = parse(raw);
  assert.deepEqual(f.entries, []);
});

// ============================================================
// DEVICE STAMP ADVANCEMENT
// ============================================================

test('device stamps advance after each sync', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  const B = ev('B', '2026-03-01T00:00:00Z');
  let file = emptyFile();
  const pc = new Device('pc', [A, B]);

  file = pc.sync(file);
  assert.ok(file.devices.pc >= stampOf(B), 'PC stamp advances to latest entry');
  assert.equal(file.devices.phone, '', 'phone stamp untouched until phone syncs');
});
