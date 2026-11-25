// Mirror of frontend/web/src/lib/certificate-template.ts — keep the two in sync.
/**
 * Digital Certificate of Participation — pure HTML template (A4 landscape).
 *
 * Self-contained: no React, no DB. Feed it the athlete data and render the returned HTML to
 * PDF / PNG (headless Chrome) when generating the certificate that is emailed to a participant.
 * Logos are passed in as data URIs by the caller so the file renders anywhere, offline.
 */

export interface CertificateData {
  athleteName: string;
  usn: string;
  collegeName: string;
  /** e.g. "AURA26-0412" — printed small at the bottom for verification */
  certificateNo: string;
  /** Events the athlete was registered for, shown under the main line (optional) */
  events?: string[];
}

export interface CertificateAssets {
  vtuLogo: string; // data URI
  hostLogo: string; // data URI (Dr. ACS crest)
  /** @font-face CSS with the fonts embedded (offline / expo-print). Omit to load Google Fonts. */
  fontCss?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Material "directions run" glyph — same runner as the accreditation ID card */
const RUN =
  'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z';

/** Lane curves, mirrored from the ID card background */
const lanes = (flip: boolean) =>
  [0, 1, 2, 3, 4, 5, 6]
    .map((i) => `<path d="M-20 ${70 + i * 9} C 60 ${40 + i * 10}, 120 ${95 + i * 6}, 190 ${60 + i * 9}" ${flip ? 'transform="translate(297 0) scale(-1 1)"' : ''}/>`)
    .join('');

export function certificateHtml(d: CertificateData, a: CertificateAssets): string {
  const events = (d.events || []).filter(Boolean);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Certificate of Participation — ${esc(d.athleteName)}</title>
${a.fontCss ? `<style>${a.fontCss}</style>` : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Cinzel+Decorative:wght@700;900&family=Montserrat:wght@500;600;700&family=Cormorant+Garamond:ital,wght@1,500;1,600&display=swap" rel="stylesheet">`}
<style>
  @page { size: 297mm 210mm; margin: 0; }
  :root { --navy:#0f1e3d; --navy2:#1b2f5c; --gold:#c0962f; --gold2:#f3dc94; --gold3:#9a7426; --maroon:#8b1a1a; --muted:#4b5563; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 297mm; height: 210mm; }
  body { font-family: 'Montserrat', sans-serif; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { position: relative; width: 297mm; height: 210mm; overflow: hidden;
    background: radial-gradient(120% 60% at 50% 0%, #fff 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, #fffdf7 0%, #fbf5e6 55%, #f1e8d0 100%); }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .lanes path { fill: none; stroke: #e3d6b0; stroke-width: .35; }
  .frame { position: absolute; inset: 6mm 6mm 14mm 6mm; border: 1.4mm solid transparent; border-image: linear-gradient(135deg, var(--gold3), var(--gold2), var(--gold), var(--gold3)) 1; }
  .frame2 { position: absolute; inset: 9.5mm 9.5mm 17.5mm 9.5mm; border: .3mm solid var(--gold); }
  .c { position: absolute; left: 0; right: 0; text-align: center; }

  .head { top: 12mm; display: flex; align-items: center; justify-content: center; gap: 9mm; }
  .head img { width: 23mm; height: 23mm; object-fit: contain; }
  .univ { font-family: 'Cinzel', serif; font-weight: 800; font-size: 6.4mm; letter-spacing: .25mm; color: var(--navy); text-transform: uppercase; }
  .meet { font-family: 'Cinzel', serif; font-weight: 700; font-size: 4.1mm; color: var(--navy2); margin-top: 1.2mm; }
  .meet sup { font-size: 2.6mm; }
  .org { font-size: 2.7mm; letter-spacing: .5mm; text-transform: uppercase; color: var(--muted); margin-top: 2mm; font-weight: 600; }
  .host { font-family: 'Cinzel', serif; font-weight: 800; font-size: 5.4mm; color: var(--maroon); margin-top: .6mm; }
  .hsub { font-size: 2.7mm; color: var(--muted); margin-top: .6mm; }

  .t-dr { top: 42mm; font-family: 'Cinzel', serif; font-weight: 800; font-size: 5.4mm; letter-spacing: 1.2mm; color: var(--maroon); }
  .t-aura { top: 48mm; font-family: 'Cinzel Decorative', serif; font-weight: 900; font-size: 14mm; letter-spacing: 1.2mm; line-height: 1.1;
    background: linear-gradient(180deg, #fff3c4 0%, #e9c768 28%, #b8862b 52%, #f2d785 70%, #8f6720 100%); -webkit-background-clip: text; background-clip: text; color: transparent; width: max-content; left: 50%; right: auto; transform: translateX(-50%); filter: drop-shadow(0 .25mm 0 rgba(120,80,10,.35)); }
  .t-year { top: 63mm; display: flex; justify-content: center; align-items: center; gap: 4mm; font-family: 'Cinzel', serif; font-weight: 700; font-size: 4.4mm; color: var(--navy); letter-spacing: 1mm; }
  .t-year i { width: 26mm; height: .5mm; }
  .t-year i:first-child { background: linear-gradient(90deg, transparent, var(--gold)); }
  .t-year i:last-child { background: linear-gradient(90deg, var(--gold), transparent); }

  .cop { top: 72mm; font-family: 'Cinzel', serif; font-weight: 800; font-size: 9.4mm; letter-spacing: 1.2mm; text-transform: uppercase; background: linear-gradient(180deg, #1b2f5c 0%, #0f1e3d 100%); -webkit-background-clip: text; background-clip: text; color: transparent; width: max-content; left: 50%; right: auto; transform: translateX(-50%); }
  .cop-sub { top: 84.5mm; display: flex; justify-content: center; align-items: center; gap: 3mm; }
  .cop-sub i { width: 44mm; height: .5mm; background: linear-gradient(90deg, transparent, var(--gold), transparent); }
  .cop-sub svg { width: 6mm; height: 6mm; fill: var(--navy); }

  .body { top: 89mm; left: 30mm; right: 30mm; font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 600; font-size: 5.4mm; line-height: 1.5; color: var(--navy2); }
  .body .sent { margin-top: 3mm; }
  .body .lead { font-family: 'Montserrat', sans-serif; font-style: normal; letter-spacing: .8mm; color: var(--gold3); font-size: 3.3mm; text-transform: uppercase; font-weight: 700; }
  .name { font-family: 'Cinzel Decorative', serif; font-weight: 700; color: var(--navy); line-height: 1.25; margin-top: 2.5mm; padding: 0 12mm 1.5mm; display: inline-block; font-style: normal;
    border-bottom: .5mm solid transparent; border-image: linear-gradient(90deg, transparent, var(--gold), transparent) 1; text-transform: uppercase; letter-spacing: .3mm; }
  .usn { font-family: 'Montserrat', sans-serif; font-style: normal; font-size: 3.2mm; font-weight: 600; color: var(--muted); letter-spacing: .6mm; margin-top: 2mm; }
  .college { font-family: 'Cinzel', serif; font-style: normal; font-weight: 800; font-size: 5.4mm; color: var(--maroon); margin-top: 3mm; }
  .events { margin-top: 3mm; font-family: 'Montserrat', sans-serif; font-style: normal; font-size: 3mm; color: var(--gold3); font-weight: 700; letter-spacing: .5mm; }

  .sigs { bottom: 22mm; display: flex; justify-content: center; gap: 16mm; padding: 0 24mm; }
  .sig { width: 76mm; border-top: .5mm solid var(--gold); padding-top: 1.6mm; font-size: 2.6mm; line-height: 1.5; color: var(--gold3); font-weight: 600; letter-spacing: .15mm; text-transform: uppercase; }
  .sig b { display: block; font-family: 'Cinzel', serif; font-size: 3mm; color: var(--navy); }

  .seal { position: absolute; left: 50%; top: 188.5mm; width: 19mm; height: 19mm; z-index: 5; transform: translateX(-50%); }
  .corner { position: absolute; width: 14mm; height: 14mm; }
  .foot { bottom: 3.6mm; display: grid; grid-template-columns: 1fr 34mm 1fr; align-items: center; padding: 0 22mm; font-size: 2.5mm; letter-spacing: .4mm; font-weight: 700; color: #fff; }
  .fl { display: flex; gap: 5mm; justify-content: flex-end; }
  .fr { text-align: left; }
  .foot .g { color: var(--gold2); }
  .no { bottom: 8mm; font-size: 2.4mm; letter-spacing: .4mm; color: rgba(255,255,255,.7); }
</style></head>
<body>
<div class="page">
  <svg class="bg" viewBox="0 0 297 210" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <g class="lanes">${lanes(false)}</g>
    <g class="lanes" transform="translate(0 70)">${lanes(true)}</g>
    <path d="M0 210 L0 200 C 100 201, 200 198, 297 195 L297 210 Z" fill="#c9a24a"/>
    <path d="M0 210 L0 203 C 100 204, 200 202, 297 200 L297 210 Z" fill="#0f1e3d"/>
  </svg>
  <svg style="position:absolute;left:18mm;top:96mm;width:44mm;height:44mm;opacity:.045" viewBox="0 0 24 24"><path d="${RUN}" fill="#0f1e3d"/></svg>
  <svg style="position:absolute;right:18mm;top:96mm;width:44mm;height:44mm;opacity:.045;transform:scaleX(-1)" viewBox="0 0 24 24"><path d="${RUN}" fill="#0f1e3d"/></svg>
  <div class="frame"></div><div class="frame2"></div>
  ${['top:12.5mm;left:12.5mm','top:12.5mm;right:12.5mm;transform:scaleX(-1)','bottom:20.5mm;left:12.5mm;transform:scaleY(-1)','bottom:20.5mm;right:12.5mm;transform:scale(-1,-1)']
    .map((st) => `<svg class="corner" style="${st}" viewBox="0 0 14 14" fill="none" stroke="#c9a24a" stroke-width=".5"><path d="M0 12 C6 12 12 6 12 0"/><path d="M0 8.5 C4.5 8.5 8.5 4.5 8.5 0"/><circle cx="3" cy="3" r="1.1" fill="#c9a24a" stroke="none"/></svg>`).join('')}
  <svg class="seal" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="sg" cx=".4" cy=".35"><stop offset="0" stop-color="#fff3c4"/><stop offset=".55" stop-color="#e2b43c"/><stop offset="1" stop-color="#9a7426"/></radialGradient>
      </defs>
    <path d="M30 78 L22 99 L40 91 L50 100 L60 91 L78 99 L70 78 Z" fill="#b8862b"/>
    <circle cx="50" cy="46" r="45" fill="url(#sg)"/>
    <circle cx="50" cy="46" r="38" fill="none" stroke="#fff6d6" stroke-width="1.2"/>
    <circle cx="50" cy="46" r="29" fill="#0f1e3d"/>
    <svg x="28" y="24" width="44" height="44" viewBox="0 0 24 24"><path d="${RUN}" fill="#f3dc94"/></svg>
  </svg>

  <div class="c head">
    <img src="${a.hostLogo}" alt="">
    <div>
      <div class="univ">Visvesvaraya Technological University</div>
      <div class="meet">VTU&rsquo;s 28<sup>th</sup> Inter-Collegiate State Level Athletic Meet 2026</div>
      <div class="org">Organised by</div>
      <div class="host">Dr. ACS College of Engineering</div>
    </div>
    <img src="${a.vtuLogo}" alt="">
  </div>

  <div class="c t-dr">Dr. ACS</div>
  <div class="c t-aura">AURA</div>
  <div class="c t-year"><i></i><span>2026</span><i></i></div>

  <div class="c cop">Certificate of Participation</div>

  <div class="c body">
    <div class="lead">This is to certify that</div>
    <div class="name" style="font-size:${d.athleteName.length <= 18 ? 9.5 : d.athleteName.length <= 26 ? 7.8 : 6.4}mm">${esc(d.athleteName)}</div>
    <div class="usn">USN · ${esc(d.usn)}</div>
    <div class="college">${esc(d.collegeName)}</div>
    <div class="sent">has participated in the 28th VTU Inter-Collegiate State Level Athletic Meet 2026<br>(Dr. ACS-AURA 2026), held at Dr. ACS College of Engineering, Bengaluru, from 7th to 10th December 2026.</div>
    ${events.length ? `<div class="events">EVENTS &nbsp;·&nbsp; ${events.map(esc).join('  ·  ')}</div>` : ''}
  </div>

  <div class="c sigs">
    <div class="sig"><b>Organizing Secretary</b>Dr. ACS-AURA 2026<br>Dr. ACS College of Engineering</div>
    <div class="sig"><b>Director of Physical Education</b>VTU, Belagavi</div>
    <div class="sig"><b>Principal &amp; Chairman</b>Dr. ACS-AURA 2026<br>Dr. ACS College of Engineering</div>
  </div>

  <div class="c foot"><span class="fl"><span class="g">07 – 10 DEC 2026</span><span>|</span><span>MYSORE ROAD, BENGALURU</span></span><span></span><span class="fr g">CERTIFICATE NO. ${esc(d.certificateNo)}</span></div>
</div>
</body></html>`;
}
