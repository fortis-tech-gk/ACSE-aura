import sys, os, uuid, random, subprocess, time, collections
sys.path.insert(0, os.path.dirname(__file__))
from meet_driver import *
DB = os.environ['DB']
rows = subprocess.run(['psql', DB, '-At', '-F', '|', '-c', "select bid_number, id, accreditation_status from profiles where bid_number is not null order by bid_number"], capture_output=True, text=True).stdout.split()
ath = [r.split('|') for r in rows]
rnd = random.Random(11)
print('athletes', len(ath))
t0 = time.time()
acc, ward, food = pin_login('accreditation_volunteer'), pin_login('warden'), pin_login('food_volunteer')
noshow = {a[0] for a in rnd.sample(ath, int(len(ath) * 0.04))}   # 4% never arrive
res = collections.Counter(); errs = collections.Counter()

def acc_scan(a):
    if a[0] in noshow or a[2] == 'ACCREDITED': return ('skip', None)
    s, j = call('POST', '/accreditation/scan', {'bib': int(a[0]), 'clientScanUuid': str(uuid.uuid4())}, acc)
    return (s, j)
out = pmap(acc_scan, ath)
for s, j in out:
    res['acc_' + str(s)] += 1
    if s not in (200, 'skip'): errs['acc:' + str(j.get('error'))[:100]] += 1
print('accreditation', dict(res), 'in', round(time.time() - t0), 's')
# idempotency: re-send one scan with the same uuid + bib twice
u = str(uuid.uuid4()); b = int(next(a[0] for a in ath if a[0] not in noshow))
print('dup scan', [call('POST', '/accreditation/scan', {'bib': b, 'clientScanUuid': u}, acc)[1] for _ in range(2)])
# warden check-in: those accreditated, 85% of them stay in hostel
stay = [a for a in ath if a[0] not in noshow and rnd.random() < 0.85]
def ward_scan(a):
    return call('POST', '/accommodation/checkin', {'bib': int(a[0]), 'clientScanUuid': str(uuid.uuid4())}, ward)
out = pmap(ward_scan, stay)
c = collections.Counter(s for s, j in out); print('hostel checkin', dict(c))
for s, j in out:
    if s != 200: errs['ward:' + str(j.get('error'))[:100]] += 1
# meals: breakfast + lunch for 80% of arrivals
def meal(a_m):
    a, m = a_m
    return call('POST', '/catering/scan', {'bib': int(a[0]), 'mealType': m, 'clientScanUuid': str(uuid.uuid4())}, food)
jobs = [(a, m) for a in ath if a[0] not in noshow and rnd.random() < 0.8 for m in ('BREAKFAST', 'LUNCH')]
out = pmap(meal, jobs); c = collections.Counter(s for s, j in out); print('meals', dict(c))
for s, j in out:
    if s != 200: errs['meal:' + str(j.get('error'))[:100]] += 1
# double claim
a = jobs[0][0]; print('double meal', call('POST', '/catering/scan', {'bib': int(a[0]), 'mealType': 'BREAKFAST', 'clientScanUuid': str(uuid.uuid4())}, food))
print('errors', dict(errs))
print('noshow bibs', len(noshow))
print('stats acc', call('GET', '/accreditation/stats', None, acc)[1])
print('stats ward', str(call('GET', '/accommodation/stats', None, ward)[1])[:400])
print('stats food', str(call('GET', '/catering/stats', None, food)[1])[:400])
