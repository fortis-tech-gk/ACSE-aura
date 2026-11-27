/**
 * Official 4″ × 6″ (portrait) accreditation pass for everyone who is not an athlete —
 * college faculty, Physical Education Directors and the meet's own officials, referees
 * and volunteers (migration 0057).
 *
 * Same frame as the athlete card (AthleteIdCard) so a contingent's passes look like one
 * set; there is no photo, so the signed QR takes the photo's place and the pass number
 * sits under it. One pass per printed page (@page `idcard`), so "Save as PDF" gives a
 * print-ready 4×6 file.
 */
import QRCode from 'react-qr-code';
import { CATEGORY_LABEL, SCOPE_LABEL, formatPassNo, type DelegateRow } from '@/lib/delegates';
import './idcard.css';

export type PassDelegate = DelegateRow & { qr_token?: string | null };

/** The band across the top right: what this person is at the meet. */
function roleBand(d: PassDelegate): string {
  if (d.category === 'PED') return 'PHYSICAL EDUCATION DIRECTOR';
  if (d.category === 'FACULTY') return (d.designation || 'FACULTY').toUpperCase();
  return (d.designation || 'MEET OFFICIAL').toUpperCase();
}

function nameSize(name: string) {
  const n = name.length;
  if (n <= 12) return 25;
  if (n <= 16) return 21;
  if (n <= 21) return 17.5;
  if (n <= 27) return 14.5;
  return 12.5;
}

export default function DelegatePass({ delegate }: { delegate: PassDelegate }) {
  const name = (delegate.full_name || '').toUpperCase();
  const collegeName = delegate.colleges?.name || delegate.organisation || 'Meet Organising Committee';
  const collegeCode = delegate.colleges?.code || (delegate.category === 'OFFICIAL' ? 'AURA 2026' : '—');
  const band = roleBand(delegate);
  const cancelled = delegate.accreditation_status === 'WITHDRAWN';

  return (
    <article className="idc-card" aria-label={`Pass ${name}`}>
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

      {/* 3. Body — QR in the photo's place, pass number under it */}
      <div className="idc-body">
        <div className="idc-left">
          <div className="idc-qr idc-pass-qr">
            <span className="idc-qr-c tl" />
            <span className="idc-qr-c tr" />
            <span className="idc-qr-c bl" />
            <span className="idc-qr-c br" />
            {delegate.qr_token ? (
              <QRCode value={delegate.qr_token} size={256} viewBox="0 0 256 256" style={{ width: '100%', height: 'auto' }} />
            ) : (
              <div className="idc-qr-missing">QR unavailable</div>
            )}
          </div>
          <div className="idc-qr-label">SCAN FOR MEALS{delegate.accommodation_required ? ' & STAY' : ''}</div>

          <div className="idc-bib" style={{ marginTop: '10px' }}>
            <div className="idc-bib-label">PASS NO</div>
            <div className="idc-bib-num" style={{ fontSize: 26 }}>
              {formatPassNo(delegate.pass_no)}
            </div>
          </div>

          <span className={`idc-chip ${delegate.meals_included && !cancelled ? 'idc-chip-yes' : 'idc-chip-no'}`}>
            {cancelled ? 'Pass cancelled' : delegate.meals_included ? 'Meals included' : 'No meals'}
          </span>
        </div>

        <div className="idc-right">
          <div className="idc-role idc-role-pass">{band}</div>
          <div className="idc-name" style={{ fontSize: nameSize(name) }}>
            {name || '—'}
          </div>
          <div className="idc-college">{collegeName}</div>

          <div className="idc-code">
            <span className="idc-k">{delegate.category === 'OFFICIAL' ? 'ACCREDITATION' : 'COLLEGE CODE'}</span>
            <span className="idc-code-sep" />
            <span className="idc-code-v">{collegeCode}</span>
          </div>

          <Row
            icon={BADGE}
            label="CAPACITY"
            value={delegate.category === 'PED' ? CATEGORY_LABEL.PED : delegate.designation || CATEGORY_LABEL[delegate.category]}
            small
          />
          {delegate.category === 'OFFICIAL' ? (
            delegate.organisation ? <Row icon={PIN} label="DEPUTED BY" value={delegate.organisation} small /> : null
          ) : (
            <Row icon={PIN} label="CONTINGENT" value={SCOPE_LABEL[delegate.squad_scope] || '—'} small />
          )}
          <Row icon={DROP} label="BLOOD GROUP" value={delegate.blood_group || '—'} stroke />
          <Row icon={PHONE} label="MOBILE" value={delegate.phone || '—'} small />

          <div className="idc-pass-foot-note">
            Not transferable · Valid only with a photo ID · Report loss to the meet office
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

function Row({
  icon,
  label,
  value,
  stroke,
  small,
}: {
  icon: string;
  label: string;
  value: string;
  stroke?: boolean;
  small?: boolean;
}) {
  return (
    <div className="idc-row">
      <Icon d={icon} stroke={stroke} />
      <div style={{ minWidth: 0 }}>
        <div className="idc-k">{label}</div>
        <div className="idc-v" style={small ? { fontSize: 11, lineHeight: 1.2 } : undefined}>
          {value}
        </div>
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
const BADGE =
  'M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-2 .89-2 2v11c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6-2v2h-4V4h4zm-2 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm5 9H7v-1c0-1.66 2.24-3 5-3s5 1.34 5 3v1z';
const PHONE =
  'M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
