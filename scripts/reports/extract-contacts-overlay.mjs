#!/usr/bin/env node
/**
 * Contact overlay for the college reports.
 *
 * Most colleges that never registered have no PED or principal details in the registration
 * database — those were only ever matched by name from the 2025-26 VTU sheets ("VTU all
 * principal MAILS", "All PED's Phone Numbers as on 2025-26", the active PED contact list)
 * while building docs/reports/colleges-not-registered.html on 26-11-2026.
 *
 * Rather than re-matching those sheets, this lifts the already-matched cells out of that
 * report into docs/reports/contacts-overlay.json, keyed by college code, so
 * college-registration-status.mjs can fall back to them. Both files are gitignored:
 * they carry personal phone numbers and e-mail addresses.
 *
 * Usage: node scripts/reports/extract-contacts-overlay.mjs [source.html]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = process.argv[2] || resolve(ROOT, 'docs/reports/colleges-not-registered.html');
const OUT = resolve(ROOT, 'docs/reports/contacts-overlay.json');

const html = readFileSync(SRC, 'utf8');
const rows = html.match(/<tr>(?:(?!<\/tr>).)*<\/tr>/gs) || [];
const clean = (cell) => {
  const v = cell.replace(/<span class=["']na["']>—<\/span>/g, '').trim();
  return v === '' || v === '—' ? null : v;
};

const out = {};
for (const row of rows) {
  const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]);
  if (cells.length < 4) continue;
  // college cell: <b>Name</b><br><span class='sub'>District · CODE</span>
  const code = cells[1].match(/·\s*([A-Z0-9&._-]+)\s*<\/span>/)?.[1];
  if (!code) continue;
  const ped = clean(cells[2]);
  const principal = clean(cells[3]);
  if (!ped && !principal) continue;
  out[code] = { ped, principal };
}

writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${Object.keys(out).length} colleges with contacts → ${OUT}`);
