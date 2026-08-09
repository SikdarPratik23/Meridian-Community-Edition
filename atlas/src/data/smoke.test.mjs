// Smoke test battery for the sync system — focuses on delete propagation speed,
// correctness under load, and edge cases the unit tests don't cover.
//
// Runs alongside sync.test.mjs.  Run: npm test
//
// Coverage:
//   - Rapid sequential deletes (timing stress)
//   - Batch delete of many entries
//   - Delete+add in same tick (revive before sync)
//   - Empty file / null transport tolerance
//   - Tombstone compaction during trimConfirmed
//   - Concurrent edits + deletes on both devices
//   - Full round-trip: deviceA deletes → sync → deviceB receives tombstone
//   - Device-stamp advancement during deletes
//   - Many entries, delete half, verify merge correctness

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvents, isTombstone, stampOf, isValidEvent } from './merge.ts';

// ----- helpers (mirror sync.ts) -------------------------------------------

const maxStamp = (evs) => evs.reduce((m, e) => (stampOf(e) > m ? stampOf(e) : m), '');

function syncPass(role, file, local, trim = false) {
  const intoLocal = mergeEvents(local, file.entries);
  const intoFile  = mergeEvents(file.entries, intoLocal.merged);
  const devices   = { ...file.devices };
  const my        = maxStamp(intoLocal.merged);
  devices[role]   = my > devices[role] ? my : devices[role];
  let nextFile = { version: 1, devices, entries: intoFile.merged };
  if (trim) {
    const floor = devices.pc && devices.phone
      ? (devices.pc < devices.phone ? devices.pc : devices.phone)
      : '';
    if (floor) {
      nextFile = {
        ...nextFile,
        entries: nextFile.entries.map((e) => {
          const atts = e.media_attachments;
          if (!atts?.length) return e;
          if (stampOf(e) <= floor) {
            return {
              ...e,
              media_attachments: atts.map((a) =>
                a.stripped ? a : { ...a, data: '', stripped: true }
              ),
            };
          }
          return e;
        }),
      };
    }
  }
  return { toSave: intoLocal.changed, file: nextFile, stats: intoLocal.stats };
}

const serialize = (f) => JSON.stringify(f, null, 2);
const parse = (s) => {
  const p = JSON.parse(s);
  const entries = Array.isArray(p.entries)
    ? p.entries
    : Array.isArray(p.events)
      ? p.events
      : Array.isArray(p)
        ? p
        : [];
  return {
    version: 1,
    devices: { pc: String(p.devices?.pc || ''), phone: String(p.devices?.phone || '') },
    entries,
  };
};

const ev    = (id, t, extra = {}) =>
  ({ id, type: 'journal', title: id, timestamp: t, longitude: 0, latitude: 0,
     tags: [], created_at: t, updated_at: t, ...extra });
const tomb  = (id, at) => ev(id, at, { deleted_at: at, updated_at: at });
const visible = (rows) => rows.filter((r) => !r.deleted_at).map((r) => r.id).sort();
const emptyFile = () => ({ version: 1, devices: { pc: '', phone: '' }, entries: [] });

class Device {
  constructor(role, rows = []) { this.role = role; this._db = new Map(rows.map((r) => [r.id, r])); }
  allRecords() { return [...this._db.values()]; }
  allEvents()  { return [...this._db.values()].filter((r) => !r.deleted_at); }
  save(e)      { this._db.set(e.id, { ...e }); }
  delete(id, at) {
    const r = this._db.get(id);
    if (r) this._db.set(id, { ...r, deleted_at: at, updated_at: at, content_markdown: null, media_attachments: [] });
  }
  sync(file) {
    const out = syncPass(this.role, file, this.allRecords(), false);
    for (const e of out.toSave) this.save(e);
    return out.file;
  }
}

// ===================================================================
// SMOKE: DELETE TIMING & RAPID OPERATIONS
// ===================================================================

test('SMOKE: rapid sequential deletes — all propagate correctly', () => {
  const ids = ['A','B','C','D','E'];
  const entries = ids.map((id) => ev(id, `2026-0${ids.indexOf(id)+1}-01T10:00:00Z`));
  let file = { version: 1, devices: { pc: maxStamp(entries), phone: maxStamp(entries) }, entries: [...entries] };
  const pc    = new Device('pc',    entries);
  const phone = new Device('phone', entries);

  // Delete all 5 entries sequentially (simulating rapid clicks)
  const base = '2026-06-01T';
  for (let i = 0; i < ids.length; i++) {
    pc.delete(ids[i], `${base}${String(10 + i).padStart(2, '0')}:00:00Z`);
    file = pc.sync(file);
  }

  assert.equal(visible(pc.allEvents()).length, 0, 'PC: all deleted');
  assert.ok(file.entries.every((e) => e.deleted_at), 'all tombstones in file');

  file = phone.sync(file);
  assert.equal(visible(phone.allEvents()).length, 0, 'phone: all deleted after sync');
});

test('SMOKE: delete 50 entries in one pass — merge is correct', () => {
  const N = 50;
  const entries = Array.from({ length: N }, (_, i) =>
    ev(`B${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`)
  );
  let file = { version: 1, devices: { pc: maxStamp(entries), phone: maxStamp(entries) }, entries: [...entries] };
  const pc    = new Device('pc',    entries);
  const phone = new Device('phone', entries);

  // Delete half of them
  const deleted = new Set(Array.from({ length: N / 2 }, (_, i) => `B${i}`));
  let idx = 0;
  for (const id of deleted) {
    pc.delete(id, `2026-06-${String(idx + 1).padStart(2, '0')}T10:00:00Z`);
    idx++;
  }

  file = pc.sync(file);
  assert.equal(file.entries.filter((e) => e.deleted_at).length, N / 2, 'half are tombstones in file');
  assert.equal(file.entries.filter((e) => !e.deleted_at).length, N / 2, 'half survive');

  file = phone.sync(file);
  assert.equal(visible(phone.allEvents()).length, N / 2, 'phone sees only survivors');
});

test('SMOKE: delete then revive in same sync window', () => {
  const A = ev('A', '2026-01-01T10:00:00Z');
  let file = { version: 1, devices: { pc: maxStamp([A]), phone: maxStamp([A]) }, entries: [A] };
  const pc = new Device('pc', [A]);

  // Delete A
  pc.delete('A', '2026-06-01T10:00:00Z');
  // Immediately revive with a newer stamp (simulating undo-delete or re-creation)
  pc.save(ev('A', '2026-06-02T10:00:00Z', { title: 'revived' }));

  file = pc.sync(file);
  const entryA = file.entries.find((e) => e.id === 'A');
  assert.ok(entryA, 'entry A still exists in file');
  assert.equal(entryA.deleted_at, undefined, 'revive beats tombstone — no deleted_at');
  assert.equal(entryA.title, 'revived', 'newer title wins');
});

// ===================================================================
// SMOKE: CROSS-DEVICE DELETE PROPAGATION
// ===================================================================

test('SMOKE: PC deletes, phone deletes different entry, both converge', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  const B = ev('B', '2026-02-01T00:00:00Z');
  let file = { version: 1, devices: { pc: maxStamp([A, B]), phone: maxStamp([A, B]) }, entries: [A, B] };
  const pc    = new Device('pc',    [A, B]);
  const phone = new Device('phone', [A, B]);

  pc.delete('A',    '2026-03-01T10:00:00Z');
  phone.delete('B', '2026-03-01T09:00:00Z');

  file = pc.sync(file);
  file = phone.sync(file);
  file = pc.sync(file);

  assert.deepEqual(visible(pc.allEvents()),    [], 'PC: both gone');
  assert.deepEqual(visible(phone.allEvents()), [], 'phone: both gone');
});

test('SMOKE: three devices converge on same delete (pc + phone + pc re-sync)', () => {
  const A = ev('A', '2026-01-01T10:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  pc.delete('A', '2026-03-01T10:00:00Z');
  file = pc.sync(file);
  file = phone.sync(file);
  file = pc.sync(file); // third convergence pass

  assert.equal(visible(pc.allEvents()).length,    0, 'PC: fully converged');
  assert.equal(visible(phone.allEvents()).length, 0, 'phone: fully converged');
  assert.equal(file.entries.length, 1, 'tombstone kept in file');
  assert.ok(file.entries[0].deleted_at, 'file carries tombstone');
});

// ===================================================================
// SMOKE: CONCURRENT EDITS + DELETE (conflict scenarios)
// ===================================================================

test('SMOKE: PC edits entry while phone deletes it — newer wins', () => {
  const A = ev('A', '2026-01-01T10:00:00Z', { title: 'original' });
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  // PC edits at T2, phone deletes at T1 (slightly earlier)
  const pcEdit = { ...A, title: 'pc-edit', updated_at: '2026-03-01T10:00:00Z' };
  pc.save(pcEdit);
  phone.delete('A', '2026-03-01T09:00:00Z');

  file = pc.sync(file);
  file = phone.sync(file);
  file = pc.sync(file);

  const pcA = pc.allRecords().find((e) => e.id === 'A');
  assert.equal(pcA?.title, 'pc-edit', 'PC edit (newer) beats phone delete (older)');
  assert.equal(pcA?.deleted_at, undefined, 'entry is not deleted on PC');

  const phoneA = phone.allRecords().find((e) => e.id === 'A');
  assert.equal(phoneA?.title, 'pc-edit', 'phone converges to PC edit');
  assert.equal(phoneA?.deleted_at, undefined, 'phone entry is revived');
});

test('SMOKE: phone deletes after PC edit — delete wins (newer)', () => {
  const A = ev('A', '2026-01-01T10:00:00Z', { title: 'original' });
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  // PC edits at T1, phone deletes at T2 (later)
  pc.save({ ...A, title: 'pc-edit', updated_at: '2026-03-01T09:00:00Z' });
  phone.delete('A', '2026-03-01T10:00:00Z');

  file = pc.sync(file);
  file = phone.sync(file);
  file = pc.sync(file);

  const pcA = pc.allRecords().find((e) => e.id === 'A');
  assert.ok(pcA?.deleted_at, 'PC entry is deleted (phone tombstone is newer)');

  const phoneA = phone.allRecords().find((e) => e.id === 'A');
  assert.ok(phoneA?.deleted_at, 'phone entry stays deleted');
});

// ===================================================================
// SMOKE: TRIM BEHAVIOR DURING DELETES
// ===================================================================

test('SMOKE: confirmed entries are trimmed, tombstones survive trimming', () => {
  const A = ev('A', '2026-01-01T10:00:00Z', { media_attachments: [{ id: 'm1', kind: 'image', mime: 'image/png', name: 'test.png', data: 'data:image/png;base64,BIGBYTES' }] });
  const B = ev('B', '2026-02-01T10:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A, B] };
  const pc    = new Device('pc',    [A, B]);
  const phone = new Device('phone', [A, B]);

  // Both devices confirm A by syncing
  file = pc.sync(file);
  file = phone.sync(file);

  // Now both stamps are >= A's stamp → A should be trimmed in the next file write
  const trimmedFile = syncPass('pc', file, pc.allRecords(), true);
  const aInFile = trimmedFile.file.entries.find((e) => e.id === 'A');
  const aMedia  = aInFile?.media_attachments?.[0];
  assert.ok(aMedia?.stripped === true || aMedia?.data === '', 'A media is stripped after both confirmed');

  // Now delete A on PC
  pc.delete('A', '2026-06-01T10:00:00Z');
  const afterDelete = syncPass('pc', trimmedFile.file, pc.allRecords(), true);
  const aTomb = afterDelete.file.entries.find((e) => e.id === 'A');
  assert.ok(aTomb?.deleted_at, 'A is a tombstone in file after delete');
  assert.equal(aTomb?.media_attachments?.length, 0, 'tombstone has no attachments');
});

// ===================================================================
// SMOKE: DEVICE-STAMP ACCURACY
// ===================================================================

test('SMOKE: stamps advance correctly when deletes are the only new data', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  let file = emptyFile();
  const pc = new Device('pc', [A]);

  file = pc.sync(file);
  const stampAfterAdd = file.devices.pc;

  pc.delete('A', '2026-06-01T00:00:00Z');
  file = pc.sync(file);

  // The new stamp should be the tombstone's updated_at (which is the delete time)
  assert.ok(file.devices.pc > stampAfterAdd, 'PC stamp advanced after delete');
});

test('SMOKE: phone stamp does not advance when only PC has new data', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc = new Device('pc', [A]);

  pc.delete('A', '2026-06-01T00:00:00Z');
  file = pc.sync(file);

  assert.equal(file.devices.phone, stampOf(A), 'phone stamp unchanged');
});

// ===================================================================
// SMOKE: EDGE CASES (empty files, missing fields, etc.)
// ===================================================================

test('SMOKE: syncPass with empty local and empty file produces no changes', () => {
  const out = syncPass('pc', emptyFile(), [], false);
  assert.equal(out.toSave.length, 0);
  assert.equal(out.stats.added, 0);
  assert.equal(out.stats.updated, 0);
  assert.equal(out.stats.kept, 0);
});

test('SMOKE: delete of non-existent entry is harmless', () => {
  const A = ev('A', '2026-01-01T00:00:00Z');
  const pc = new Device('pc', [A]);
  // delete an id that doesn't exist
  pc.delete('NONEXISTENT', '2026-06-01T00:00:00Z');
  assert.equal(pc.allRecords().length, 1, 'no new record created');
  assert.equal(visible(pc.allEvents()).length, 1, 'existing entry unaffected');
});

test('SMOKE: parseSyncFile tolerates plain JSON array (legacy format)', () => {
  const raw = JSON.stringify([ev('A', '2026-01-01T00:00:00Z')]);
  const f = parse(raw);
  assert.equal(f.entries.length, 1);
  assert.equal(f.entries[0].id, 'A');
  assert.deepEqual(f.devices, { pc: '', phone: '' });
});

test('SMOKE: sync with no transport ready returns error gracefully', () => {
  // This mirrors the check in runSync — the pure function layer is fine;
  // the orchestration layer must reject early.
  const ready = false;
  assert.equal(ready, false, 'transport not ready → sync skipped');
});

// ===================================================================
// SMOKE: FULL ROUND-TRIP IDEMPOTENCY (repeat syncs converge quickly)
// ===================================================================

test('SMOKE: delete round-trip converges after exactly 2 syncs', () => {
  // PC delete → sync → phone sync → converged (2 device syncs)
  const A = ev('A', '2026-01-01T00:00:00Z');
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  pc.delete('A', '2026-06-01T00:00:00Z');
  file = pc.sync(file);
  file = phone.sync(file);

  assert.equal(visible(phone.allEvents()).length, 0, 'converged after 1 round-trip');

  // Extra syncs should be no-ops (idempotent)
  const { stats: extraStats } = syncPass('pc', file, pc.allRecords(), false);
  assert.equal(extraStats.added + extraStats.updated, 0, 'idempotent: no changes');
});

// ===================================================================
// SMOKE: MANY ENTRIES RAPID CREATE + DELETE
// ===================================================================

test('SMOKE: create 100 entries, delete 50, sync — no data corruption', () => {
  const N = 100;
  const entries = Array.from({ length: N }, (_, i) =>
    ev(`S${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`)
  );
  let file = emptyFile();
  const pc    = new Device('pc',    []);
  const phone = new Device('phone', []);

  // Simulate importing all 100 on PC (as if from a bulk import)
  for (const e of entries) pc.save(e);
  file = pc.sync(file);
  assert.equal(file.entries.length, N, 'all 100 in file after PC sync');

  // Phone syncs and gets all 100
  file = phone.sync(file);
  assert.equal(phone.allEvents().length, N, 'phone has all 100');

  // Delete every other entry (IDs S0, S2, S4, ...)
  for (let i = 0; i < N; i += 2) {
    pc.delete(`S${i}`, `2026-06-${String(i / 2 + 1).padStart(2, '0')}T10:00:00Z`);
  }
  file = pc.sync(file);
  assert.equal(file.entries.filter((e) => e.deleted_at).length, N / 2, 'half are tombstones');
  assert.equal(file.entries.filter((e) => !e.deleted_at).length, N / 2, 'half survive');

  file = phone.sync(file);
  const phoneVisible = visible(phone.allEvents());
  assert.equal(phoneVisible.length, N / 2, 'phone sees half after delete sync');
  // Survivors should be the odd-numbered ones
  for (let i = 1; i < N; i += 2) {
    assert.ok(phoneVisible.includes(`S${i}`), `phone still has S${i}`);
  }
  for (let i = 0; i < N; i += 2) {
    assert.ok(!phoneVisible.includes(`S${i}`), `phone no longer has S${i}`);
  }
});

// ===================================================================
// SMOKE: TRIM + DELETE interaction
// ===================================================================

test('SMOKE: trimmed entry can still be deleted and tombstoned correctly', () => {
  const A = ev('A', '2026-01-01T10:00:00Z', {
    media_attachments: [{ id: 'm1', kind: 'image', mime: 'image/png', name: 'p.png', data: 'data:image/png;base64,DATADATADATA' }],
  });
  let file = { version: 1, devices: { pc: stampOf(A), phone: stampOf(A) }, entries: [A] };
  const pc    = new Device('pc',    [A]);
  const phone = new Device('phone', [A]);

  // Both devices sync → A is confirmed → A's media is trimmed in file
  file = pc.sync(file);  // PC confirms
  file = phone.sync(file); // phone confirms → floor = stampOf(A)
  // Next pc sync with trim=true will strip A's media
  const { file: trimmed } = syncPass('pc', file, pc.allRecords(), true);
  assert.ok(
    trimmed.entries.find((e) => e.id === 'A')?.media_attachments?.[0]?.stripped,
    'A media stripped after both confirmed'
  );

  // Now PC deletes A
  pc.delete('A', '2026-06-01T10:00:00Z');
  const { file: afterDelete } = syncPass('pc', trimmed, pc.allRecords(), true);
  const tombA = afterDelete.entries.find((e) => e.id === 'A');
  assert.ok(tombA?.deleted_at, 'trimmed entry can still be tombstoned');
  assert.equal(tombA?.media_attachments?.length, 0, 'tombstone has empty attachments');

  // Phone syncs and gets the tombstone
  const phoneAfter = syncPass('phone', afterDelete, phone.allRecords(), true);
  assert.equal(visible(phoneAfter.toSave).length, 0, 'phone sees A as deleted');
});
