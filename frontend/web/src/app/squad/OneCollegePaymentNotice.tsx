/**
 * ONE PAYMENT PER COLLEGE notice, shown to PEDs on the dashboard, athlete roster and payment page.
 * The Men's and Women's divisions of a college share one fee account: fees keep adding up across
 * both logins, and one payment from either login settles (and locks) both.
 */
export default function OneCollegePaymentNotice({
  menFee,
  womenFee,
  myGender,
  locked = false,
}: {
  menFee: number;
  womenFee: number;
  myGender: string;
  locked?: boolean;
}) {
  const isMen = myGender === 'men';
  const other = isMen ? 'Women' : 'Men';
  const total = menFee + womenFee;

  return (
    <div
      id="notice-one-college-payment"
      style={{
        padding: '0.9rem 1.15rem',
        borderRadius: '10px',
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        color: '#1e3a8a',
        fontSize: '0.9rem',
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: '0.25rem' }}>
        💡 One payment for your whole college 
      </div>
      <div>
        Fees of the Men and Women squads add up into one total:{' '}
        <strong>
          Men ₹{menFee} + Women ₹{womenFee} = ₹{total}
        </strong>
        .{' '}
        <>
          You can pay at any time, from either login, as many times as you like. Paying never locks the roster
          ({other} squad fees are added to the amount due until they are paid).
        </>
      </div>
    </div>
  );
}
