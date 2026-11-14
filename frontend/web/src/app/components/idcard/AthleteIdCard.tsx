/**
 * Official 4″ × 6″ (portrait) athlete accreditation card — Dr. ACS AURA 2026.
 * Header mirrors the meet banner (ACS crest left, VTU seal right); the body keeps photo, bib and
 * QR on the left and name, college, date of birth, blood group and events on the right.
 * One card per printed page (named @page `idcard`), so "Save as PDF" gives a print-ready 4×6 PDF.
 */
import QRCode from 'react-qr-code';
import './idcard.css';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2005-03-14" → "14 MAR 2005" (no Date parsing, so no timezone shift) */
function fmtDob(v?: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}` : '—';
}

const KIND_ORDER: Record<string, number> = { regular: 0, half_marathon: 1, relay: 2, reserve: 3 };

export type IdCardAthlete = {
  id: string;
  sslc_name?: string | null;
  bid_number?: number | null;
  photo_url?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  qr_token?: string | null;
  squads?: { squad_code?: string | null; colleges?: { name?: string | null; code?: string | null } | null } | null;
  registrations?: { kind?: string | null; events?: { name?: string | null } | null }[] | null;
};

function nameSize(name: string) {
  const n = name.length;
  if (n <= 12) return 25;
  if (n <= 16) return 21;
  if (n <= 21) return 17.5;
  if (n <= 27) return 14.5;
  return 12.5;
}

export default function AthleteIdCard({ athlete }: { athlete: IdCardAthlete }) {
  const name = (athlete.sslc_name || '').toUpperCase();
  const college = athlete.squads?.colleges;
  const collegeCode = college?.code || athlete.squads?.squad_code || '—';
  const events = [...(athlete.registrations || [])]
    .filter((r) => r.events?.name)
    .sort((a, b) => (KIND_ORDER[a.kind || ''] ?? 9) - (KIND_ORDER[b.kind || ''] ?? 9))
    .map((r) => ({ name: r.events!.name as string, reserve: r.kind === 'reserve' }));

  return (
    <article className="idc-card" aria-label={`ID card ${name}`}>
      {/* Decorative layers */}
      <div className="idc-bg" aria-hidden="true">
        <svg className="idc-lanes" viewBox="0 0 384 260" preserveAspectRatio="none">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path key={i} d={`M-20 ${150 + i * 13} C 110 ${95 + i * 15}, 250 ${210 + i * 9}, 404 ${120 + i * 14}`} />
          ))}
        </svg>
        <svg className="idc-runner" viewBox="0 0 24 24">
          <path d={RUN} />
        </svg>
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

      {/* 3. Body */}
      <div className="idc-body">
        <div className="idc-left">
          <div className="idc-photo">
            {athlete.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, printed as is
              <img src={athlete.photo_url} alt={name} />
            ) : (
              <svg viewBox="0 0 24 24" className="idc-photo-ph" aria-hidden="true">
                <path d={RUN} />
              </svg>
            )}
          </div>

          <div className="idc-bib">
            <div className="idc-bib-label">BIB NUMBER</div>
            <div className="idc-bib-num">{athlete.bid_number ?? '—'}</div>
          </div>

          <div className="idc-qr">
            <span className="idc-qr-c tl" />
            <span className="idc-qr-c tr" />
            <span className="idc-qr-c bl" />
            <span className="idc-qr-c br" />
            {athlete.qr_token ? (
              <QRCode value={athlete.qr_token} size={256} viewBox="0 0 256 256" style={{ width: '100%', height: 'auto' }} />
            ) : (
              <div className="idc-qr-missing">QR unavailable</div>
            )}
          </div>
          <div className="idc-qr-label">SCAN TO VERIFY</div>
        </div>

        <div className="idc-right">
          <div className="idc-role">ATHLETE</div>
          <div className="idc-name" style={{ fontSize: nameSize(name) }}>
            {name || '—'}
          </div>
          <div className="idc-college">{college?.name || ''}</div>

          <div className="idc-code">
            <span className="idc-k">COLLEGE CODE</span>
            <span className="idc-code-sep" />
            <span className="idc-code-v">{collegeCode}</span>
          </div>

          <Row icon={CAL} label="DATE OF BIRTH" value={fmtDob(athlete.date_of_birth)} />
          <Row icon={DROP} label="BLOOD GROUP" value={athlete.blood_group || '—'} stroke />
          <div className="idc-row idc-row-events">
            <Icon d={RUN} />
            <div>
              <div className="idc-k">EVENTS ({String(events.length).padStart(2, '0')})</div>
              <ul className="idc-events">
                {events.length ? (
                  events.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      {e.name}
                      {e.reserve && <em> (Reserve)</em>}
                    </li>
                  ))
                ) : (
                  <li>—</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Footer */}
      <footer className="idc-foot">
        <div className="idc-foot-item">
          <Icon d={CAL} small />
          <span className="idc-foot-date">07 – 10 DEC 2026</span>
        </div>
        <span className="idc-foot-sep" />
        <div className="idc-foot-item">
          <Icon d={PIN} small />
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

function Row({ icon, label, value, stroke }: { icon: string; label: string; value: string; stroke?: boolean }) {
  return (
    <div className="idc-row">
      <Icon d={icon} stroke={stroke} />
      <div>
        <div className="idc-k">{label}</div>
        <div className="idc-v">{value}</div>
      </div>
    </div>
  );
}

function Icon({ d, small, stroke }: { d: string; small?: boolean; stroke?: boolean }) {
  return (
    <span className={small ? 'idc-ico-s' : 'idc-ico'}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} className={stroke ? 'idc-stroke' : undefined} />
      </svg>
    </span>
  );
}

// Material icon paths (Apache 2.0)
const RUN =
  'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z';
const CAL =
  'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z';
const DROP = 'M12 3.2c-3.2 4-6 7.4-6 10.6a6 6 0 0 0 12 0c0-3.2-2.8-6.6-6-10.6z';
const PIN = 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z';
