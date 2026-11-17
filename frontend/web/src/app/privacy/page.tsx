import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import '../info-page.css';

export const metadata: Metadata = {
  title: 'Privacy Policy · Dr. ACS-AURA 2026',
  description: 'How the Dr. ACS-AURA 2026 registration website and the AURA Athletes and AURA Officials apps use personal information.',
};

const UPDATED = '15 November 2026';

export default function PrivacyPage() {
  return (
    <div className="info-page">
      <Navbar />
      <main className="info-main">
        <header className="info-head">
          <div className="info-kicker">Dr. ACS-AURA 2026</div>
          <h1>Privacy Policy</h1>
          <p className="info-sub">
            For the registration website and the AURA Athletes and AURA Officials apps · Last updated {UPDATED}
          </p>
        </header>

        <section className="info-card">
          <h2>Who we are</h2>
          <p>
            Dr. ACS-AURA 2026, the 28th VTU State Level Inter-Collegiate Athletic Meet, is organised by Dr. ACS College of Engineering,
            Bengaluru, under Visvesvaraya Technological University (VTU), Belagavi. This policy explains what information the meet&apos;s
            website and apps use, why, and how it is protected.
          </p>
        </section>

        <section className="info-card">
          <h2>Information we hold</h2>
          <p>Each participating college&apos;s Physical Education Director registers its athletes on this website. For each athlete we hold:</p>
          <ul>
            <li>Name (as on the SSLC certificate), USN, semester, college and gender (men / women)</li>
            <li>Date of birth, blood group, mobile number and a passport-size photo</li>
            <li>Aadhaar number — used only to stop the same person being registered twice; it is never shown in the apps</li>
            <li>Events entered, bib number, heat and lane, call room check-in, results and points</li>
            <li>Hostel allotment, hostel check-in and meal coupons claimed during the meet</li>
          </ul>
          <p>For college staff we hold the PED&apos;s name, phone number and email, and records of fee payments (UTR number and receipt).</p>
        </section>

        <section className="info-card">
          <h2>AURA Athletes app</h2>
          <ul>
            <li>
              <strong>Logging in:</strong> athletes log in with their bib number and date of birth, or by scanning the QR code on their own ID
              card. The app shows only that athlete&apos;s own pass, events, results, hostel and meals, plus public standings.
            </li>
            <li>
              <strong>The app is read-only:</strong> it does not collect new personal information from the athlete. Everything it shows comes
              from the college&apos;s registration.
            </li>
            <li>
              <strong>Camera:</strong> used only to read the QR code on the athlete&apos;s ID card for logging in. No photos or video are taken
              or stored.
            </li>
            <li>
              <strong>Notifications:</strong> the app schedules call room reminders on the phone itself. If the athlete allows notifications, a
              device notification token is stored so the meet office can send schedule updates (for example, a call room opening or a
              delay).
            </li>
            <li>
              <strong>On the phone:</strong> the login session and a copy of the athlete&apos;s pass and schedule are saved on the device so the
              app works offline. Logging out removes them.
            </li>
          </ul>
        </section>

        <section className="info-card">
          <h2>AURA Officials app</h2>
          <p>
            Used only by meet staff (call room, referees, accreditation, hostel wardens and food counters) with a PIN issued by the meet office.
            It reads athletes&apos; ID-card QR codes to record check-ins, meals and results. The camera is used only for scanning QR codes.
            Scans made without internet are kept on the device until they are sent.
          </p>
        </section>

        <section className="info-card">
          <h2>How information is used and shared</h2>
          <ul>
            <li>Only to run the meet: registration, accreditation, heats, call room, results, accommodation, meals and certificates.</li>
            <li>
              Results (name, college, bib and performance) and college standings are published publicly on the website, in the apps and at the
              venue, as is usual for athletics competitions.
            </li>
            <li>Each college&apos;s PED sees their own college&apos;s athletes. Meet staff see what their duty needs.</li>
            <li>
              We do <strong>not</strong> sell personal information, show advertising, or use third-party tracking or analytics in the apps.
            </li>
          </ul>
        </section>

        <section className="info-card">
          <h2>Storage and security</h2>
          <p>
            Data is stored on secure cloud servers (Supabase and Google Cloud) and is always sent over encrypted HTTPS connections. Access is
            limited to the organising team and the duties that need it, each with its own login. Push notifications are delivered through
            Expo&apos;s push service and Apple&apos;s or Google&apos;s notification systems, which receive only the device token and the message.
          </p>
        </section>

        <section className="info-card">
          <h2>How long we keep it, and your choices</h2>
          <p>
            Registration information is kept for the meet and for VTU&apos;s official records of results. To correct or remove your information,
            ask your college&apos;s Physical Education Director, or contact the organising team below. You can stop notifications at any time in
            your phone&apos;s settings or in the app&apos;s Settings screen, and log out to remove the app&apos;s saved data from your phone.
          </p>
        </section>

        <section className="info-card">
          <h2>Contact</h2>
          <p>
            Organising Secretary: Mr. Devendra Naik R. S., Physical Education Director, Dr. ACS College of Engineering, No. 207, Kambipura,
            Mysore Road, Bengaluru 560 074 · Phone <a href="tel:+918088891143">+91 80888 91143</a> ·{' '}
            <a href="https://www.acsce.edu.in" target="_blank" rel="noreferrer">www.acsce.edu.in</a>
          </p>
          <p>
            App help: <Link href="/support">Support page</Link>
          </p>
        </section>

        <p className="info-foot">© 2026 Dr. ACS College of Engineering, Bengaluru</p>
      </main>
    </div>
  );
}
