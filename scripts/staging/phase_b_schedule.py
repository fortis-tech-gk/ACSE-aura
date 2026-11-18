"""Load the official 'Order of Events' (docs/Order of Events.pdf, Days 1-4, no Decathlon/Heptathlon) into schedule_items."""
import os, subprocess, uuid, datetime as dt
DB = os.environ['DB']
def psql(s):
    r = subprocess.run(['psql', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-At'], input=s, text=True, capture_output=True)
    if r.returncode: print(r.stderr[-1500:]); raise SystemExit(1)
    return r.stdout
ev = {code: i for code, i in (l.split('|') for l in psql('select code, id from events').split())}
H, S, F = 'HEATS', 'SEMI_FINAL', 'FINAL'
def c(base, g): return {'110H': '110H-M', '100H': '100H-W', '20KMW': '20KM-W-' + g, 'HM': 'HM-' + g}.get(base, f'{base}-{g}')
# (day, time, base event, genders, stage)
D = {
 1: [('06:30','10000M','M',F),('07:25','10000M','W',F),('07:30','HJ','W',F),('07:45','JT','W',F),('10:30','800M','M',H),('10:50','800M','W',H),
     ('11:15','4X100M','M',H),('11:45','4X100M','W',H),('12:30','400H','M',H),('12:45','400H','W',H),('14:30','JT','M',F),('14:30','HJ','M',F),
     ('14:45','400H','W',F),('14:55','400H','M',F),('15:10','4X100M','M',S),('15:25','4X100M','W',S),('15:50','800M','M',F),('16:05','800M','W',F),
     ('16:20','4X100M','M',F),('16:40','4X100M','W',F)],
 2: [('06:00','20KMW','M',F),('06:15','20KMW','W',F),('08:00','400M','M',H),('08:00','DT','M',F),('08:30','400M','W',H),('08:50','TJ','W',F),
     ('09:00','100M','W',H),('09:30','100M','M',H),('10:10','100H','W',H),('11:15','100M','M',S),('11:30','100M','W',S),('12:15','100H','W',S),
     ('12:30','4X400M-MIX','X',H),('14:30','TJ','M',F),('14:30','DT','W',F),('14:30','100H','W',F),('14:45','4X400M-MIX','X',S),('15:50','100M','M',F),
     ('16:00','100M','W',F),('16:10','5000M','M',F),('16:40','5000M','W',F),('17:35','4X400M-MIX','X',F)],
 3: [('06:15','HM','M',F),('06:25','HM','W',F),('08:45','110H','M',H),('09:00','SP','W',F),('09:05','1500M','M',H),('09:20','1500M','W',H),
     ('09:45','110H','M',S),('10:00','LJ','W',F),('10:10','400M','M',S),('10:15','400M','W',S),('14:30','110H','M',F),('14:45','LJ','M',F),
     ('15:30','SP','M',F),('16:40','400M','M',F),('16:45','400M','W',F)],
 4: [('07:00','HT','M',F),('07:15','PV','M',F),('07:30','200M','M',H),('08:00','200M','W',H),('08:20','1500M','M',F),('08:30','1500M','W',F),
     ('08:45','PV','W',F),('09:00','HT','W',F),('09:15','4X400M','M',H),('09:45','4X400M','W',H),('10:30','200M','M',S),('10:45','200M','W',S),
     ('11:00','4X400M','M',S),('11:15','4X400M','W',S),('14:30','200M','M',F),('14:45','200M','W',F),('15:00','4X400M','M',F),('15:15','4X400M','W',F)],
}
sql = ['BEGIN;']
sess = {}
for day in D:
    for part, start in (('Morning', '06:00'), ('Afternoon', '14:30')):
        sid = str(uuid.uuid4()); sess[(day, part)] = sid
        sql.append(f"INSERT INTO schedule_sessions (id, meet_id, session_name, session_date, start_time) VALUES ('{sid}', (SELECT id FROM meet_settings LIMIT 1), 'Day {day} — {part}', '2026-12-{6+day:02d}', '{start}');")
n = 0
for day, items in D.items():
    for t, base, g, stage in items:
        code = '4X400M-MIX' if g == 'X' else c(base, g)
        part = 'Morning' if t < '13:00' else 'Afternoon'
        hh, mm = map(int, t.split(':')); cr = (dt.datetime(2026, 1, 1, hh, mm) - dt.timedelta(minutes=30)).strftime('%H:%M')
        sql.append(f"INSERT INTO schedule_items (session_id, event_id, stage, scheduled_time, call_room_time, status) VALUES ('{sess[(day, part)]}', '{ev[code]}', '{stage}', '{t}', '{cr}', 'SCHEDULED');"); n += 1
sql.append('COMMIT;')
psql('\n'.join(sql)); print('schedule items', n)
