/**
 * Official 4″ × 6″ (portrait) pass for everyone who is not an athlete (migration 0057):
 *   ACS FACULTY (blue)  · P.E.D. (purple) · VOLUNTEER (green) · TECHNICAL OFFICIAL (red)
 *
 * Same frame as the athlete card so the meet's cards look like one set. A coloured type bar
 * under the AURA title tells the food counter what kind of pass it is from a distance. There
 * is no photo: the signed QR takes its place, with the pass number under it.
 * ACS faculty and volunteer passes print blank lines for the name when none is on record, so
 * they can be printed in numbered batches and filled in by hand.
 * One pass per printed page (@page `idcard`), so "Save as PDF" gives a print-ready 4×6 file.
 */
import QRCode from 'react-qr-code';
import { PASS_TYPE, SCOPE_LABEL, formatPassNo, type DelegateRow } from '@/lib/delegates';
import './idcard.css';

export type PassDelegate = DelegateRow & { qr_token?: string | null };

function nameSize(name: string) {
  const n = name.length;
  if (n <= 14) return 19;
  if (n <= 18) return 17;
  if (n <= 24) return 14.5;
  return 12.5;
}

export default function DelegatePass({ delegate: d }: { delegate: PassDelegate }) {
  const type = PASS_TYPE[d.category];
  const name = (d.full_name || '').trim().toUpperCase();
  const cancelled = d.accreditation_status === 'WITHDRAWN';
  const band = d.category === 'OFFICIAL' ? (d.designation || type.band).toUpperCase() : type.band;

  return (
    <article className={`idc-card idc-pass t-${type.theme}`} aria-label={`${type.word} pass ${d.pass_no}`}>
      {/* Decorative layers */}
      <div className="idc-bg" aria-hidden="true">
        <span className="idc-stripe idc-stripe-1" />
        <span className="idc-stripe idc-stripe-2" />
        <svg className="idc-wave" viewBox="0 0 384 78" preserveAspectRatio="none">
          <path className="idc-wave-gold" d="M0 78 L0 70 C 140 70, 260 60, 384 4 L384 78 Z" />
          <path className="idc-wave-navy" d="M0 78 L0 74 C 150 74, 270 66, 384 14 L384 78 Z" />
        </svg>
      </div>

      {/* 1. Banner header: ACS left, VTU right */}
      <header className="idc-head">
        {/* eslint-disable-next-line @next/next/no-img-element -- print needs the plain image, not a lazy next/image */}
        <img className="idc-logo" src="/id-card/acs-logo.webp" alt="Dr. ACS College of Engineering" />
        <div className="idc-head-text">
          <div className="idc-univ">Visvesvaraya Technological University</div>
          <div className="idc-meet">VTU&rsquo;s 28<sup>th</sup> Inter-Collegiate State Level Athletic Meet 2026</div>
          <div className="idc-org">Organised by</div>
          <div className="idc-host">Dr. ACS College of Engineering</div>
          <div className="idc-host-sub">An Autonomous Institution · Bengaluru</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img className="idc-logo" src="/id-card/vtu-logo.webp" alt="Visvesvaraya Technological University" />
      </header>

      {/* 2. Meet title */}
      <div className="idc-title">
        <div className="idc-title-dr">Dr. ACS</div>
        <div className="idc-title-aura">AURA</div>
        <div className="idc-title-year">
          <span className="idc-rule" />
          <span>2026</span>
          <span className="idc-rule" />
        </div>
      </div>

      {/* 3. Pass type */}
      <div className="idc-typebar">
        <span>{type.word}</span>
      </div>

      {/* 4. Body — QR in the photo's place, pass number under it */}
      <div className="idc-pbody">
        <div className="idc-pleft">
          <div className="idc-pqr">
            <span className="idc-qr-c tl" />
            <span className="idc-qr-c tr" />
            <span className="idc-qr-c bl" />
            <span className="idc-qr-c br" />
            {d.qr_token ? (
              <QRCode value={d.qr_token} size={256} viewBox="0 0 256 256" style={{ width: '100%', height: '100%' }} fgColor="#0f1e3d" />
            ) : (
              <div className="idc-qr-missing">QR unavailable</div>
            )}
          </div>
          <div className="idc-pqr-label">SCAN FOR MEALS{d.accommodation_required ? ' & STAY' : ''}</div>
          <div className="idc-ppass">
            <div className="idc-ppass-l">PASS NO</div>
            <div className="idc-ppass-n">{formatPassNo(d.pass_no)}</div>
          </div>
        </div>

        <div className="idc-pright">
          <div className="idc-pband">{band}</div>
          <Details d={d} name={name} />
          <div className="idc-pnote">Free pass · Not transferable · Report loss to the meet office</div>
        </div>
      </div>

      {cancelled && <div className="idc-pvoid">CANCELLED</div>}

      {/* 5. Footer */}
      <footer className="idc-foot">
        <div className="idc-foot-item">
          <Icon d={CAL} />
          <span className="idc-foot-date">07 – 10 DEC 2026</span>
        </div>
        <span className="idc-foot-sep" />
        <div className="idc-foot-item">
          <Icon d={PIN} />
          <span className="idc-foot-venue">
            Dr. ACS College of Engineering,
            <br />
            Mysore Road, Bengaluru
          </span>
        </div>
      </footer>
    </article>
  );
}

/** The right-hand column: different for each kind of pass. */
function Details({ d, name }: { d: PassDelegate; name: string }) {
  const nameEl = (
    <div className="idc-pname" style={{ fontSize: nameSize(name) }}>
      {name}
    </div>
  );

  switch (d.category) {
    case 'FACULTY':
      return (
        <>
          {name ? nameEl : <Blank label="NAME (write in capitals)" lines={2} />}
          {d.department ? <Row k="DEPARTMENT" v={d.department} /> : <Blank label="DEPARTMENT" />}
          <div className="idc-pcollege">
            Dr. ACS College of Engineering
            <small>Host institution</small>
          </div>
        </>
      );

    case 'VOLUNTEER':
      return (
        <>
          {name ? nameEl : <Blank label="NAME" lines={2} />}
          <Blank label="DUTY / AREA" />
          <div className="idc-pcollege">AURA 2026 Organising Committee</div>
        </>
      );

    case 'PED':
      return (
        <>
          {nameEl}
          <div className="idc-pcollege">{d.colleges?.name || d.colleges?.code || ''}</div>
          {d.colleges?.region && <Row k="DIVISION" v={d.colleges.region} />}
          {d.phone && <Row k="MOBILE" v={d.phone} />}
          <Row k="IN CHARGE OF" v={d.squad_scope === 'BOTH' ? 'Men’s & Women’s squads' : SCOPE_LABEL[d.squad_scope]} />
        </>
      );

    default:
      return (
        <>
          {name ? nameEl : <Blank label="NAME" lines={2} />}
          {d.organisation && <div className="idc-pcollege">Deputed by: {d.organisation}</div>}
          <Row k="ROLE" v={d.designation || 'Technical Official'} />
          {d.phone && <Row k="MOBILE" v={d.phone} />}
        </>
      );
  }
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="idc-prow">
      <div className="idc-k">{k}</div>
      <div className="idc-v">{v}</div>
    </div>
  );
}

function Blank({ label, lines = 1 }: { label: string; lines?: number }) {
  return (
    <div className="idc-pblank">
      <div className="idc-k">{label}</div>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="idc-pline" />
      ))}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <span className="idc-ico-s">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} />
      </svg>
    </span>
  );
}

// Material icon paths (Apache 2.0)
const CAL =
  'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z';
const PIN = 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z';
