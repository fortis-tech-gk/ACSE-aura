# How VTU SportsOS works - for everyone

This guide explains the system **without needing technical knowledge**. Each section tells one kind of
person what they do and what happens behind the scenes. The technical details are in
**[ARCHITECTURE.md](ARCHITECTURE.md)**.

**The event:** 28th VTU Inter-Collegiate State Level Athletic Meet 2026 (**Dr. ACS-AURA 2026**), hosted by
Dr. ACS College of Engineering, Bengaluru, under VTU, Belagavi. Meet days: **7-10 December 2026**.

---

## The system in one minute

![Who does what](diagrams/04-roles-and-access.svg)

Think of it as **four kinds of people** and **one shared notebook**:

| Person | Uses | What they do |
|---|---|---|
| **College PED** (Physical Education Director, contingent manager) | The website | Registers their athletes, picks events, pays the entry fee |
| **Athlete** | The *AURA Athletes* app | Shows their pass, sees their schedule, results and points |
| **Official** (desk staff, call room, referees) | The *AURA Officials* app | Scans people in, checks them into the call room, enters results |
| **Admin / Finance desk / Registration desk** | The website | Runs the meet: colleges, payments, heat draw, ID cards, certificates |

The **shared notebook** is one database in the cloud. Everything anyone enters goes into it, and everything anyone
sees comes from it. That is why a result typed by a referee shows up on the public website and in the
athlete's app within seconds.

The rules of the meet (how many events, who can run, how points are given) are checked by the **system
itself**, not by the person using it. So a PED cannot register a third event for an athlete, and a referee cannot
type a world-record-breaking 100 m time by mistake.

---

## The journey of an athlete, start to finish

![From registration to payment](diagrams/02-registration-payment-lifecycle.svg)

1. The admin creates the college. The college gets **two squads** (Men and Women), each with a login.
2. The PED registers athletes and picks their events.
3. The system works out the **fee**. The PED pays by UPI and uploads the proof.
4. The finance desk confirms the payment.
5. Registration closes and every athlete gets a permanent **bib number**.
6. At the meet: accreditation desk -> hostel -> meals -> call room -> track or field -> result -> medals.

![Meet day](diagrams/03-meet-day-flow.svg)

---

## 1. For the college PED (contingent manager)

**Where:** the website, *Squad login* (squad code + passphrase). Men and Women squads log in separately.

### What you can do
| Page | What it is for |
|---|---|
| **Dashboard** | Your college, your squad, how many athletes, event quotas, payment status, bib numbers (after registration closes), advisory notes |
| **Athletes** | Add, edit and delete athletes. Pick events, a reserve and relays. |
| **Payment** | See the fee, pay by UPI, upload the receipt, see the status |
| **Certificate / reports** | Entry report and the attendance certificate to print |

### Adding an athlete
Fill in: full name **exactly as on the SSLC (10th) certificate**, **USN** (a first-year can use a temporary
USN, any text), semester, blood group, college joining date, the date this academic year started, date of
birth, student phone number (10 digits), **Aadhaar number (12 digits)**, and a **passport-size photo** (JPG, PNG or WebP, up to 5 MB).

The system rejects: an Aadhaar or USN already used by any college, dates that do not make sense, a missing photo,
or a wrong format.

### Choosing events
- Up to **2 individual events** per athlete.
- Up to **1 reserve event**. A reserve can only be named if the athlete has at least one regular individual
  event.
- At most **2 athletes from your college** in any one individual event.
- **Relays:** just tick 4x100 m, 4x400 m or the Mixed relay on the athlete's form. An athlete can be in **only
  one** of 4x100 or 4x400. There is no relay team building: the team is settled at the call room on the day.
  Up to 6 athletes per relay per squad, 6 per college for the Mixed relay.
- The **Half Marathon** can be entered as the only event.
- Decathlon (men) and Heptathlon (women) count as an event entry like the others.

### The fee
| Entry | Fee |
|---|---|
| Each individual or half marathon entry | Rs 100 |
| Reserve event | **free** |
| A relay team | Rs 100 for each of the first 4 members (members 5 and 6 free), up to Rs 400 |
| Mixed relay | Rs 100 for each of *your own* first 2 members |

**One payment per college.** Your Men's and Women's squads share one fee account. Either PED can pay the whole
college amount once.

### Paying
1. Pay the total by **UPI** to the host's UPI ID shown on the Payment page (a QR code is there).
2. Enter the **UTR / bank reference number** (8-30 letters or digits), the amount paid, and upload the screenshot or receipt.
3. Press submit.

### What happens when you submit
- Your roster is **locked** for **both** squads of your college. You can no longer add or delete athletes.
- The finance desk checks the payment against the bank:
  - **Verified** -> your reports and the ID cards can be printed. You are ready for the meet.
  - **Rejected** -> you will see the reason and can submit again.
- If you urgently need to change something after locking (a withdrawal, a substitution), ask the meet
  office. Only an admin can unlock a squad.

### Deadlines
Registration closes on **25 November 2026**. The admin closes it, and after that nothing can be added.

---

## 2. For the athlete

**Where:** the *AURA Athletes* app (Android and iPhone).
**Login:** your **bib number** and your **date of birth**. Bibs are issued after registration closes.

| Tab | What you see |
|---|---|
| **My Pass** | Your photo, name, college, bib number and a **QR code**. Show this at the accreditation desk, hostel and food counter. Also shows whether you are accredited. |
| **Events** | Your events with day, time, heat and lane, a countdown, and the call room time. Reminders ring before your call room. |
| **Results** | Your time or mark, your place in the heat, medals, points earned, and your college's rank. For the decathlon and heptathlon you see your total points and place. |
| **Leaderboard** | Team standings: Overall, Men and Women |
| **More** | Stay and Meals (hostel, room, meals used today), directions to the venue, settings, log out |

You also get **notifications**, for example when you qualify for the next round.

### Tips
- Keep the QR large and your screen bright when scanning.
- Report to the **call room** before your reporting time. If you are not scanned in when it closes, you are
  marked DNS (did not start) and cannot compete in that heat.
- The app is read-only: nothing you do in it changes any result.

---

## 3. For officials

**Where:** the *AURA Officials* app (Android tablets and phones). Choose your **duty** on the login screen and
enter your 6-digit **PIN**. The app remembers your last duty.

![Meet day](diagrams/03-meet-day-flow.svg)

### The five duties

| Duty | Job | How |
|---|---|---|
| **Accreditation desk** | Confirm an athlete has arrived | Scan the athlete's QR (or type the bib). Works only if the college's payment is verified. |
| **Hostel warden** | Check athletes into the hostel | Scan the QR, pick the room. Refuses the wrong hostel. |
| **Food counter** | One meal per slot | Scan the QR for breakfast, lunch, snacks or dinner. A second scan for the same meal is refused. |
| **Call room** | Check athletes in before their heat | Open the heat, scan each athlete, inspect (spikes, bib), handle scratches and swaps, then close the call room |
| **Referee** | Enter the result | Times, distances, heights or decathlon marks, then Finalize |

### Working offline
Wi-Fi at a stadium can be poor. The app **keeps working**:
- Athlete names, photos and fee status are stored on the tablet, so scanning still identifies people.
- Everything you scan or type is saved on the tablet first and shows **Queued**. It is sent automatically when the
  network returns. Sending twice does no harm.
- A badge at the top shows how many items are waiting and lets you check them.

### Call room (step by step)
1. Open your heat from the list. Open the call room.
2. As athletes arrive, scan their QR or type the bib. The athlete's photo, name and college appear.
3. Use the inspection to record spikes, bib and similar checks. Mark **scratched** or **disqualified** if needed.
4. If an athlete is absent, you can **substitute a reserve** (reserves are shown). For relays, swap a runner for a reserve.
5. **Close the call room.** The heat goes to the track. Anyone not scanned is now DNS.

> If the call room tablet has no internet, the referee can close the call room from the referee tablet, but
> only after the call room official types their own PIN on it.

### Referee: track events
- Each lane has: **Finished** (type the time like 10.42 or 1:52.34), **DNF**, **DQ** (with the rule) or **DNS**.
- Places fill in as times are typed, and equal times share a place.
- Everything saves itself after about a second. A small status shows *Saved*, *Saving* or *Queued*.
- Press **Finish heat**. If it is a heat, the best 2 of each heat go to the next round, drawn automatically with
  lanes. If it is the final, medals and points are awarded.

### Referee: throws and jumps
- Up to 6 trials per athlete. A trial is **a distance, a foul or a pass**. After 3 trials, only the best 8 continue.
- Positions are shown after 3, 5 and 6 trials, as on the paper card.

### Referee: high jump and pole vault
- For each bar height, record **O** (cleared), **X** (missed) or **-** (pass) per attempt. The system applies the
  official countback.

### Referee: decathlon and heptathlon
- Pick the discipline tab (Day 1 and Day 2 are grouped). The tab shows how many athletes have a mark.
- Type each athlete's mark: **times** like 10.42 or 1:52.34, **distances and heights in metres** like 7.42.
- The **points** appear straight away (World Athletics scoring), and the standings table below shows the running total and rank for every athlete.
- Statuses: **FIN** (finished), **NM** (no valid mark, scores 0 and the athlete stays in), **DNF/DQ/DNS** (the athlete is not ranked).
- **Print / Save PDF** gives the paper sheet: one table per day with each mark and its points, the grand total and the position.
- Press **Finish event & award points** when every mark is in.

### Rules referees should know
- You cannot enter results until the **call room closes**.
- You cannot enter a result for an athlete who **did not report**. Ask the call room official to correct it if it is a mistake.
- After you finalize, you cannot edit. Ask the meet office to reopen it. Every correction is logged with who made it.
- You only see events **assigned to you**.
- Impossible marks (for example a 5-second 100 m hurdles) are refused, so check what you typed.

---

## 4. For the admin, finance desk and registration desk

**Where:** the website, *Admin login* (username and password). The **finance desk** account can open **only the
Payments page**. The **registration desk** account marks arrivals.

### Admin pages
| Page | Use |
|---|---|
| **Dashboard** | Totals at a glance, a registration open/closed switch, shortcuts |
| **Colleges** | Add a college, create its two squads and logins, reset passphrases, **unlock a squad** in an emergency |
| **Athletes** | Search and export every registered athlete |
| **Payments** | Review every payment: UTR, amount, receipt, then **Verify** or **Reject** (with a reason) |
| **Bibs** | Generate contiguous bib numbers once registration closes (never change afterwards) |
| **ID cards** | Print athlete accreditation cards (admin-only; colleges do not see them) |
| **Heats / Schedule** | Draw heats for each event, see the schedule, link each heat to its slot |
| **Results & Corrections** | Fix a result after a referee finished the heat: **reopen** the heat for the referee, or correct a track final time or a decathlon / heptathlon mark directly. A reason is required and goes in the Audit Log; places and points recalculate by themselves. |
| **Score sheets** | Print blank referee score sheets, including decathlon / heptathlon sheets (one page per day) |
| **Delegations** | Printable delegation sheets with the principal's signature and seal |
| **Certificates** | Generate the official certificates |
| **Amendments** | Withdraw or substitute an athlete after the roster is locked |
| **Staff** | Create officials accounts with PINs and event assignments for referees |
| **Audit log** | Who did what and when |

### The admin's run-up to the meet
1. Add colleges, hand out the squad codes and passphrases.
2. Registration open: PEDs register and pay. Finance verifies payments daily.
3. **Close registration**, then **generate bib numbers**.
4. Print ID cards, delegation sheets, score sheets.
5. On arrival days the registration desk marks each college present, and the accreditation desk scans athletes.
6. **Draw heats** per event. Only accredited athletes of verified colleges are drawn, teammates in different heats.
7. On meet days: watch results, handle amendments, and keep an eye on the audit log.

### The finance desk
Opens **Payments**. For each submission: compare the UTR and amount with the bank statement, look at the receipt,
then **Verify** or **Reject**. Verifying one squad verifies the whole college's fee account.

---

## 5. For the public and spectators

Open the **Live Results** page (no login). It refreshes by itself every 15 seconds and shows:
- the **Overall, Men's and Women's team championships** with medal counts and points;
- every event with its heats, places and times or marks. Finals are highlighted with medal colours. Decathlon and heptathlon show total points.

Results appear as soon as a referee finalizes a heat.

---

## Scoring in plain words

| What | Points |
|---|---|
| **College points**: 1st, 2nd, 3rd in **any** event (individual or relay, decathlon and heptathlon included) | **10, 6, 2** |
| **Athlete's own points**: 1st, 2nd, 3rd in an individual event (used for Best Male / Female Athlete) | **5, 3, 1** |
| Mixed relay | no points |
| Tie | the tied athletes share the place |

Which events count where:
- **Overall championship:** college points from every event, individual and 4x100 m / 4x400 m relays.
- **Men's / Women's team championship:** college points from that gender's individual events only (no relays).

**Qualifying:** in track events with several heats, the **first 2 of each heat** go to the next round (ties for
2nd place both go through). If more than 8 qualify for a final, a semi-final is run first.

**Decathlon and heptathlon:** each discipline gives points from the World Athletics tables, and the totals decide the places. Everyone must finish every discipline to be ranked. If two athletes have the same total, the one who scored higher in more disciplines wins.

---

## Glossary

| Term | Meaning |
|---|---|
| **PED** | Physical Education Director, the college's contingent manager |
| **Squad** | A college's Men or Women team. Each college has two. |
| **USN** | University Seat Number |
| **UTR** | The bank or UPI reference number of a payment |
| **Roster lock** | After payment is submitted, athletes can no longer be added or removed |
| **Bib** | The athlete's permanent number for the meet |
| **Accreditation** | Confirming at the desk that an athlete has arrived and is cleared to compete |
| **Call room** | The check-in area before a heat. Athletes not scanned in when it closes are DNS. |
| **Heat** | One race (or flight) of an event. Big events have several heats. |
| **DNS / DNF / DQ / NM** | Did not start / did not finish / disqualified / no valid mark |
| **Reserve** | A named substitute event, or an athlete who can step in at the call room |
| **Finalize** | The referee's "this heat is done and official" button |
| **Staging / production** | The practice copy of the system / the real one used at the meet |

---

## Questions people ask

**An athlete is missing from the heat draw.** Check three things: the athlete is *accredited*, the college's payment is
*verified*, and the athlete is *registered* for that event as a regular entry (a reserve is not drawn).

**A PED made a mistake after paying.** Roster is locked. Ask the meet office: an admin can withdraw or substitute
an athlete (Amendments) or unlock the squad.

**A referee typed a wrong time.** If the heat is not finalized, retype it (it saves over the old one). If it is
finalized, the admin opens **Results & Corrections** and either reopens the heat (the referee fixes it and finishes it
again) or corrects a final time / decathlon mark directly. The change is logged, and points recalculate automatically.

**The tablet lost Wi-Fi.** Keep working. Items show *Queued* and send themselves when the network returns.

**An athlete says they cannot log in to the app.** They need their **bib** (issued after registration closes) and
the **date of birth** exactly as registered. After many wrong tries the login pauses for 15 minutes.

**Where is a payment stuck?** The Payments page shows each payment as *Submitted*, *Verified* or *Rejected*. The
finance desk handles *Submitted*.

---

## Staging versus production

Staging (practice) vs production (real) are completely separate: staging has fictional demo data and is used
to rehearse. The real meet runs on production.

For more help on the website, see the **Support** page and the **Help manual** inside the website.
