#!/usr/bin/env python3
"""Full-meet rehearsal on STAGING (27 Nov 2026): scripted officials alongside a real phone.

    python3 scripts/staging/rehearsal.py accredit [--late WGIT]
    python3 scripts/staging/rehearsal.py hostel
    python3 scripts/staging/rehearsal.py redate N          # meet Day N = today (IST); `redate 0` restores 7-10 Dec
    python3 scripts/staging/rehearsal.py meals N
    python3 scripts/staging/rehearsal.py day N
    python3 scripts/staging/rehearsal.py reconcile [N]

Every write goes through the real staging API as the PIN-logged-in official (meet_driver.py).
DB reads use REHEARSAL_DB (IPv4 pooler URL) or SUPABASE_DB_URL from frontend/web/.env.stag.
Log: REHEARSAL_LOG (jsonl).
"""
import os, sys, json, uuid, time, random, subprocess, threading, collections, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import meet_driver as md

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def _db_url():
    if os.environ.get('REHEARSAL_DB'):
        return os.environ['REHEARSAL_DB']
    for line in open(os.path.join(ROOT, 'frontend/web/.env.stag')):
        if line.startswith('SUPABASE_DB_URL'):
            return line.split('=', 1)[1].strip().strip('"').strip("'")


DB = _db_url()
LOG = os.environ.get('REHEARSAL_LOG', os.path.join(ROOT, 'backups/rehearsal/rehearsal.jsonl'))
os.makedirs(os.path.dirname(LOG), exist_ok=True)
rnd = random.Random()
_lock = threading.Lock()
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def sql(s, fetch=True):
    last = ''
    for _ in range(4):
        try:
            r = subprocess.run(['psql', DB, '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], input=s, text=True, capture_output=True, timeout=150)
        except subprocess.TimeoutExpired:
            last = 'psql timeout'; time.sleep(3); continue
        if r.returncode:
            last = r.stderr[-500:]
            if any(k in last.lower() for k in ('connect', 'timeout', 'resolution', 'unreachable')):
                time.sleep(5); continue
            raise RuntimeError(last)
        return [l.split('|') for l in r.stdout.splitlines() if l] if fetch else r.stdout
    raise RuntimeError(last)


def log(kind, **kw):
    kw.update(kind=kind, t=dt.datetime.now(IST).isoformat(timespec='seconds'))
    with _lock, open(LOG, 'a') as f:
        f.write(json.dumps(kw, default=str) + '\n')


class Stats:
    def __init__(self, name):
        self.name, self.c, self.lat, self.err = name, collections.Counter(), [], collections.Counter()

    def add(self, key, secs, err=None):
        with _lock:
            self.c[key] += 1; self.lat.append(secs)
            if err: self.err[str(err)[:140]] += 1

    def report(self):
        l = sorted(self.lat) or [0]
        p = lambda q: round(l[min(len(l) - 1, int(len(l) * q))], 2)
        out = dict(what=self.name, counts=dict(self.c), n=len(self.lat), p50=p(.5), p95=p(.95), max=round(l[-1], 2), errors=dict(self.err.most_common(8)))
        print(json.dumps(out, indent=1)); log('stats', **out); return out


def timed(st, method, path, body, token, ok=(200,), label=None):
    t0 = time.time(); s, j = md.call(method, path, body, token)
    if s == 429:
        time.sleep(20); s, j = md.call(method, path, body, token)
    key = label or str(s)
    st.add(key if s in ok else f'{key}:{s}', time.time() - t0, None if s in ok else (j or {}).get('error'))
    return s, j


# ----------------------------------------------------------------------------- gate services
def accredit(late):
    tok = md.pin_login('accreditation_volunteer')
    rows = sql("select c.code, min(p.bid_number) from colleges c join squads s on s.college_id=c.id join profiles p on p.squad_id=s.id "
               "where c.attendance_marked_at is null group by c.code order by c.code")
    todo = [r for r in rows if r[0] not in late]
    st = Stats('accreditation college check-in')
    for code, bib in todo:
        s, j = timed(st, 'POST', '/accreditation/scan', {'bib': int(bib), 'clientScanUuid': str(uuid.uuid4())}, tok)
        log('accredit', college=code, bib=bib, status=s, resp=j)
    # an offline re-send of the same scan id must not double-count
    code, bib = todo[0]; u = str(uuid.uuid4())
    r = [md.call('POST', '/accreditation/scan', {'bib': int(bib) + 1, 'clientScanUuid': u}, tok) for _ in range(2)]
    log('accredit_resend', results=r)
    st.report()
    print('server stats:', md.call('GET', '/accreditation/stats', None, tok)[1])


def hostel():
    tok = md.pin_login('warden')
    rows = sql("select p.bid_number from profiles p join squads s on s.id=p.squad_id where p.accreditation_status='ACCREDITED' "
               "and not exists (select 1 from accommodation_scans a where a.profile_id=p.id) order by random()")
    stay = [int(r[0]) for r in rows if rnd.random() < 0.85]
    st = Stats('hostel check-in')
    uu = {b: str(uuid.uuid4()) for b in stay}
    md.pmap(lambda b: timed(st, 'POST', '/accommodation/checkin', {'bib': b, 'clientScanUuid': uu[b]}, tok), stay, workers=8)
    # offline re-sends (same uuid) and a second warden scan (new uuid) for 30 athletes
    re = stay[:30]
    md.pmap(lambda b: timed(st, 'POST', '/accommodation/checkin', {'bib': b, 'clientScanUuid': uu[b]}, tok, ok=(200, 409), label='resend'), re, workers=8)
    md.pmap(lambda b: timed(st, 'POST', '/accommodation/checkin', {'bib': b, 'clientScanUuid': str(uuid.uuid4())}, tok, ok=(200, 409), label='second_scan'), re, workers=8)
    st.report()
    print('server stats:', json.dumps(md.call('GET', '/accommodation/stats', None, tok)[1])[:600])


# ----------------------------------------------------------------------------- schedule dates
def redate(n):
    """Day N = today (IST); Day k = today + (k - N). n == 0 restores 7-10 Dec 2026."""
    today = dt.datetime.now(IST).date()
    rows = sql("select id, session_name from schedule_sessions")
    stmts = []
    for sid, name in rows:
        k = int(name.split()[1])
        d = dt.date(2026, 12, 6 + k) if n == 0 else today + dt.timedelta(days=k - n)
        stmts.append(f"update schedule_sessions set session_date='{d}' where id='{sid}';")
    sql('\n'.join(stmts), False)
    print(sql("select session_name, session_date from schedule_sessions order by session_date, start_time"))


# ----------------------------------------------------------------------------- meet days
os.environ.setdefault('DB', DB)
import run_meet as rm  # result generators: RANGES, FIELD, VERT, base()

TOK = {}
API = Stats('meet-day API')


def tokens():
    if not TOK:
        TOK['cr'] = md.pin_login('call_room_official'); TOK['ref'] = md.pin_login('referee')


def api(method, path, body, who, ok=(200,)):
    parts = [x for x in path.split('?')[0].split('/') if x and not (len(x) == 36 and x.count('-') == 4)]
    label = '/'.join(parts[:3] if parts[:1] == ['callroom'] and parts[1:2] == ['rollcalls'] else parts[:2])
    for i in range(6):
        t0 = time.time(); s, j = md.call(method, path, body, TOK[who])
        if s in (502, 503, 504, 0) and i < 5:
            API.add(f'{label}:{s}-retry', time.time() - t0, (j or {}).get('error')); time.sleep(3 + i * 3); continue
        API.add(label if s in ok else f'{label}:{s}', time.time() - t0, None if s in ok else (j or {}).get('error'))
        return s, j
    return s, j


def item_rows(day=None, codes=None):
    w = f"ss.session_name like 'Day {day} %'" if day else f"e.code in ({','.join(repr(c) for c in codes)})"
    return sql(f"select e.code, e.id, e.category, si.stage, si.scheduled_time from schedule_items si join schedule_sessions ss on ss.id=si.session_id "
               f"join events e on e.id=si.event_id where {w} order by ss.session_date, si.scheduled_time")


def entry_bib(entry_id):
    r = sql(f"select coalesce(p.bid_number, (select p2.bid_number from relay_members m join profiles p2 on p2.id=m.profile_id where m.relay_team_id=e.relay_team_id "
            f"order by m.is_reserve, m.leg_order nulls last limit 1)) from roll_call_entries e left join profiles p on p.id=e.profile_id where e.id='{entry_id}'")
    return int(r[0][0]) if r and r[0][0] else None


def roll_call(code, eid, stage, absent_rate=0.04, leave=0):
    """First round: open the roll call, scan ~96% of entrants by bib, prepare the heats. leave>0: scan all but that many
    and stop before prepare (the phone finishes it)."""
    s, j = api('POST', '/callroom/rollcalls/open', {'eventId': eid, 'stage': stage}, 'cr')
    if s != 200: log('rollcall_open_fail', event=code, stage=stage, status=s, resp=j); return False
    rows = sql(f"select e.id, e.status, p.bid_number, (select p2.bid_number from relay_members m join profiles p2 on p2.id=m.profile_id where m.relay_team_id=e.relay_team_id "
               f"order by m.is_reserve, m.leg_order nulls last limit 1) from roll_call_entries e join roll_calls r on r.id=e.roll_call_id "
               f"left join profiles p on p.id=e.profile_id where r.event_id='{eid}' and r.stage='{stage}'")
    pend = [r for r in rows if r[1] != 'REPORTED']
    rnd.shuffle(pend)
    n_abs = leave if leave else int(round(len(pend) * absent_rate))
    scan = pend[n_abs:]
    def one(r):
        bib = int(r[2] or r[3]); return api('POST', '/callroom/rollcalls/scan', {'eventId': eid, 'stage': stage, 'bib': bib, 'clientScanUuid': str(uuid.uuid4())}, 'cr')
    out = md.pmap(one, scan, workers=4)
    bad = [j for s, j in out if s != 200]
    log('rollcall', event=code, stage=stage, entrants=len(rows), scanned=len(scan), absent=n_abs, errors=bad[:3])
    if leave: return True
    s, j = api('POST', '/callroom/rollcalls/prepare', {'eventId': eid, 'stage': stage}, 'cr')
    log('prepare', event=code, stage=stage, status=s, resp=j)
    return s == 200


def call_room(hid, absent_rate=0.02):
    s, j = api('PATCH', f'/schedule/heats/{hid}/status', {'status': 'CALL_ROOM'}, 'cr')
    if s != 200: return s, j
    rows = sql(f"select ha.id, coalesce(p.bid_number, (select p2.bid_number from relay_members m join profiles p2 on p2.id=m.profile_id where m.relay_team_id=ha.relay_team_id "
               f"order by m.is_reserve, m.leg_order nulls last limit 1)) from heat_athletes ha left join profiles p on p.id=ha.profile_id where ha.heat_id='{hid}'")
    for ha, bib in rows:
        if rnd.random() < absent_rate or not bib: continue
        api('POST', '/callroom/scan', {'heatId': hid, 'bib': int(bib), 'clientScanUuid': str(uuid.uuid4())}, 'cr')
    return api('POST', f'/callroom/advance/{hid}', {}, 'cr')


def results(hid, code, cat, finalize=True):
    rep = [r[0] for r in sql(f"select ha.id from heat_athletes ha where ha.heat_id='{hid}' and coalesce(ha.call_room_reported, true) "
                             f"and ({'true' if cat.startswith('field') else 'not exists (select 1 from track_results t where t.heat_athlete_id=ha.id)'})")]
    if not rep: rep = [r[0] for r in sql(f"select id from heat_athletes where heat_id='{hid}'")]
    b = rm.base(code)
    if cat in ('track_sprint', 'track_hurdles', 'track_distance', 'relay', 'road'):
        lo, hi = rm.RANGES[b]; times = sorted(round(rnd.uniform(lo, hi), 2) for _ in rep)
        if len(times) > 3 and rnd.random() < 0.3: times[1] = times[2]  # a tie
        order = rep[:]; rnd.shuffle(order)
        wind = round(rnd.uniform(-1.5, 2.6), 1) if b in ('100M', '200M', '110H', '100H') else None
        for k, ha in enumerate(order):
            st, t, rule = 'FINISHED', times[k], ''
            if k == len(order) - 1 and len(order) > 4 and rnd.random() < 0.3: st, t, rule = 'DQ', None, 'TR 16.8'
            elif k == len(order) - 2 and len(order) > 5 and rnd.random() < 0.2: st, t = 'DNF', None
            api('POST', '/track/result', {'heatAthleteId': ha, 'timeSeconds': t, 'reactionTimeMs': rnd.randint(130, 220) if t else None,
                                          'windReading': wind, 'status': st, 'dqRule': rule}, 'ref')
        return api('POST', '/track/finalize', {'heatId': hid}, 'ref') if finalize else (200, {})
    if b in rm.FIELD:
        lo, hi = rm.FIELD[b]; marks = {ha: [None if rnd.random() < 0.18 else round(rnd.uniform(lo, hi), 2) for _ in range(6)] for ha in rep}
        best = {k: max([m for m in v[:3] if m] or [0]) for k, v in marks.items()}
        top8 = set(sorted(best, key=lambda k: -best[k])[:8])
        have = {(r[0], int(r[1])) for r in sql(f"select fa.heat_athlete_id, fa.round_number from field_attempts fa join heat_athletes ha on ha.id=fa.heat_athlete_id where ha.heat_id='{hid}'")}
        for rnd_no in range(1, 7):
            for ha in rep:
                if rnd_no > 3 and ha not in top8: continue
                if (ha, rnd_no) in have: continue
                m = marks[ha][rnd_no - 1]
                api('POST', '/field/attempt', {'heatAthleteId': ha, 'roundNumber': rnd_no, 'attemptType': 'FOUL' if m is None else 'VALID', 'markMeters': m,
                                               'windReading': round(rnd.uniform(-1, 2), 1) if b in ('LJ', 'TJ') else None}, 'ref')
        return api('POST', '/field/finalize', {'heatId': hid}, 'ref') if finalize else (200, {})
    if b in rm.VERT:
        start, step, lo, hi = rm.VERT[b]; top = {ha: round(rnd.uniform(lo, hi) / step) * step for ha in rep}; out = set(); h = start
        while len(out) < len(rep) and h < hi + 0.3:
            for ha in rep:
                if ha in out: continue
                for an in (1, 2, 3):
                    ok = h <= top[ha] and rnd.random() < (0.85 if an == 1 else 0.55)
                    api('POST', '/field/vertical-attempt', {'heatAthleteId': ha, 'barHeight': round(h, 2), 'attemptNumber': an, 'result': 'O' if ok else 'X'}, 'ref')
                    if ok: break
                else:
                    out.add(ha)
            h = round(h + step, 2)
        return api('POST', '/field/finalize', {'heatId': hid}, 'ref')
    return 0, {'error': f'no generator for {cat}'}


def run_stage(code, eid, cat, stage, skip_heats=()):
    t0 = time.time()
    heats = sql(f"select id, heat_number, status from heats where event_id='{eid}' and stage='{stage}' order by heat_number")
    if not heats:
        if not roll_call(code, eid, stage): return
        heats = sql(f"select id, heat_number, status from heats where event_id='{eid}' and stage='{stage}' order by heat_number")
    for hid, num, status in heats:
        if int(num) in skip_heats or status in ('COMPLETED', 'OFFICIAL'): continue
        if status in ('SCHEDULED', 'DELAYED'):
            s, j = call_room(hid)
            if s != 200: log('callroom_fail', event=code, stage=stage, heat=num, status=s, resp=j); continue
        s, j = results(hid, code, cat)
        log('finalize', event=code, stage=stage, heat=num, status=s, resp={k: j.get(k) for k in ('message', 'error', 'nextStage', 'builtNext', 'waitingFor') if k in j})
        if s != 200: print(f'  !! {code} {stage} heat {num}: {s} {j.get("error")}', flush=True)
    done = sql(f"select count(*), count(*) filter (where status in ('COMPLETED','OFFICIAL')) from heats where event_id='{eid}' and stage='{stage}'")[0]
    print(f'{dt.datetime.now(IST):%H:%M:%S} {code:10} {stage:10} heats {done[1]}/{done[0]} done in {round(time.time() - t0)} s', flush=True)


def run_events(rows, hold=(), workers=4, skip=None):
    tokens()
    by_event = collections.OrderedDict()
    for code, eid, cat, stage, _ in rows:
        if code in hold or cat == 'combined': continue
        by_event.setdefault((code, eid, cat), []).append(stage)
    def ev(k):
        code, eid, cat = k
        for st in by_event[k]:
            try: run_stage(code, eid, cat, st, skip_heats=(skip or {}).get((code, st), ()))
            except Exception as e: log('stage_crash', event=code, stage=st, err=str(e)[:400]); print('  !! crash', code, st, e, flush=True)
    with __import__('concurrent.futures').futures.ThreadPoolExecutor(workers) as ex:
        list(ex.map(ev, list(by_event)))
    API.report()


def day(n, hold):
    run_events(item_rows(day=n), hold=hold)


# ----------------------------------------------------------------------------- meals
MEAL_AT = {'BREAKFAST': (7, 30), 'LUNCH': (12, 45), 'SNACKS': (16, 30), 'DINNER': (20, 0)}


def meals(n, target=15000, counters=4):
    """Meet day N's meals dated (today - (4 - N)) IST; ~96% eat each meal. Per meal: genuine scans, an offline re-send
    (same scan id) for every genuine scan, then second-claim attempts until the day reaches `target` requests."""
    day = dt.datetime.now(IST).date() - dt.timedelta(days=4 - n)
    toks = [md.pin_login('food_volunteer') for _ in range(counters)]
    ath = [int(r[0]) for r in sql("select bid_number from profiles where accreditation_status='ACCREDITED' and bid_number is not null")]
    per_meal = target // 4
    for meal, (hh, mm) in MEAL_AT.items():
        st = Stats(f'meals day {n} {meal} ({day})'); t0 = time.time()
        eat = [b for b in ath if rnd.random() < 0.96]
        def at():
            return (dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=IST) + dt.timedelta(minutes=rnd.randint(-40, 40))).isoformat()
        jobs = [('genuine', b, str(uuid.uuid4()), at()) for b in eat]
        jobs += [('resend', b, u, a) for _, b, u, a in jobs]                        # offline re-sync of the same scan
        while len(jobs) < per_meal:
            b = rnd.choice(eat); jobs.append(('second_claim', b, str(uuid.uuid4()), at()))
        rnd.shuffle(jobs[len(eat):])
        def one(j):
            kind, b, u, a = j
            return timed(st, 'POST', '/catering/scan', {'bib': b, 'mealType': meal, 'clientScanUuid': u, 'scannedAt': a}, toks[b % counters], ok=(200, 409), label=kind)
        md.pmap(one, jobs[:len(eat)], workers=16)          # genuine first (a queue at the counter)
        md.pmap(one, jobs[len(eat):], workers=16)
        out = st.report(); out['secs'] = round(time.time() - t0); log('meal_burst', day=n, meal=meal, date=str(day), **out)

# ----------------------------------------------------------------------------- athlete-app peak traffic
def peak(users=3000, minutes=8, ramp=3, workers=150):
    """`users` phones running the AURA Athletes app (the 512 staging athletes, re-used): each logs in (bib + DOB),
    loads /me, then every ~30 s: live standings; every 2nd cycle: performance; every 10th: /me. Ramp over `ramp` min."""
    ath = [(int(b), d) for b, d in sql("select bid_number, date_of_birth from profiles where bid_number is not null")]
    st = {k: Stats(f'athletes app: {k}') for k in ('login', 'me', 'standings', 'performance')}
    end = time.time() + minutes * 60
    def worker(w):
        mine = [ath[(w + i * workers) % len(ath)] for i in range(w, users, workers)]
        rnd.shuffle(mine); toks = {}
        time.sleep(rnd.uniform(0, ramp * 60 / max(1, len(mine))))
        cyc = 0
        while time.time() < end:
            t_cycle = time.time()
            for k, (bib, dob) in enumerate(mine):
                if time.time() > end: break
                if k not in toks:
                    if time.time() - (end - minutes * 60) < ramp * 60 * k / max(1, len(mine)): continue   # still ramping
                    s, j = timed(st['login'], 'POST', '/athlete/login', {'bib': str(bib), 'dob': dob}, None)
                    toks[k] = j.get('token') if s == 200 else None
                    if toks[k]: timed(st['me'], 'GET', '/athlete/me', None, toks[k])
                    continue
                if not toks[k]: continue
                timed(st['standings'], 'GET', '/live/leaderboard', None, None)
                if cyc % 2 == 0: timed(st['performance'], 'GET', '/athlete/performance', None, toks[k])
                if cyc % 10 == 0: timed(st['me'], 'GET', '/athlete/me', None, toks[k])
            cyc += 1
            time.sleep(max(0, 30 - (time.time() - t_cycle)) * rnd.uniform(0.85, 1.15))
    t0 = time.time()
    with __import__('concurrent.futures').futures.ThreadPoolExecutor(workers) as ex:
        list(ex.map(worker, range(workers)))
    print(f'peak: {users} app users for {minutes} min ({round(time.time() - t0)} s)')
    for v in st.values():
        out = v.report(); log('peak', **out)


CMDS = {'accredit': lambda a: accredit(set(a[a.index('--late') + 1].split(',')) if '--late' in a else set()),
        'hostel': lambda a: hostel(),
        'redate': lambda a: redate(int(a[0])),
        'peak': lambda a: peak(int(a[0]), int(a[1])),
        'meals': lambda a: meals(int(a[0]), int(a[1]) if len(a) > 1 else 15000),
        'day': lambda a: day(int(a[0]), set(a[a.index('--hold') + 1].split(',')) if '--hold' in a else set()),
        'events': lambda a: run_events(item_rows(codes=[x for x in a if not x.startswith('--')])),
        'rollcall': lambda a: (tokens(), roll_call(a[0], sql(f"select id from events where code='{a[0]}'")[0][0], a[1], leave=int(a[2]))),
        'fill': lambda a: (tokens(), print(results(sql(f"select h.id from heats h join events e on e.id=h.event_id where e.code='{a[0]}' and h.stage='{a[1]}' and h.heat_number={a[2]}")[0][0],
                                                   a[0], sql(f"select category from events where code='{a[0]}'")[0][0], finalize=False)), API.report()),
        'stage': lambda a: (tokens(), run_stage(a[0], *sql(f"select id, category from events where code='{a[0]}'")[0], a[1],
                                                 skip_heats={int(x) for x in a[2].split(',')} if len(a) > 2 else ()), API.report())}

if __name__ == '__main__':
    CMDS[sys.argv[1]](sys.argv[2:])
