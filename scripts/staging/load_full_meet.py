#!/usr/bin/env python3
"""
ADDITIVE staging load for the full-meet rehearsal (does NOT wipe anything; existing demo logins, PINs
and the App Store reviewer login keep working).

    python3 scripts/staging/load_full_meet.py --yes-staging [--colleges 30]

Adds N fictional colleges (men's + women's squads), ~17 athletes per squad (~1000 total), every
individual event filled (sprints ~60, rare events ~30), relay nominations (4x100, 4x400, Mixed 4x400),
half-marathon entries, a few reserves, verified payments, then runs the real
close_registration_and_generate_bids() (append-only: existing bibs are untouched).
Registrations go through the real DB triggers, so quota / relay / reserve rules are exercised.
Photos: placeholder cards. Everything fictional. Staging only (refuses production).
"""
import os, re, sys, uuid, random, subprocess, io, urllib.request, datetime as dt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.dirname(__file__))


def read_env(path):
    env = {}
    for line in open(path):
        m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
        if m:
            env[m.group(1)] = m.group(2).strip('"').strip("'")
    return env


env, prod = read_env(os.path.join(ROOT, 'frontend/web/.env.stag')), read_env(os.path.join(ROOT, 'frontend/web/.env.local'))
URL, KEY, DB = env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'], env['SUPABASE_DB_URL']
ref = lambda u: re.search(r'([a-z0-9]{20})', u or '').group(1)
if '--yes-staging' not in sys.argv or ref(URL) not in DB or ref(URL) == ref(prod.get('NEXT_PUBLIC_SUPABASE_URL', '')):
    sys.exit('Refusing: needs --yes-staging and a staging DB different from production.')
N_COL = int(sys.argv[sys.argv.index('--colleges') + 1]) if '--colleges' in sys.argv else 30
rnd = random.Random(int(__import__("time").time()))


def psql(sql, quiet=True):
    r = subprocess.run(['psql', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-At'], input=sql, text=True, capture_output=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-2500:])
        sys.exit('SQL failed')
    return r.stdout


def q(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"


_VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
       [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
_VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
       [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
_VINV = [0,4,3,2,1,5,6,7,8,9]


def aadhaar(first11):
    c = 0
    for i, d in enumerate(reversed(first11)):
        c = _VD[c][_VP[(i + 1) % 8][int(d)]]
    return first11 + str(_VINV[c])


PREFIX = ['Bellary', 'Gokak', 'Sahyadri', 'Nrupathunga', 'Vidyaranya', 'Basava', 'Kittur', 'Hoysala', 'Tippu', 'Kempegowda',
          'Mandya', 'Raichur', 'Hassan', 'Tumkur', 'Kolar', 'Davangere', 'Bidar', 'Gadag', 'Dharwad', 'Koppal',
          'Chikmagalur', 'Kodagu', 'Hubballi', 'Karwar', 'Bagalkot', 'Vijayapura', 'Yadgir', 'Ramanagara', 'Shirasi', 'Sagara',
          'Madikeri', 'Puttur', 'Mangaluru', 'Belur', 'Halebidu']
MEN = ['Aarav', 'Rohan', 'Karthik', 'Nikhil', 'Pranav', 'Vikram', 'Suhas', 'Manoj', 'Darshan', 'Akash', 'Chirag', 'Varun', 'Abhishek', 'Sagar',
       'Tejas', 'Yashwanth', 'Harsha', 'Kiran', 'Pavan', 'Rakesh', 'Shreyas', 'Naveen', 'Gagan', 'Adarsh', 'Mohan', 'Lokesh', 'Raghu', 'Sachin']
WOMEN = ['Ananya', 'Divya', 'Kavya', 'Meghana', 'Pooja', 'Sahana', 'Shreya', 'Bhavana', 'Nisha', 'Varsha', 'Spoorthi', 'Deepika', 'Keerthana',
         'Rakshitha', 'Sneha', 'Aishwarya', 'Lavanya', 'Navya', 'Tanvi', 'Chaithra', 'Pallavi', 'Harini', 'Sinchana', 'Amrutha', 'Sushma', 'Bindu', 'Roopa', 'Asha']
SURN = ['Gowda', 'Hegde', 'Rao', 'Shetty', 'Patil', 'Kulkarni', 'Naik', 'Bhat', 'Reddy', 'Desai', 'Kamath', 'Joshi', 'Murthy', 'Prasad',
        'Nayak', 'Kumar', 'Shenoy', 'Acharya', 'Iyer', 'Pai', 'Hiremath', 'Angadi', 'Madar', 'Biradar']
BLOOD = ['O+', 'B+', 'A+', 'AB+', 'O-', 'B-', 'A-']

events = {c: (i, cat) for i, c, cat in (l.split('|') for l in psql('select id, code, category from events').split())}
existing = {r for r in psql('select code from colleges').split()}
# Events (individual, by gender); light ones get 1 slot per squad, the rest 2
IND = ['100M', '200M', '400M', '800M', '1500M', '5000M', '10000M', 'HURD', '400H', 'LJ', 'TJ', 'HJ', 'PV', 'SP', 'DT', 'HT', 'JT', '20KM-W']
LIGHT = {'10000M', 'PV', 'HT', '20KM-W'}


def code_of(base, g):
    return {'HURD': '110H-M' if g == 'M' else '100H-W', '20KM-W': '20KM-W-' + g, 'HM': 'HM-' + g}.get(base, f'{base}-{g}')


# Placeholder photos
photo_urls = []
try:
    from PIL import Image, ImageDraw, ImageFont
    fp = next((p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'] if os.path.exists(p)), None)
    pal = ['#1e3a8a', '#0f766e', '#7c2d12', '#6d28d9', '#be123c', '#0369a1', '#4d7c0f', '#a16207']
    for i, c in enumerate(pal):
        img = Image.new('RGB', (300, 380), c)
        d = ImageDraw.Draw(img)
        d.text((150, 170), 'ATH', fill='white', font=ImageFont.truetype(fp, 100) if fp else None, anchor='mm')
        d.text((150, 330), 'LOAD TEST PHOTO', fill='#e5e7eb', font=ImageFont.truetype(fp, 20) if fp else None, anchor='mm')
        buf = io.BytesIO(); img.save(buf, 'PNG')
        req = urllib.request.Request(f'{URL}/storage/v1/object/athlete-photos/loadtest/p{i}.png', data=buf.getvalue(), method='POST',
                                     headers={'Authorization': f'Bearer {KEY}', 'apikey': KEY, 'Content-Type': 'image/png', 'x-upsert': 'true'})
        urllib.request.urlopen(req, timeout=30).read()
        photo_urls.append(f'{URL}/storage/v1/object/public/athlete-photos/loadtest/p{i}.png')
except Exception as e:
    print('photos skipped:', e)
    photo_urls = [None]

pass_hash = psql("select passphrase_hash from squads order by created_at limit 1").strip()
receipt = f'{URL}/storage/v1/object/public/payment-proofs/demo/receipt.png'
usn_n = 1000 + int(psql('select count(*) from profiles').strip())
used_names = set()
stats = {'colleges': 0, 'athletes': 0, 'regs': 0}
fees = {}

colleges = [p for p in PREFIX if (p[:4].upper()) not in existing][:N_COL]
sql = ['BEGIN;']
reg_sql = []
for ci, pre in enumerate(colleges):
    ccode = pre[:4].upper()
    cid = str(uuid.uuid4())
    sql.append(f"INSERT INTO colleges (id, name, code, district, region, principal_name) VALUES ({q(cid)}, {q(pre + ' Institute of Technology')}, {q(ccode)}, {q(pre)}, {q(['Bengaluru', 'Mysuru', 'Belagavi', 'Kalaburagi'][ci % 4])}, {q('Dr. Principal ' + ccode)});")
    stats['colleges'] += 1
    mixed_members = 0
    for g, gname in (('M', 'men'), ('W', 'women')):
        sid = str(uuid.uuid4())
        sql.append(f"INSERT INTO squads (id, college_id, gender, squad_code, passphrase_hash, ped_name, ped_phone, ped_email, payment_status) VALUES "
                   f"({q(sid)}, {q(cid)}, {q(gname)}, {q(ccode + '-' + g)}, {q(pass_hash)}, {q('PED ' + ccode)}, '9876543210', {q(ccode.lower() + '.ped@loadtest.example')}, 'DRAFT');")
        # slots
        counts = {e: (1 if e in LIGHT else 2) for e in IND}
        order = IND[:]
        rnd.shuffle(order)
        slots = [e for e in order for _ in range(counts[e])]
        n_ath = len(slots) // 2  # 17
        regular_n = 0
        relay_members = {'4X100M': 0, '4X400M': 0}
        pid_list = []
        for ai in range(n_ath):
            pid = str(uuid.uuid4()); pid_list.append(pid)
            while True:
                nm = f"{rnd.choice(MEN if g == 'M' else WOMEN)} {rnd.choice(SURN)}"
                if nm not in used_names: used_names.add(nm); break
            usn_n += 1
            dob = dt.date(2002, 9, 1) + dt.timedelta(days=rnd.randint(0, 4 * 365))
            sql.append(f"INSERT INTO profiles (id, squad_id, sslc_name, usn, semester, blood_group, college_joining_date, sem_start_date, aadhaar_number, photo_url, accreditation_status, date_of_birth, phone) VALUES "
                       f"({q(pid)}, {q(sid)}, {q(nm.upper())}, {q(f'1{ccode[:2]}{22 + ai % 3}{['CS', 'EC', 'ME', 'CV', 'IS'][ai % 5]}{usn_n}')}, {rnd.choice([3, 5, 7])}, {q(rnd.choice(BLOOD))}, "
                       f"'2022-08-16', '2026-08-01', {q(aadhaar(str(rnd.randint(2, 9)) + str(rnd.randint(10**9, 10**10 - 1))))}, {q(rnd.choice(photo_urls))}, 'REGISTERED', {q(dob.isoformat())}, {q('9' + str(rnd.randint(10**8, 10**9 - 1)))});")
            stats['athletes'] += 1
            e1, e2 = slots[ai], slots[ai + n_ath]
            for e in (e1, e2):
                reg_sql.append(f"INSERT INTO registrations (profile_id, event_id, kind) VALUES ({q(pid)}, {q(events[code_of(e, g)][0])}, 'regular');")
                regular_n += 1
            # relays: athletes 0-5 → 4x100, 6-11 → 4x400, 12-14 → mixed, 15 → half marathon
            if ai < 6:
                reg_sql.append(f"INSERT INTO registrations (profile_id, event_id, kind) VALUES ({q(pid)}, {q(events['4X100M-' + g][0])}, 'relay');"); relay_members['4X100M'] += 1
            elif ai < 12:
                reg_sql.append(f"INSERT INTO registrations (profile_id, event_id, kind) VALUES ({q(pid)}, {q(events['4X400M-' + g][0])}, 'relay');"); relay_members['4X400M'] += 1
            elif ai < 15:
                reg_sql.append(f"INSERT INTO registrations (profile_id, event_id, kind) VALUES ({q(pid)}, {q(events['4X400M-MIX'][0])}, 'relay');"); mixed_members += 1
            if ai == 15 and ci % 2 == 0:
                reg_sql.append(f"INSERT INTO registrations (profile_id, event_id, kind) VALUES ({q(pid)}, {q(events['HM-' + g][0])}, 'half_marathon');"); regular_n += 1
            # reserve for every 4th athlete: a sprint event they are not in
            if ai % 4 == 1:
                res = next(x for x in ('100M', '200M', '400M', '800M') if x not in (e1, e2))
                reg_sql.append(f"INSERT INTO registrations (profile_id, event_id, kind) VALUES ({q(pid)}, {q(events[code_of(res, g)][0])}, 'reserve');")
        fees[sid] = regular_n * 100 + 100 * min(relay_members['4X100M'], 4) + 100 * min(relay_members['4X400M'], 4) + 100 * min(3, 2)
    stats['regs'] += 0
sql.append('COMMIT;')
psql('\n'.join(sql))
print(f"Inserted {stats['colleges']} colleges, {stats['athletes']} athletes. Registering events through the DB triggers…")
# One psql session; each INSERT in its own block so a rejected row is logged without aborting the rest
blocks = [f"DO $$ BEGIN {x} EXCEPTION WHEN others THEN RAISE NOTICE 'REJECT: %', SQLERRM; END $$;" for x in reg_sql]
r = subprocess.run(['psql', DB, '-q', '-At'], input='\n'.join(blocks), text=True, capture_output=True)
rej = [l.split('REJECT: ', 1)[1] for l in r.stderr.splitlines() if 'REJECT: ' in l]
print(f'registrations attempted={len(reg_sql)} rejected={len(rej)}')
errs = {}
for m in rej:
    errs[m[:150]] = errs.get(m[:150], 0) + 1
for k, v in sorted(errs.items(), key=lambda x: -x[1])[:15]:
    print(f'  {v:4d} x {k}')

# Fees (per squad, matching calculateSquadFees roughly), verified payments, lock, bibs
pay = []
for sid, amt in fees.items():
    pay.append(f"INSERT INTO payments (squad_id, amount_submitted, amount_expected, amount_received, utr_number, screenshot_url, status, verified_at) VALUES "
               f"({q(sid)}, {amt}, {amt}, {amt}, {q('LOAD' + str(rnd.randint(10**9, 10**10 - 1)))}, {q(receipt)}, 'VERIFIED', now());")
ids = ', '.join(q(x) for x in fees)
pay.append(f"UPDATE squads SET payment_status = 'VERIFIED', roster_locked = TRUE WHERE id IN ({ids});")
pay.append('SELECT close_registration_and_generate_bids();')
print(psql('\n'.join(pay))[-300:])
print(psql("select count(*) filter (where bid_number is not null), count(*) from profiles"))
