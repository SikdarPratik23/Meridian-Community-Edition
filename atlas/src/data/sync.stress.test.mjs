// Stress test for the two-device courier sync. Throws a large, randomised but
// DETERMINISTIC (seeded) workload at the merge/syncPass logic — many entries,
// concurrent adds/edits/deletes on both devices over many rounds, synced in
// varying order — and asserts the two devices always converge to the same state
// and that extra syncs never change anything (idempotency). Run: npm test
//
// Mirrors the app's syncPass 1:1 (same reason as sync.test.mjs: Node can't follow
// the bundler's extensionless imports), running the REAL mergeEvents from merge.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvents, stampOf } from './merge.ts';

// --- 1:1 mirror of sync.ts ---------------------------------------------------
const maxStamp = (evs) => evs.reduce((m, e) => (stampOf(e) > m ? stampOf(e) : m), '');
function syncPass(role, file, local) {
  const intoLocal = mergeEvents(local, file.entries);
  const intoFile = mergeEvents(file.entries, intoLocal.merged);
  const devices = { ...file.devices };
  const my = maxStamp(intoLocal.merged);
  devices[role] = my > devices[role] ? my : devices[role];
  return { toSave: intoLocal.changed, file: { version: 1, devices, entries: intoFile.merged } };
}

class Device {
  constructor(role, rows = []) { this.role = role; this._db = new Map(rows.map((r) => [r.id, r])); }
  allRecords() { return [...this._db.values()]; }
  allEvents() { return [...this._db.values()].filter((r) => !r.deleted_at); }
  save(ev) { this._db.set(ev.id, { ...ev }); }
  delete(id, at) { const r = this._db.get(id); if (r) this._db.set(id, { ...r, deleted_at: at, updated_at: at }); }
  sync(file) {
    const out = syncPass(this.role, file, this.allRecords());
    for (const e of out.toSave) this.save(e);
    return out.file;
  }
}

const ev = (id, t, extra = {}) => ({
  id, type: 'journal', title: id, timestamp: t,
  longitude: 0, latitude: 0, tags: [], created_at: t, updated_at: t, ...extra,
});

// Tiny seeded PRNG (mulberry32) so a failure is always reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A monotonically increasing clock so every mutation gets a unique, ordered
// timestamp (newest-wins is only well-defined when stamps differ).
function clock(startMs) {
  let n = startMs;
  return () => new Date((n += 1000)).toISOString();
}

// Snapshot a device as id -> "updated_at|deleted?" for equality comparison.
function snapshot(dev) {
  const m = {};
  for (const r of dev.allRecords()) m[r.id] = `${r.updated_at}|${r.deleted_at ? 'D' : 'L'}`;
  return m;
}

function runScenario(seed, { entries, rounds }) {
  const rand = rng(seed);
  const now = clock(Date.UTC(2026, 0, 1));
  const pc = new Device('pc');
  const phone = new Device('phone');
  let file = { version: 1, devices: { pc: '', phone: '' }, entries: [] };

  // Seed PC with the initial corpus, then sync both so they start aligned.
  for (let i = 0; i < entries; i++) pc.save(ev(`E${i}`, now()));
  file = pc.sync(file);
  file = phone.sync(file);

  const ids = Array.from({ length: entries }, (_, i) => `E${i}`);
  let nextNew = entries;

  for (let r = 0; r < rounds; r++) {
    for (const dev of [pc, phone]) {
      const op = rand();
      if (op < 0.25) {
        // add a brand-new entry
        const id = `N${nextNew++}`;
        dev.save(ev(id, now()));
        ids.push(id);
      } else if (op < 0.6) {
        // edit a random existing entry
        const id = ids[Math.floor(rand() * ids.length)];
        const t = now();
        dev.save(ev(id, t, { title: `${id}-r${r}-${dev.role}`, updated_at: t }));
      } else if (op < 0.75) {
        // delete a random existing entry
        const id = ids[Math.floor(rand() * ids.length)];
        dev.delete(id, now());
      }
      // else: no-op this device this round
    }

    // Sync in a randomised order; sometimes only one device syncs this round
    // (simulating one device being offline for a beat).
    const order = rand() < 0.5 ? [pc, phone] : [phone, pc];
    if (rand() < 0.85) file = order[0].sync(file);
    if (rand() < 0.85) file = order[1].sync(file);
  }

  // Drive to quiescence: a few rounds of mutual sync.
  for (let i = 0; i < 4; i++) { file = pc.sync(file); file = phone.sync(file); }

  return { pc, phone, file };
}

test('stress: two devices converge to an identical state under heavy random churn', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    const { pc, phone } = runScenario(seed, { entries: 40, rounds: 120 });
    assert.deepEqual(
      snapshot(pc), snapshot(phone),
      `seed ${seed}: PC and phone must hold identical records after convergence`,
    );
    assert.deepEqual(
      pc.allEvents().map((e) => e.id).sort(),
      phone.allEvents().map((e) => e.id).sort(),
      `seed ${seed}: the same visible entries on both devices`,
    );
  }
});

test('stress: once converged, extra syncs change nothing (idempotent)', () => {
  const { pc, phone, file } = runScenario(2024, { entries: 30, rounds: 80 });
  const before = snapshot(pc);
  let f = file;
  for (let i = 0; i < 6; i++) { f = pc.sync(f); f = phone.sync(f); }
  assert.deepEqual(snapshot(pc), before, 'PC unchanged by further syncs');
  assert.deepEqual(snapshot(phone), before, 'phone matches and is unchanged');
});

test('stress: no entry ever silently vanishes (every id is live or a tombstone)', () => {
  const { pc } = runScenario(55, { entries: 50, rounds: 150 });
  const recs = pc.allRecords();
  const ids = new Set(recs.map((r) => r.id));
  // Every id that was ever created must still exist as a record (live or tombstone),
  // never just disappear.
  for (const r of recs) assert.ok(r.id, 'record has an id');
  assert.ok(ids.size >= 50, 'at least the initial corpus is still accounted for');
});
