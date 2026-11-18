"""Runs scheduled events end to end on STAGING: call room -> referee -> finalize (progression + points).
usage: run_meet.py CODE [CODE...]   (event codes, stages run in order until FINAL is done)"""
import sys, os, json, random, subprocess, time, uuid, collections, threading
sys.path.insert(0, os.path.dirname(__file__))
import meet_driver as md
DB = os.environ['DB']
LOG = os.environ.get('MEET_LOG', '/tmp/claude-1000/meet_run.jsonl')
rnd = random.Random()
lock = threading.Lock()

def sql(s, fetch=True):
    last = ''
    for i in range(4):
        try:
            r = subprocess.run(['psql', DB, '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], input=s, text=True, capture_output=True, timeout=150)
        except subprocess.TimeoutExpired:
            last = 'psql timed out'; time.sleep(3); continue
        if r.returncode:
            last = r.stderr[-400:]
            if 'resolution' in last or 'connect' in last.lower() or 'timeout' in last.lower(): time.sleep(5); continue
            raise RuntimeError(last)
        return [l.split('|') for l in r.stdout.splitlines() if l] if fetch else r.stdout
    raise RuntimeError(last)

def api(method, path, body, token):
    for i in range(12):
        s, j = md.call(method, path, body, token)
        if s == 429: time.sleep(45); continue
        return s, j
    return s, j

def log(**kw):
    with lock, open(LOG, 'a') as f: f.write(json.dumps(kw, default=str) + '\n')

TOK = {}
def tokens():
    TOK['cr'] = md.pin_login('call_room_official'); TOK['ref'] = md.pin_login('referee'); TOK['adm'] = md.admin_login()

RANGES = {'100M': (10.6, 12.8), '200M': (21.5, 26.5), '400M': (48, 60), '800M': (115, 150), '1500M': (240, 320), '5000M': (930, 1250), '10000M': (1980, 2500),
          '110H': (14.5, 18.5), '100H': (13.5, 17.5), '400H': (54, 70), '4X100M': (42, 54), '4X400M': (195, 250), '4X400M-MIX': (215, 260), 'HM': (4300, 5400), '20KM-W': (5700, 7400)}
FIELD = {'LJ': (5.0, 7.7), 'TJ': (10.5, 15.2), 'SP': (9.0, 15.5), 'DT': (28, 46), 'JT': (38, 66), 'HT': (35, 58)}
VERT = {'HJ': (1.45, 0.05, 1.50, 2.05), 'PV': (2.60, 0.10, 2.80, 4.60)}

def base(code):
    b = code.rsplit('-', 1)[0]
    return '4X400M-MIX' if code == '4X400M-MIX' else ('20KM-W' if code.startswith('20KM') else b)

def run_heat(hid, code, cat, first_in_event):
    t0 = time.time(); out = {'heat': hid, 'event': code}
    ents = sql(f"select ha.id, p.bid_number, ha.lane_number, ha.relay_team_id from heat_athletes ha left join profiles p on p.id=ha.profile_id where ha.heat_id='{hid}' order by ha.lane_number")
    out['entries'] = len(ents)
    st0 = sql(f"select status from heats where id='{hid}'")[0][0]
    resume = st0 == 'ON_TRACK'          # interrupted after the call room closed: go straight to results
    if resume: out['resumed'] = True; s = 200
    else:
        s, j = api('PATCH', f'/schedule/heats/{hid}/status', {'status': 'CALL_ROOM'}, TOK['cr']); out['open'] = s
    if s != 200: out['open_err'] = j.get('error'); log(**out); return out
    ents2 = [e for e in ents]
    absent = {e[0] for e in ents2 if rnd.random() < 0.05} if not resume else {r[0] for r in sql(f"select ha.id from heat_athletes ha where ha.heat_id='{hid}' and not ha.call_room_reported")}      # ~5% never report -> DNS
    scans = errs = 0
    for e in ([] if resume else ents2):
        if e[0] in absent: continue
        if first_in_event and e[1]:  # real scanner API path for the first heat of each event (athlete by bib)
            s, j = api('POST', '/callroom/scan', {'heatId': hid, 'bib': int(e[1])}, TOK['cr'])
            if s != 200: errs += 1; out.setdefault('scan_err', j.get('error'))
            else: scans += 1
        elif not e[3]:
            try: sql(f"select record_call_room_inspection('{e[0]}', (select id from staff where role='call_room_official' limit 1), 'REPORTED', true, 9.0, true, '');", False); scans += 1
            except Exception as ex: errs += 1; out.setdefault('scan_err', str(ex)[:120])
        else:  # relay teams report through one runner's scan; RPC marks the team entry
            try: sql(f"select record_call_room_inspection('{e[0]}', (select id from staff where role='call_room_official' limit 1), 'REPORTED', true, 9.0, true, '');", False); scans += 1
            except Exception as ex: errs += 1; out.setdefault('scan_err', str(ex)[:120])
    out['scans'] = scans; out['scan_errs'] = errs; out['absent'] = len(absent)
    s, j = (200, {}) if resume else api('POST', f'/callroom/advance/{hid}', {}, TOK['adm']); out['advance'] = s
    if s != 200: out['advance_err'] = j.get('error'); log(**out); return out
    rep = [e for e in ents2 if e[0] not in absent]
    b = base(code); stmts = []
    off = "(select id from staff where role='referee' limit 1)"
    if cat in ('track_sprint', 'track_hurdles', 'track_distance', 'relay', 'road'):
        lo, hi = RANGES[b]; times = sorted(round(rnd.uniform(lo, hi), 2) for _ in rep)
        if len(times) > 3 and rnd.random() < 0.3: times[1] = times[2]       # a tie
        order = rep[:]; rnd.shuffle(order)
        for k, e in enumerate(order):
            st, t = 'FINISHED', times[k]
            if k == len(order) - 1 and len(order) > 4 and rnd.random() < 0.35: st, t = 'DQ', 'NULL'
            elif k == len(order) - 2 and len(order) > 5 and rnd.random() < 0.25: st, t = 'DNF', 'NULL'
            dq = "'TR 16.8'" if st == 'DQ' else "''"
            wind = '0.8' if cat in ('track_sprint', 'track_hurdles') else 'NULL'
            stmts.append(f"select submit_track_result('{e[0]}', {t}, {rnd.randint(130, 220) if st != 'DQ' else 85}, {wind}, '{st}', {dq}, {off});")
    elif cat.startswith('field') and b in FIELD:
        lo, hi = FIELD[b]; marks = {}
        for e in rep:
            ms = []
            for r in range(1, 7 if True else 4):
                ms.append(None if rnd.random() < 0.18 else round(rnd.uniform(lo, hi), 2))
            marks[e[0]] = ms
        best = {k: max([m for m in v[:3] if m] or [0]) for k, v in marks.items()}
        top8 = set(sorted(best, key=lambda k: -best[k])[:8])
        for e in rep:
            for r, m in enumerate(marks[e[0]], 1):
                if r > 3 and e[0] not in top8: continue
                w = '0.9' if b in ('LJ', 'TJ') else 'NULL'
                stmts.append(f"select submit_field_attempt('{e[0]}', {r}, '{'FOUL' if m is None else 'VALID'}', {m if m else 'NULL'}, {w}, {off});")
    elif cat.startswith('field') and b in VERT:
        start, step, lo, hi = VERT[b]
        for e in rep:
            top = round(rnd.uniform(lo, hi) / step) * step; h = start
            while True:
                an = 1; cleared = False
                while an <= 3:
                    ok = (h <= top) and (rnd.random() < (0.85 if an == 1 else 0.5))
                    stmts.append(f"select submit_vertical_jump_attempt('{e[0]}', {round(h, 2)}, {an}, '{'O' if ok else 'X'}', {off});")
                    if ok: cleared = True; break
                    an += 1
                if not cleared or h > hi + 0.2: break
                h += step
    else:
        out['skip'] = f'no result generator for {cat}'
    try:
        if stmts: sql('\n'.join(stmts), False)
    except Exception as ex:
        out['result_err'] = str(ex)[:300]
    path = '/field/finalize' if cat.startswith('field') else '/track/finalize'
    s, j = api('POST', path, {'heatId': hid}, TOK['ref']); out['finalize'] = s
    if s != 200: out['finalize_err'] = j.get('error')
    else: out['next'] = {k: j.get(k) for k in ('nextStage', 'builtNext', 'pointsAwarded', 'message') if k in j}; out['finalize_keys'] = list(j.keys())[:10]
    out['secs'] = round(time.time() - t0, 1)
    log(**out); return out

def run_event(code):
    rows = sql(f"select id, category from events where code='{code}'")[0]; eid, cat = rows
    n = 0
    for stage in ('HEATS', 'SEMI_FINAL', 'FINAL'):
        hs = sql(f"select id from heats where event_id='{eid}' and stage='{stage}' and status in ('SCHEDULED','DELAYED','CALL_ROOM','ON_TRACK') order by heat_number")
        for k, (hid,) in enumerate(hs):
            r = run_heat(hid, code, cat, k == 0)
            n += 1
            if r.get('finalize') != 200: print(f'  !! {code} {stage} heat {k + 1}: {({kk: r[kk] for kk in r if kk.endswith("err")})}', flush=True)
    done = sql(f"select stage, count(*), count(*) filter (where status in ('COMPLETED','OFFICIAL')) from heats where event_id='{eid}' group by stage order by 1")
    print(code, 'heats run', n, 'by stage (total, done):', done, flush=True)

if __name__ == '__main__':
    tokens()
    for code in sys.argv[1:]: run_event(code)
