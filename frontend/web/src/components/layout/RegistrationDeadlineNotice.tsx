/**
 * Notice shown on the public landing page and inside the squad portal:
 * registration deadline extended (29 Nov free, 30 Nov with a Rs 1,000 late fine).
 * Static text only — registration itself is opened/closed by the admin (meet_settings.registration_open).
 */
export function RegistrationDeadlineNotice() {
  return (
    <div
      role="status"
      style={{
        background: '#fffbeb',
        borderTop: '1px solid #fde68a',
        borderBottom: '1px solid #fde68a',
        borderLeft: '4px solid #d97706',
        color: '#78350f',
        padding: '0.75rem 1rem',
        fontSize: '0.92rem',
        lineHeight: 1.45,
        textAlign: 'center',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <strong>📢 Registration date extended:</strong> registrations are open without any fine till{' '}
      <strong>29 November 2026</strong>, and till <strong>30 November 2026</strong> with a late fine of{' '}
      <strong>₹1,000</strong>.
    </div>
  );
}
