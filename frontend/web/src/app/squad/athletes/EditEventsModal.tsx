'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { updateAthleteEventsAction } from '@/app/actions/athletes';
import { DB_CODE_TO_OFFICIAL_MAP } from '@/lib/championship-events';

interface EventItem {
  id: string;
  name: string;
  code: string;
  category: string;
}

interface RegistrationItem {
  kind: 'regular' | 'reserve' | 'relay' | 'half_marathon';
  event_id: string;
  events?: EventItem;
}

interface AthleteWithRegs {
  id: string;
  sslc_name: string;
  usn: string;
  registrations: RegistrationItem[];
}

interface Props {
  athlete: AthleteWithRegs;
  /** The whole squad roster (this athlete included); quotas count the other athletes only */
  athletes: AthleteWithRegs[];
  availableEvents: EventItem[];
  /** Mixed-relay nominations from the other division of this college */
  siblingMixedCount: number;
  onClose: () => void;
  onSaved: () => void;
}

const up = (c?: string) => String(c || '').toUpperCase();
const isRelay100 = (c?: string) => ['4X100M-M', '4X100M-W'].includes(up(c));
const isRelay400 = (c?: string) => ['4X400M-M', '4X400M-W'].includes(up(c));
const isMixed = (c?: string) => up(c) === '4X400M-MIX';

/**
 * Changes an athlete's events with the same VTU rules as registration (Event 1 / 2, one free
 * reserve, one divisional relay, Mixed Relay, Half Marathon). Opened only after the server
 * confirmed the college has not paid yet; the server checks everything again on save.
 */
export default function EditEventsModal({ athlete, athletes, availableEvents, siblingMixedCount, onClose, onSaved }: Props) {
  const regs = athlete.registrations;
  const regulars = regs.filter((r) => r.kind === 'regular').map((r) => r.event_id);

  const [event1, setEvent1] = useState(regulars[0] || '');
  const [event2, setEvent2] = useState(regulars[1] || '');
  const [reserveEvent, setReserveEvent] = useState(regs.find((r) => r.kind === 'reserve')?.event_id || '');
  const [relayChoice, setRelayChoice] = useState<'none' | '4x100' | '4x400'>(
    regs.some((r) => isRelay100(r.events?.code)) ? '4x100' : regs.some((r) => isRelay400(r.events?.code)) ? '4x400' : 'none'
  );
  const [isMixedRelay, setIsMixedRelay] = useState(regs.some((r) => isMixed(r.events?.code)));
  const [isHalfMarathon, setIsHalfMarathon] = useState(regs.some((r) => r.kind === 'half_marathon'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, saving]);

  const individualEvents = useMemo(
    () =>
      availableEvents
        .filter(
          (e) =>
            !e.category?.toLowerCase().includes('relay') &&
            (e.category?.toLowerCase() !== 'road' || up(e.code).startsWith('20KM-W')) &&
            !e.code?.includes('4X100') &&
            !e.code?.includes('4X400') &&
            !up(e.code).startsWith('HM-')
        )
        .map((ev) => {
          const meta = DB_CODE_TO_OFFICIAL_MAP[ev.code];
          return {
            ...ev,
            codeNum: meta?.codeNum || 99,
            officialName: meta?.officialName || ev.name,
            categoryGroup: meta?.categoryGroup || ev.category?.toUpperCase(),
          };
        })
        .sort((a, b) => a.codeNum - b.codeNum),
    [availableEvents]
  );

  // Quotas count the OTHER athletes of the squad: this athlete's own entries are being replaced
  const others = athletes.filter((a) => a.id !== athlete.id);
  const regularCount = (eventId: string) =>
    others.reduce((n, a) => n + a.registrations.filter((r) => r.kind === 'regular' && r.event_id === eventId).length, 0);
  const isFull = (eventId: string) => regularCount(eventId) >= 2;
  const others100 = others.filter((a) => a.registrations.some((r) => isRelay100(r.events?.code))).length;
  const others400 = others.filter((a) => a.registrations.some((r) => isRelay400(r.events?.code))).length;
  const othersMixedOwn = others.filter((a) => a.registrations.some((r) => isMixed(r.events?.code))).length;
  const relay100Full = others100 >= 6;
  const relay400Full = others400 >= 6;
  const mixedFull = othersMixedOwn >= 3 || othersMixedOwn + siblingMixedCount >= 6;

  const standalone = relayChoice !== 'none' || isMixedRelay || isHalfMarathon;
  const reserveBlocked = !event1 && !event2;

  async function handleSave() {
    setError(null);
    if (!event1 && !standalone) return setError('Event 1 is compulsory unless registering for a Relay (4x100m, 4x400m, Mixed) or Half Marathon.');
    if (event2 && !event1) return setError('Choose Event 1 before Event 2.');
    if (event2 && event1 === event2) return setError('Event 2 cannot be the same as Event 1.');
    if (reserveEvent && reserveBlocked) {
      return setError('VTU Regulation (Rule 14): A reserve event can only be nominated if the athlete is registered for an individual regular event.');
    }
    if (reserveEvent && (reserveEvent === event1 || reserveEvent === event2)) return setError('Reserve Event must be different from regular registered events.');
    if (event1 && isFull(event1)) return setError('Event 1 quota is full: your college already has 2 athletes in that event.');
    if (event2 && isFull(event2)) return setError('Event 2 quota is full: your college already has 2 athletes in that event.');
    if (relayChoice === '4x100' && relay100Full) return setError('4x100m Relay quota is full (6 athletes per squad).');
    if (relayChoice === '4x400' && relay400Full) return setError('4x400m Relay quota is full (6 athletes per squad).');
    if (isMixedRelay && mixedFull) return setError('Mixed Relay quota is full (3 per squad, 6 per college).');

    const fd = new FormData();
    fd.set('profileId', athlete.id);
    fd.set('event1Id', event1);
    if (event2) fd.set('event2Id', event2);
    if (reserveEvent && !reserveBlocked) fd.set('reserveEventId', reserveEvent);
    fd.set('relayChoice', relayChoice);
    fd.set('isMixedRelay', isMixedRelay ? 'true' : 'false');
    fd.set('isHalfMarathon', isHalfMarathon ? 'true' : 'false');

    setSaving(true);
    try {
      const res = await updateAthleteEventsAction(fd);
      if (res.success) onSaved();
      else setError(res.error || 'Failed to update events.');
    } catch (err: any) {
      setError(err?.message || 'Failed to update events.');
    } finally {
      setSaving(false);
    }
  }

  const eventOption = (ev: (typeof individualEvents)[number], checkQuota: boolean) => {
    const full = checkQuota && isFull(ev.id);
    return (
      <option key={ev.id} value={ev.id} disabled={full}>
        [Code {ev.codeNum}] {ev.officialName} ({ev.categoryGroup}){full ? ' — College quota full (2/2)' : ''}
      </option>
    );
  };

  const fee = (event1 ? 100 : 0) + (event2 ? 100 : 0) + (isHalfMarathon ? 100 : 0);

  return createPortal(
    <div
      id="modal-edit-events-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: 'clamp(0.5rem, 3vw, 1.5rem)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-events-title"
        style={{
          width: '100%',
          maxWidth: '640px',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 'var(--radius-md, 12px)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
          padding: 'clamp(1rem, 4vw, 1.75rem)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h2 id="edit-events-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Edit Events
            </h2>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {athlete.sslc_name} · {athlete.usn}. Events can be changed only until the college pays the entry fee.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: 'var(--danger, #dc2626)',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={boxStyle('var(--accent-primary)')}>
            <label style={labelStyle} htmlFor="ee-event1">
              Event 1 {standalone ? '(Optional — relay / Half Marathon selected)' : '(Compulsory) *'} · ₹100
            </label>
            <select
              id="ee-event1"
              value={event1}
              onChange={(e) => {
                setEvent1(e.target.value);
                if (e.target.value === event2) setEvent2('');
                if (e.target.value === reserveEvent) setReserveEvent('');
              }}
              style={inputStyle}
            >
              <option value="">-- Choose Individual Event 1 --</option>
              {individualEvents.map((ev) => eventOption(ev, ev.id !== event1))}
            </select>
          </div>

          <div style={boxStyle('var(--accent-secondary)')}>
            <label style={labelStyle} htmlFor="ee-event2">Event 2 (Optional) · +₹100</label>
            <select
              id="ee-event2"
              value={event2}
              disabled={!event1}
              onChange={(e) => {
                setEvent2(e.target.value);
                if (e.target.value === reserveEvent) setReserveEvent('');
              }}
              style={inputStyle}
            >
              <option value="">-- None (Single Event Only) --</option>
              {individualEvents.filter((ev) => ev.id !== event1).map((ev) => eventOption(ev, ev.id !== event2))}
            </select>
          </div>

          <div style={{ ...boxStyle(reserveBlocked ? 'var(--border-color)' : 'var(--warning)'), opacity: reserveBlocked ? 0.7 : 1 }}>
            <label style={labelStyle} htmlFor="ee-reserve">
              Reserve Event {reserveBlocked ? '(needs Event 1 — Rule 14)' : '(Optional — 1 Reserve, free)'}
            </label>
            <select
              id="ee-reserve"
              value={reserveBlocked ? '' : reserveEvent}
              disabled={reserveBlocked}
              onChange={(e) => setReserveEvent(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- None (No Reserve Discipline) --</option>
              {!reserveBlocked &&
                individualEvents
                  .filter((ev) => ev.id !== event1 && ev.id !== event2)
                  .map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      [Code {ev.codeNum}] {ev.officialName} ({ev.categoryGroup})
                    </option>
                  ))}
            </select>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <div style={{ ...labelStyle, fontWeight: 700 }}>Divisional Relay (VTU Rule 3: max 1)</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {(
                [
                  ['none', 'No Relay', false],
                  ['4x100', `4x100m Relay${relay100Full ? ' (full)' : ''}`, relay100Full],
                  ['4x400', `4x400m Relay${relay400Full ? ' (full)' : ''}`, relay400Full],
                ] as const
              ).map(([value, label, full]) => {
                const disabled = full && relayChoice !== value;
                return (
                  <label key={value} style={{ ...chipStyle(relayChoice === value), opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="radio"
                      name="ee-relay"
                      value={value}
                      checked={relayChoice === value}
                      disabled={disabled}
                      onChange={() => setRelayChoice(value)}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ ...chipStyle(isMixedRelay), opacity: mixedFull && !isMixedRelay ? 0.6 : 1 }}>
              <input
                type="checkbox"
                checked={isMixedRelay}
                disabled={mixedFull && !isMixedRelay}
                onChange={(e) => setIsMixedRelay(e.target.checked)}
              />
              4x400m Mixed Relay{mixedFull && !isMixedRelay ? ' (full)' : ''}
            </label>
            <label style={chipStyle(isHalfMarathon)}>
              <input type="checkbox" checked={isHalfMarathon} onChange={(e) => setIsHalfMarathon(e.target.checked)} />
              Half Marathon (21km) · ₹100
            </label>
          </div>

          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Individual events and Half Marathon for this athlete: ₹{fee}. Relay fees are per team (₹100 for each of the first 4 members).
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={onClose} disabled={saving} style={secondaryBtn}>
              Cancel
            </button>
            <button
              type="button"
              id="btn-save-events-edit"
              onClick={handleSave}
              disabled={saving}
              style={{ ...primaryBtn, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Events'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const boxStyle = (accent: string): React.CSSProperties => ({
  background: 'var(--bg-tertiary)',
  padding: '0.9rem 1rem',
  borderRadius: 'var(--radius-sm)',
  borderLeft: `4px solid ${accent}`,
});

const chipStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.55rem 0.85rem',
  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
  background: active ? 'rgba(37, 99, 235, 0.05)' : 'var(--bg-tertiary)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  cursor: 'pointer',
});

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: '0.4rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.95rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const secondaryBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  padding: '0.7rem 1.25rem',
  borderRadius: 'var(--radius-sm)',
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--accent-primary)',
  color: '#fff',
  border: 'none',
  padding: '0.7rem 1.5rem',
  borderRadius: 'var(--radius-sm)',
  fontWeight: 800,
};
