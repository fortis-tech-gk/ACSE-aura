#!/usr/bin/env python3
"""
Automatic walkthrough video of the VTU SportsOS web registration flow (STAGING only).

  .venv/bin/python demo.py --dry                 # fast rehearsal, no video, screenshots on failure
  .venv/bin/python demo.py --code KVGI           # real take: records video + voice + subtitles -> out/walkthrough.mp4
  .venv/bin/python demo.py --only 7,8 --dry      # run only some scenes (state is kept in out/state.json)

Everything it types is fictional. It logs in with the staging demo logins from docs/staging-demo.stag.md.
"""
import argparse, asyncio, json, os, random, re, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'out'
ASSETS = HERE / 'assets'
BASE = 'https://vtu-athletics.vercel.app'
VOICE = 'en-IN-NeerjaNeural'
W, H = 1440, 810
CHROME_ARGS = ['--disable-features=AsyncDns,DnsOverHttps']

doc = (ROOT / 'docs/staging-demo.stag.md').read_text()
_m = re.search(r'Meet admin \| `([^`]+)` \| `([^`]+)`', doc)
ADMIN_USER, ADMIN_PW = _m.group(1), _m.group(2)

ap = argparse.ArgumentParser()
ap.add_argument('--dry', action='store_true')
ap.add_argument('--only', default='')
ap.add_argument('--code', default='NHIT')
ap.add_argument('--name', default='Nandi Hills Institute of Technology')
ap.add_argument('--keep-raw', action='store_true')
ARGS = ap.parse_args()
DRY = ARGS.dry
OUT.mkdir(exist_ok=True)
STATE_FILE = OUT / 'state.json'
STATE = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}


def save_state():
    STATE_FILE.write_text(json.dumps(STATE, indent=2))


# --------------------------------------------------------------------------- driver
CURSOR_JS = """
(() => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:26px;height:26px;border-radius:50%;' +
      'background:rgba(255,90,0,.30);border:3px solid #ff5a00;pointer-events:none;left:-60px;top:-60px;' +
      'transform:translate(-50%,-50%) scale(1);transition:transform .12s ease;box-shadow:0 0 12px rgba(255,90,0,.6)';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.6)'; }, true);
    document.addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%) scale(1)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
"""


class Drv:
    def __init__(self, page):
        self.p = page
        self.x, self.y = W // 2, H // 2

    def pause(self, s):
        self.p.wait_for_timeout(int(s * 1000 * (0.15 if DRY else 1)))

    def goto(self, path):
        self.p.goto(BASE + path if path.startswith('/') else path, wait_until='load')
        try:
            self.p.wait_for_load_state('networkidle', timeout=8000)
        except Exception:
            pass
        self.p.mouse.move(self.x, self.y)
        self.pause(0.8)

    def _center(self, loc):
        loc.first.wait_for(state='visible', timeout=20000)
        box = loc.first.bounding_box()
        if box is None or box['y'] < 70 or box['y'] + box['height'] > H - 20:
            loc.first.evaluate("e => e.scrollIntoView({behavior:'smooth', block:'center'})")
            self.pause(0.7)
            box = loc.first.bounding_box()
        return box['x'] + min(box['width'] / 2, 140), box['y'] + box['height'] / 2

    def move(self, loc):
        tx, ty = self._center(loc)
        steps = 8 if DRY else 28
        self.p.mouse.move(tx, ty, steps=steps)
        self.x, self.y = tx, ty
        self.pause(0.15)

    def click(self, sel, **kw):
        loc = self.p.locator(sel) if isinstance(sel, str) else sel
        self.move(loc)
        loc.first.click(**kw)
        self.pause(0.35)

    def type(self, sel, text, delay=38):
        loc = self.p.locator(sel) if isinstance(sel, str) else sel
        self.move(loc)
        loc.first.click()
        loc.first.fill('')
        self.p.keyboard.type(text, delay=0 if DRY else delay)
        self.pause(0.2)

    def fill_fast(self, sel, text):
        loc = self.p.locator(sel) if isinstance(sel, str) else sel
        self.move(loc)
        loc.first.fill(text)
        self.pause(0.1)

    def pick(self, sel, code=None, label=None, value=None):
        loc = self.p.locator(sel) if isinstance(sel, str) else sel
        self.move(loc)
        if code is not None:
            value = loc.first.evaluate(
                "(s, c) => { const o=[...s.options].find(o=>o.text.startsWith('[Code '+c+']')); return o?o.value:null }", code)
        if value is not None:
            loc.first.select_option(value=value)
        else:
            loc.first.select_option(label=label)
        self.pause(0.3)

    def scroll(self, dy, steps=6, each=0.25):
        for _ in range(steps):
            self.p.mouse.wheel(0, dy / steps)
            self.pause(each)

    def top(self):
        self.p.evaluate("window.scrollTo({top:0,behavior:'smooth'})")
        self.pause(0.8)

    def shot(self, name):
        self.p.screenshot(path=str(OUT / f'{name}.png'))

    def card(self, title, sub=''):
        self.p.goto('about:blank')
        self.p.set_content(f"""<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;
          justify-content:center;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;font-family:system-ui,sans-serif;text-align:center">
          <div style="font-size:20px;letter-spacing:.35em;color:#fbbf24;font-weight:700">VTU SPORTSOS</div>
          <div style="font-size:54px;font-weight:800;margin:18px 40px 10px;line-height:1.15">{title}</div>
          <div style="font-size:24px;color:#cbd5e1;max-width:900px">{sub}</div></body>""")
        self.pause(0.6)


def run_ok(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip()


# --------------------------------------------------------------------------- scenes
SCENES = []


def scene(text):
    def deco(fn):
        SCENES.append((len(SCENES) + 1, fn.__name__, text, fn))
        return fn
    return deco


def rnd_digits(n):
    return ''.join(random.choice('0123456789') for _ in range(n))



_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
      [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
      [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
_INV = [0,4,3,2,1,5,6,7,8,9]


def aadhaar():
    body = str(random.randint(2, 9)) + rnd_digits(10)
    c = 0
    for i, ch in enumerate(reversed(body)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return body + str(_INV[c])


def logout(d):
    d.p.context.clear_cookies()


@scene("Welcome to VTU SportsOS, the registration system for the twenty-eighth VTU Inter-Collegiate Athletic Meet 2026, "
       "hosted by Dr. ACS College of Engineering, Bengaluru. In this video we follow one college through the whole journey: "
       "admin setup, athlete registration, fee payment, verification, and the final approved roster.")
def intro(d, S):
    d.card('Registration, start to finish', '28th VTU Inter-Collegiate State Level Athletic Meet 2026 · Dr. ACS-AURA')
    d.pause(5)


@scene("It starts with the meet admin. The admin signs in to the Directorate suite, and the dashboard shows registration "
       "progress across every college at a glance.")
def admin_login(d, S):
    d.goto('/login/admin')
    d.type('#username', ADMIN_USER)
    d.type('#password', ADMIN_PW)
    d.click('button[type=submit]')
    d.p.wait_for_url(lambda u: u.rstrip('/').endswith('/admin') and '/login' not in u, timeout=30000)
    d.pause(2)
    d.scroll(500, 4)
    d.top()


@scene("Registration is opened or closed with a single switch. While it is open, colleges can add athletes and pay. "
       "When the admin closes it, every roster is locked for good.")
def open_registration(d, S):
    d.goto('/admin')
    btn = d.p.locator('#btn-toggle-registration')
    d.move(btn)
    if 'Open Registration' in btn.inner_text():
        btn.click()
        d.p.get_by_role('button', name='Close', exact=True).first.wait_for(timeout=15000)
        d.pause(1.5)
        d.p.get_by_role('button', name='Close', exact=True).first.click()
    d.pause(1.5)


@scene("Now the admin registers a college. After filling in the college name, code, district and the Physical Education "
       "Director's details, the system creates a men's squad and a women's squad, each with its own secret passphrase. "
       "The admin shares these with the college's director.")
def add_college(d, S):
    code, name = ARGS.code.upper(), ARGS.name
    d.goto('/admin/colleges')
    d.click('#btn-open-add-college')
    d.type('#name', name)
    d.type('#code', code)
    d.type('#district', 'Chikkaballapur')
    d.type('#pedName', 'Dr. Ramesh Gowda')
    d.type('#pedPhone', '9845012345')
    d.type('#pedEmail', 'ped@' + code.lower() + '.example')
    d.click('#btn-submit-add-college')
    callout = d.p.locator('#credentials-callout')
    callout.wait_for(timeout=30000)
    txt = callout.inner_text()
    men = re.search(r'Squad Code:\s*(\S+)\s*Secret Passphrase:\s*(\S+)', txt)
    allm = re.findall(r'Squad Code:\s*(\S+)\s*Secret Passphrase:\s*(\S+)', txt)
    STATE.update(code=code, name=name, men_code=allm[0][0], men_pw=allm[0][1], women_code=allm[1][0], women_pw=allm[1][1])
    save_state()
    d.move(callout)
    d.pause(5)


@scene("The college's director now logs in to the contingent portal, using the college code, the division, and the "
       "passphrase. Men and women log in separately, so each division manages its own squad.")
def ped_login(d, S):
    logout(d)
    d.goto('/login/squad')
    d.type('#collegeCode', S['code'])
    d.click('#btn-select-male')
    d.type('#passphrase', S['men_pw'])
    d.click('button[type=submit]')
    d.p.wait_for_url('**/squad/dashboard', timeout=30000)
    d.pause(2)


@scene("The contingent overview shows the college profile, the director's details, and the current registration status. "
       "From here the director nominates athletes, manages the roster, and settles the fees.")
def dashboard(d, S):
    d.goto('/squad/dashboard')
    d.scroll(650, 5)
    d.pause(1.5)
    d.top()


def fill_athlete(d, S, a, fast=False):
    f = d.p.locator('#form-add-athlete')
    typ = d.fill_fast if fast else d.type
    typ(f.locator('input[placeholder="e.g. RAJESH KUMAR S"]'), a['name'])
    typ(f.locator('input[placeholder="e.g. 1ME21CS045"]'), a['usn'])
    d.pick(f.locator('select').nth(0), label='Semester 7')
    d.pick(f.locator('select').nth(1), label=a['blood'])
    d.fill_fast(f.locator('input[type=date]').nth(0), '2022-08-16')
    d.fill_fast(f.locator('input[type=date]').nth(1), '2026-08-10')
    typ(f.locator('input[placeholder="123456789012"]'), a['aadhaar'])
    typ(f.locator('#add-phone'), a['phone'])
    d.fill_fast('#add-dob', a['dob'])
    d.move(f.locator('input[type=file]'))
    f.locator('input[type=file]').set_input_files(str(ASSETS / a['photo']))
    d.pause(1.2)
    d.pick(f.locator('select').nth(2), code=a['e1'])
    if a.get('e2'):
        d.pick(f.locator('select').nth(3), code=a['e2'])
    if a.get('res'):
        d.pick(f.locator('select').nth(4), code=a['res'])
    if a.get('relay') is not None:
        d.click(f.locator('input[name=relayChoiceRadio]').nth(a['relay']))
    d.pause(1)


def submit_athlete(d):
    d.click('#btn-save-athlete')
    d.pause(2.5)
    err = d.p.locator('#add-athlete-error')
    if err.count() and err.first.is_visible():
        d.shot('athlete_error')
        raise RuntimeError('athlete form error: ' + err.first.inner_text())
    d.p.locator('#form-add-athlete').wait_for(state='detached', timeout=30000)
    d.pause(1.5)


def athlete(n):
    return dict(
        name=['ROHAN GOWDA K', 'ARJUN NAIK S'][n], photo=f'athlete{n + 1}.jpg',
        usn=f"1NH22{random.choice(['CS', 'EC', 'ME'])}{rnd_digits(3)}", blood=['O+', 'B+'][n],
        aadhaar=aadhaar(), phone='98450' + rnd_digits(5), dob=['2004-05-14', '2003-11-02'][n])


@scene("To register an athlete, the director taps Register New Athlete. The form asks for the details exactly as on the "
       "SSLC marks card: name, university seat number, semester, blood group, joining dates, Aadhaar, phone, date of "
       "birth, and a passport photo. The system checks that the Aadhaar and the seat number are unique across the whole championship.")
def athlete_one(d, S):
    d.goto('/squad/athletes')
    d.click('button:has-text("Register New Athlete")')
    a = athlete(0)
    a.update(e1='1', e2='15', res='2', relay=1)
    fill_athlete(d, S, a)
    S['a1'] = a['name']


@scene("Next come the events. An athlete can enter up to two individual events, here the 100 metres and the long jump, "
       "plus one reserve event, which is free. A relay is just ticked here: the 4 by 100 metres. "
       "Each college may field at most two athletes in any single event, and the fee is calculated automatically.")
def athlete_one_events_submit(d, S):
    d.pause(2)
    submit_athlete(d)


@scene("Let's add a second athlete the same way. A throws specialist this time, with the shot put and the discus.")
def athlete_two(d, S):
    d.click('button:has-text("Register New Athlete")')
    a = athlete(1)
    a.update(e1='11', e2='12', relay=0)
    fill_athlete(d, S, a, fast=True)
    submit_athlete(d)


@scene("The roster now lists every nominated athlete with their photo, events and status. Until payment is submitted, "
       "the director can edit or remove athletes freely.")
def roster(d, S):
    d.top()
    d.pause(2)
    d.scroll(500, 4)
    d.pause(2)


@scene("Time to pay. The fee page shows exactly what is owed: one hundred rupees per individual event and per half "
       "marathon entry, reserve events are free, and relays are capped at four hundred rupees per team. "
       "Men's and women's squads of a college pay together, in one single payment.")
def payment_overview(d, S):
    d.goto('/squad/payment')
    d.scroll(450, 4)
    d.pause(2)


@scene("The director transfers the amount to the host's UPI account, then enters the amount, the UTR reference number "
       "from the bank, and uploads a screenshot of the receipt. Submitting the proof locks the roster, so nothing can change "
       "while the payment is being verified.")
def payment_submit(d, S):
    amt = d.p.locator('#amount')
    d.move(amt)
    cur = amt.input_value()
    if not cur.strip():
        txt = d.p.inner_text('body')
        mm = re.search(r'Balance[^\n]*?₹\s*([\d,]+)', txt) or re.search(r'₹\s*([\d,]+)', txt)
        cur = mm.group(1).replace(',', '') if mm else '500'
        d.type('#amount', cur)
    S['paid'] = cur
    d.type('#utr', 'DEMO' + rnd_digits(10))
    d.move(d.p.locator('#screenshot'))
    d.p.locator('#screenshot').set_input_files(str(ASSETS / 'receipt.png'))
    d.pause(1.2)
    d.click('#btn-submit-payment-proof')
    d.pause(4)
    d.scroll(-800, 3)


@scene("Now the other side. The finance desk opens the Payment Verification portal and finds the college waiting, "
       "with its UTR, the amount credited, and the uploaded proof.")
def admin_verify_open(d, S):
    logout(d)
    d.goto('/login/admin')
    d.type('#username', ADMIN_USER)
    d.type('#password', ADMIN_PW)
    d.click('button[type=submit]')
    d.p.wait_for_url(lambda u: u.rstrip('/').endswith('/admin') and '/login' not in u, timeout=30000)
    d.goto('/admin/payments')
    d.pick('#payment-status-filter', label='⏳ Pending Verification')
    d.type('#payment-search', S['code'])
    d.pause(1.5)
    d.click(d.p.locator('tr:has-text("Men"):not(:has-text("Women")):has-text("Open Details")').first.get_by_text('Open Details'))
    d.pause(2)


@scene("After checking the receipt against the bank statement, the admin types in the amount actually credited, "
       "so only the real figure counts, and approves the payment. The college is verified instantly.")
def admin_approve(d, S):
    d.pause(2)
    d.type('#input-amount-received', S.get('paid') or '500')
    d.pause(1.5)
    d.click('#btn-approve-payment')
    d.pause(4)


@scene("Back on the college's side, the status now reads Verified. The official registration report with every athlete "
       "is ready to print, and the fee invoice is available as a receipt.")
def ped_verified(d, S):
    logout(d)
    d.goto('/login/squad')
    d.type('#collegeCode', S['code'])
    d.click('#btn-select-male')
    d.type('#passphrase', S['men_pw'])
    d.click('button[type=submit]')
    d.p.wait_for_url('**/squad/dashboard', timeout=30000)
    d.pause(2)
    d.goto('/squad/athletes')
    d.click('button:has-text("Registration Report")')
    d.pause(5)
    d.scroll(500, 4)
    d.pause(1.5)
    d.p.keyboard.press('Escape')
    d.pause(1)
    d.goto('/squad/payment')
    d.pause(2.5)


@scene("That is the full registration journey. The college is registered, its athletes are entered, the fees are paid and "
       "verified, and the roster is locked and ready for the meet. Thank you for watching.")
def outro(d, S):
    d.card('Registered · Paid · Verified', 'Dr. ACS-AURA 2026 · VTU Inter-Collegiate State Level Athletic Meet')
    d.pause(4)


# --------------------------------------------------------------------------- audio / assembly
async def _tts(text, path):
    import edge_tts
    await edge_tts.Communicate(text, VOICE, rate='-4%').save(str(path))


def dur(path):
    return float(run_ok(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(path)]))


def srt_time(t):
    ms = int(t * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def make_srt(timeline, path):
    lines, n = [], 1
    for t in timeline:
        words = t['text'].replace('  ', ' ').split()
        chunks, cur = [], []
        for w in words:
            cur.append(w)
            if len(' '.join(cur)) > 74:
                chunks.append(' '.join(cur)); cur = []
        if cur:
            chunks.append(' '.join(cur))
        total = sum(len(c) for c in chunks)
        s = t['start']
        for c in chunks:
            d_ = t['audio_dur'] * len(c) / total
            lines.append(f"{n}\n{srt_time(s)} --> {srt_time(s + d_)}\n{c}\n")
            n += 1
            s += d_
    Path(path).write_text('\n'.join(lines))


def assemble(raw_video, timeline, video_len):
    final_len = timeline[-1]['end']
    offset = max(0.0, video_len - final_len)  # recording starts a little before our clock
    audio_inputs, filt = [], []
    for i, t in enumerate(timeline):
        audio_inputs += ['-i', t['audio']]
        ms = int((t['start'] + offset) * 1000)
        filt.append(f'[{i + 1}:a]adelay={ms}|{ms}[a{i}]')
    mix = ''.join(f'[a{i}]' for i in range(len(timeline))) + f'amix=inputs={len(timeline)}:normalize=0:dropout_transition=0[aout]'
    for t in timeline:
        t['start'] += offset
    make_srt(timeline, OUT / 'subs.srt')
    style = "FontName=DejaVu Sans,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H99000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=26,Alignment=2"
    vf = f"subtitles={OUT / 'subs.srt'}:force_style='{style}',format=yuv420p"
    cmd = ['ffmpeg', '-y', '-i', str(raw_video), *audio_inputs, '-filter_complex', ';'.join(filt) + ';' + mix,
           '-vf', vf, '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
           '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-shortest', str(OUT / 'walkthrough.mp4')]
    subprocess.run(cmd, check=True, capture_output=True)


# --------------------------------------------------------------------------- main
def main():
    only = {int(x) for x in ARGS.only.split(',') if x}
    chosen = [s for s in SCENES if not only or s[0] in only]
    if not DRY:
        for f in (OUT / 'raw').glob('*'):
            f.unlink()
        (OUT / 'audio').mkdir(exist_ok=True)
        print('generating narration ...')
        for num, name, text, _ in chosen:
            asyncio.run(_tts(text, OUT / 'audio' / f'{num:02d}.mp3'))
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=CHROME_ARGS)
        kw = dict(viewport={'width': W, 'height': H})
        if not DRY:
            kw.update(record_video_dir=str(OUT / 'raw'), record_video_size={'width': W, 'height': H})
        ctx = br.new_context(**kw)
        ctx.add_init_script(CURSOR_JS)
        page = ctx.new_page()
        page.on('dialog', lambda dlg: dlg.accept())
        d = Drv(page)
        t0 = time.monotonic()
        timeline = []
        for num, name, text, fn in chosen:
            print(f'scene {num}: {name}')
            start = time.monotonic() - t0
            adur = 0 if DRY else dur(OUT / 'audio' / f'{num:02d}.mp3')
            try:
                fn(d, STATE)
            except Exception:
                d.shot(f'fail_{num}_{name}')
                print('FAILED scene', num, name, '- screenshot saved')
                ctx.close(); br.close()
                raise
            if not DRY:
                spent = time.monotonic() - t0 - start
                d.pause(max(0.0, adur + 0.9 - spent))
                timeline.append(dict(num=num, text=text, start=start, end=time.monotonic() - t0,
                                     audio=str(OUT / 'audio' / f'{num:02d}.mp3'), audio_dur=adur))
        vid = page.video
        ctx.close(); br.close()
        if DRY:
            print('dry run OK'); return
        raw = Path(vid.path())
        shutil.move(str(raw), str(OUT / 'raw.webm'))
        (OUT / 'timeline.json').write_text(json.dumps(timeline, indent=2))
        print('assembling ...')
        assemble(OUT / 'raw.webm', timeline, dur(OUT / 'raw.webm'))
        print('DONE ->', OUT / 'walkthrough.mp4')


if __name__ == '__main__':
    main()
