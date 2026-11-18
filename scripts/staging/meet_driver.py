"""Staging meet-day driver: calls the real backend API as each official (PIN logins from docs/staging-demo.stag.md)."""
import re, json, uuid, time, urllib.request, urllib.error, concurrent.futures as cf, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = 'https://aura-api-staging-wgebilkjsa-el.a.run.app/api'
GUIDE = open(os.path.join(ROOT, 'docs/staging-demo.stag.md')).read()


def cred(label):
    m = re.search(r'\|\s*' + label + r'\s*\|\s*`([^`]+)`', GUIDE)
    return m.group(1)


PINS = {'accreditation_volunteer': cred('Accreditation desk'), 'warden': cred('Hostel warden'), 'food_volunteer': cred('Food counter'),
        'call_room_official': cred('Call room'), 'referee': cred('Referee')}
ADMIN = ('demo.admin', cred('Meet admin').replace('demo.admin', '') or None)


def call(method, path, body=None, token=None, retries=3):
    data = json.dumps(body).encode() if body is not None else None
    for i in range(retries):
        req = urllib.request.Request(API + path, data=data, method=method, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            try: j = json.loads(txt)
            except Exception: j = {'error': txt[:200]}
            if e.code in (502, 503, 504) and i < retries - 1:
                time.sleep(2); continue
            return e.code, j
        except Exception as e:
            if i == retries - 1: return 0, {'error': str(e)}
            time.sleep(2)


def pin_login(role):
    s, j = call('POST', '/auth/staff/pin-login', {'role': role, 'pin': PINS[role]})
    assert s == 200, (role, s, j)
    return j['token']


def admin_login():
    m = re.search(r'Meet admin\s*\|\s*`demo.admin`\s*\|\s*`([^`]+)`', GUIDE)
    s, j = call('POST', '/auth/staff/login', {'username': 'demo.admin', 'password': m.group(1)})
    assert s == 200, (s, j)
    return j['token']


def pmap(fn, items, workers=12):
    with cf.ThreadPoolExecutor(workers) as ex:
        return list(ex.map(fn, items))
