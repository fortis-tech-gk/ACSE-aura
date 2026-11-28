#!/usr/bin/env node
/**
 * College registration status report — two tables on one printable document:
 *   1. Colleges REGISTERED, with PED + principal contacts and the college fee account
 *      (total amount, amount paid, balance to be paid).
 *   2. Colleges NOT registered, with PED + principal contacts and a "called" column.
 *
 * Also writes the not-registered table on its own as colleges-not-registered.html/.pdf
 * (the standalone contact list for the calling desk).
 *
 * Data comes from scripts/reports/college-registration-status.sql (run through psql);
 * fees mirror frontend/web/src/lib/payments.ts. Output: HTML + PDF in docs/reports/
 * (gitignored — the tables carry personal phone numbers and e-mail addresses).
 *
 * Usage:
 *   node scripts/reports/college-registration-status.mjs            # production DB
 *   DB_URL="postgres://..." node scripts/reports/college-registration-status.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SQL = resolve(HERE, 'college-registration-status.sql');
const OUT_DIR = resolve(ROOT, 'docs/reports');
const OUT_HTML = resolve(OUT_DIR, 'college-registration-status.html');
const OUT_PDF = resolve(OUT_DIR, 'college-registration-status.pdf');
const NOT_HTML = resolve(OUT_DIR, 'colleges-not-registered.html');
const NOT_PDF = resolve(OUT_DIR, 'colleges-not-registered.pdf');
const OVERLAY = resolve(OUT_DIR, 'contacts-overlay.json');

/**
 * Contacts for colleges that have none in the registration database — mostly colleges that
 * never registered, whose PED / principal details were matched by name from the 2025-26 VTU
 * sheets. Built by scripts/reports/extract-contacts-overlay.mjs; absent is fine.
 */
const overlay = existsSync(OVERLAY) ? JSON.parse(readFileSync(OVERLAY, 'utf8')) : {};

function dbUrl() {
  if (process.env.DB_URL) return process.env.DB_URL;
  const envFile = resolve(ROOT, '.env.prod-db');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^PROD_DB=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('No database URL: set DB_URL, or keep PROD_DB in .env.prod-db');
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const dash = '<span class="na">—</span>';
const phone = (p) => (p ? `<b>${esc(p)}</b>` : '');
const mail = (e) => (e ? `<span class="em">${esc(e)}</span>` : '');

/** PED contacts of a college: one line per squad, deduplicated when both squads share a PED. */
function pedCell(college, { withDivision } = {}) {
  const lines = [];
  const seen = new Set();
  for (const s of college.squads || []) {
    if (!s || (!s.ped_name && !s.ped_phone && !s.ped_email)) continue;
    // Both squads usually share one PED, entered twice with different spelling or case:
    // same phone (or same e-mail) means the same person, so the two rows become one line.
    const key =
      String(s.ped_phone || '').replace(/\D/g, '') ||
      String(s.ped_email || '').trim().toLowerCase() ||
      String(s.ped_name || '').trim().toLowerCase();
    const division = s.gender === 'women' ? 'W' : 'M';
    if (seen.has(key)) {
      const prev = lines.find((l) => l.key === key);
      if (prev) {
        if (!prev.divisions.includes(division)) prev.divisions.push(division);
        // keep the fullest spelling of the name and fill in a missing e-mail
        if ((s.ped_name || '').length > (prev.name || '').length) prev.name = s.ped_name;
        if (!prev.email && s.ped_email) prev.email = s.ped_email;
      }
      continue;
    }
    seen.add(key);
    lines.push({ key, divisions: [division], name: s.ped_name, phone: s.ped_phone, email: s.ped_email });
  }
  if (lines.length === 0) return overlay[college.code]?.ped || dash;
  return lines
    .map((l) => {
      const tag = withDivision && lines.length > 1 ? `<span class="sub">[${l.divisions.join('+')}]</span> ` : '';
      const head = [tag + (l.name ? `<b>${esc(l.name)}</b>` : ''), phone(l.phone)].filter(Boolean).join(' — ');
      return [head, mail(l.email)].filter(Boolean).join('<br>');
    })
    .join('<br>');
}

function principalCell(c) {
  const parts = [
    c.principal_name ? esc(c.principal_name) : '',
    mail(c.principal_email),
    phone(c.principal_phone),
  ].filter(Boolean);
  return parts.length ? parts.join('<br>') : overlay[c.code]?.principal || dash;
}

function collegeCell(c) {
  const bits = [c.district, c.code].filter(Boolean).map(esc).join(' · ');
  return `<b>${esc(c.name)}</b><br><span class="sub">${bits}</span>`;
}

/** Colleges grouped by VTU division, divisions in a fixed order. */
function byRegion(rows) {
  const order = ['Bengaluru', 'Mysuru', 'Belagavi', 'Kalaburagi'];
  const groups = new Map();
  for (const r of rows) {
    const key = r.region || 'Division not set';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
  });
}

const balanceOf = (c) => Math.max(0, Number(c.total_amount || 0) - Number(c.paid || 0));

function registeredTable(rows) {
  const out = [];
  out.push(
    `<table><thead><tr>` +
      `<th>#</th><th style="width:23%">College</th>` +
      `<th style="width:22%">PED (Physical Education Director)</th>` +
      `<th style="width:20%">Principal</th>` +
      `<th class="r">Total Amount</th><th class="r">Amount Paid</th><th class="r">Balance To Be Paid</th>` +
      `</tr></thead><tbody>`
  );
  let n = 0;
  for (const [region, list] of byRegion(rows)) {
    const t = list.reduce((a, c) => a + Number(c.total_amount || 0), 0);
    const p = list.reduce((a, c) => a + Number(c.paid || 0), 0);
    const b = list.reduce((a, c) => a + balanceOf(c), 0);
    out.push(
      `<tr class="reg"><td colspan="4">${esc(region)} Division — ${list.length} colleges</td>` +
        `<td class="r">${money(t)}</td><td class="r">${money(p)}</td><td class="r">${money(b)}</td></tr>`
    );
    for (const c of list) {
      n += 1;
      const bal = balanceOf(c);
      const pending = Number(c.pending || 0);
      const paidSub = pending > 0 ? `<br><span class="sub">${money(pending)} awaiting verification</span>` : '';
      out.push(
        `<tr><td class="n">${n}</td><td>${collegeCell(c)}</td>` +
          `<td>${pedCell(c, { withDivision: true })}</td><td>${principalCell(c)}</td>` +
          `<td class="r">${money(c.total_amount)}</td>` +
          `<td class="r">${Number(c.paid || 0) > 0 ? money(c.paid) : dash}${paidSub}</td>` +
          `<td class="r ${bal > 0 ? 'due' : 'ok'}">${bal > 0 ? money(bal) : 'NIL'}</td></tr>`
      );
    }
  }
  const T = rows.reduce((a, c) => a + Number(c.total_amount || 0), 0);
  const P = rows.reduce((a, c) => a + Number(c.paid || 0), 0);
  const B = rows.reduce((a, c) => a + balanceOf(c), 0);
  out.push(
    `<tr class="tot"><td colspan="4">GRAND TOTAL — ${rows.length} registered colleges</td>` +
      `<td class="r">${money(T)}</td><td class="r">${money(P)}</td><td class="r">${money(B)}</td></tr>`
  );
  out.push('</tbody></table>');
  return out.join('');
}

function notRegisteredTable(rows) {
  const out = [];
  out.push(
    `<table><thead><tr><th>#</th><th style="width:32%">College</th>` +
      `<th style="width:27%">PED (Physical Education Director)</th>` +
      `<th style="width:25%">Principal</th><th>Remarks / Called</th></tr></thead><tbody>`
  );
  let n = 0;
  for (const [region, list] of byRegion(rows)) {
    out.push(`<tr class="reg"><td colspan="5">${esc(region)} Division — ${list.length} colleges</td></tr>`);
    for (const c of list) {
      n += 1;
      out.push(
        `<tr><td class="n">${n}</td><td>${collegeCell(c)}</td>` +
          `<td>${pedCell(c)}</td><td>${principalCell(c)}</td><td class="chk"></td></tr>`
      );
    }
  }
  out.push('</tbody></table>');
  return out.join('');
}

const CSS = `@page { size: A4 landscape; margin: 10mm 10mm 12mm; }
body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; }
h1 { font-size: 15px; text-align:center; margin:0 0 2px; } h2 { font-size: 13px; text-align:center; margin:0 0 3px; }
h3 { font-size: 12.5px; margin:0 0 4px; padding:4px 6px; background:#1f3a68; color:#fff; }
.meta { font-size: 9.5px; text-align:center; color:#444; margin-bottom:6px; }
.sum { font-size: 10px; text-align:center; margin-bottom:8px; }
table { border-collapse: collapse; width:100%; }
thead { display: table-header-group; }
th, td { border:1px solid #444; font-size:10px; padding:4px 6px; vertical-align:top; text-align:left; }
thead th { background:#1f3a68; color:#fff; font-size:10px; }
tr { page-break-inside: avoid; }
tr.reg td { background:#dfe7f3; font-weight:bold; font-size:11px; }
tr.tot td { background:#1f3a68; color:#fff; font-weight:bold; font-size:11px; }
td.n { text-align:center; width:26px; } td.chk { width:120px; }
th.r, td.r { text-align:right; white-space:nowrap; }
td.due { color:#a40000; font-weight:bold; } td.ok { color:#0a6b1e; }
.sub { color:#555; font-size:9px; } .em { color:#0b4fa8; } .na { color:#999; }
.note { font-size: 8.5px; color:#444; margin-top:6px; line-height:1.4; }
.page-break { page-break-before: always; }
`;

const nowStamp = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date())
    .replace(/\//g, '-')
    .replace(',', '')
    .replace(/\b(am|pm)\b/, (m) => m.toUpperCase());

const SOURCES_NOTE = `Sources: registration database (squad PED details, college principal details); “VTU all principal
MAILS” sheet; “All PED’s Phone Numbers as on 2025-26”; active PED contact list. PED and principal details from the
2025-26 lists were matched to colleges by name and may be out of date — please confirm when calling.`;

/** Contact-coverage line for a not-registered list. */
function notRegisteredSummary(not) {
  return `<b>${not.length}</b> colleges not registered · PED contact available for
<b>${not.filter((c) => pedCell(c) !== dash).length}</b> · principal contact available for
<b>${not.filter((c) => principalCell(c) !== dash).length}</b> · no contact found for
<b>${not.filter((c) => pedCell(c) === dash && principalCell(c) === dash).length}</b>`;
}

/** Standalone "Colleges Not Yet Registered — Contact List" (same layout as the 26-11-2026 list). */
function renderNotRegistered(not) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Colleges Not Registered</title><style>
${CSS}</style></head><body>
<h1>28th VTU Inter-Collegiate State Level Athletic Meet 2026 (Dr. ACS-AURA 2026)</h1>
<h2>Colleges Not Yet Registered — Contact List</h2>
<div class="meta">Generated ${esc(nowStamp())} IST · colleges with no athlete registered on the portal</div>
<div class="sum">${notRegisteredSummary(not)}</div>
${notRegisteredTable(not)}
<div class="note">${SOURCES_NOTE}</div>
</body></html>`;
}

function render(data) {
  const reg = data.registered || [];
  const not = data.not_registered || [];
  const stamp = nowStamp();

  const T = reg.reduce((a, c) => a + Number(c.total_amount || 0), 0);
  const P = reg.reduce((a, c) => a + Number(c.paid || 0), 0);
  const B = reg.reduce((a, c) => a + balanceOf(c), 0);
  const dueCount = reg.filter((c) => balanceOf(c) > 0).length;
  const nilPay = reg.filter((c) => Number(c.paid || 0) === 0).length;

  return `<!doctype html><html><head><meta charset="utf-8"><title>College Registration Status</title><style>
${CSS}</style></head><body>
<h1>28th VTU Inter-Collegiate State Level Athletic Meet 2026 (Dr. ACS-AURA 2026)</h1>
<h2>College Registration Status — Registered &amp; Not Registered</h2>
<div class="meta">Generated ${esc(stamp)} IST · ${reg.length + not.length} VTU colleges on the portal</div>
<div class="sum"><b>${reg.length}</b> colleges registered · <b>${not.length}</b> not registered ·
fee ${money(T)} · paid ${money(P)} · <b>balance ${money(B)}</b> across <b>${dueCount}</b> colleges
(${nilPay} registered colleges have paid nothing yet)</div>

<h3>Table 1 — Colleges Registered (fee account per college, both divisions added up)</h3>
${registeredTable(reg)}
<div class="note">One fee account per college: the Men's and Women's squads share it, so Total Amount, Amount Paid and
Balance cover both divisions. Entry fee ₹100 per individual event, ₹100 per half marathon, reserve events free,
₹100 per relay member for the first 4 members of each relay team (4x400m Mixed: ₹100 for each of a squad's own
first 2 members). Amount Paid counts only the bank-confirmed amount of VERIFIED payments; money submitted but not
yet verified is shown as a note under it. Balance is computed from the CURRENT roster, so a college that added
entries after paying shows a balance again.</div>

<div class="page-break"></div>
<h3>Table 2 — Colleges Not Yet Registered (no athlete on the portal) — Contact List</h3>
<div class="sum">${notRegisteredSummary(not)}</div>
${notRegisteredTable(not)}
<div class="note">${SOURCES_NOTE}</div>
</body></html>`;
}

const url = dbUrl();
const json = execFileSync('psql', [url, '-At', '-f', SQL], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const data = JSON.parse(json);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_HTML, render(data));
writeFileSync(NOT_HTML, renderNotRegistered(data.not_registered || []));
console.log(`HTML  ${OUT_HTML}`);
console.log(`HTML  ${NOT_HTML}`);

const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((bin) => {
  try {
    execFileSync('which', [bin], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) {
  console.warn('No Chrome/Chromium found — PDFs not generated. Print the HTML to PDF by hand.');
} else {
  for (const [html, pdf] of [
    [OUT_HTML, OUT_PDF],
    [NOT_HTML, NOT_PDF],
  ]) {
    execFileSync(
      chrome,
      ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file://${html}`],
      { stdio: 'pipe' }
    );
    console.log(`PDF   ${pdf}`);
  }
}
console.log(`registered ${data.registered.length} · not registered ${data.not_registered.length}`);
