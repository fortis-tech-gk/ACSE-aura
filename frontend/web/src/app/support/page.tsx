import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import '../info-page.css';

export const metadata: Metadata = {
  title: 'App Support · Dr. ACS-AURA 2026',
  description: 'Help for the AURA Athletes app: logging in, your pass, reminders and contacts for the Dr. ACS-AURA 2026 athletic meet.',
};

export default function SupportPage() {
  return (
    <div className="info-page">
      <Navbar />
      <main className="info-main">
        <header className="info-head">
          <div className="info-kicker">AURA Athletes</div>
          <h1>App Support</h1>
          <p className="info-sub">Dr. ACS-AURA 2026 · 28th VTU State Level Inter-Collegiate Athletic Meet · 7–10 December 2026</p>
        </header>

        <section className="info-card">
          <h2>What the app is for</h2>
          <p>
            AURA Athletes is the official companion app for athletes registered by their college for the meet. It shows your digital pass and
            QR code, your events with heat, lane and call room times, reminders before each call room, your results and points, live college
            standings, and your hostel and meal details.
          </p>
        </section>

        <section className="info-card">
          <h2>Logging in</h2>
          <ul>
            <li>Enter the <strong>bib number</strong> printed on your ID card and your <strong>date of birth</strong> as on your SSLC certificate, or</li>
            <li>tap <strong>Scan the QR on my ID card</strong> and point the camera at the QR code on your own card.</li>
            <li>
              Bib numbers are issued after registration closes. If your date of birth is not accepted, ask your college&apos;s Physical Education
              Director to check it on the registration portal.
            </li>
          </ul>
        </section>

        <section className="info-card">
          <h2>Reminders</h2>
          <p>
            The app reminds you 30, 10 and 5 minutes before each call room time. Allow notifications when asked, or turn them on in the
            app&apos;s Settings. Your pass and schedule are saved on the phone, so reminders work even without internet.
          </p>
        </section>

        <section className="info-card">
          <h2>Contact</h2>
          <ul>
            <li>Questions about your registration, events or bib: your college&apos;s Physical Education Director.</li>
            <li>
              Meet office: Mr. Devendra Naik R. S., Organising Secretary · Phone <a href="tel:+918088891143">+91 80888 91143</a>
            </li>
            <li>
              Venue: Dr. ACS College of Engineering, No. 207, Kambipura, Mysore Road, Bengaluru 560 074 ·{' '}
              <a href="https://www.acsce.edu.in" target="_blank" rel="noreferrer">www.acsce.edu.in</a>
            </li>
            <li>
              <Link href="/privacy">Privacy policy</Link> · <Link href="/results">Live results</Link>
            </li>
          </ul>
        </section>

        <p className="info-foot">© 2026 Dr. ACS College of Engineering, Bengaluru</p>
      </main>
    </div>
  );
}
