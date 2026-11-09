/**
 * k6 load test — AURA Athletes traffic pattern at meet scale.
 *
 *   docker run --rm -i --network host -e BASE=https://<service>.run.app -e USERS=3000 \
 *     -v "$PWD":/t grafana/k6 run /t/aura-athletes.k6.js
 *
 * Each virtual athlete: logs in once (bib + DOB of a LOADTEST athlete, see seed-loadtest.sql),
 * loads /me, then loops: standings every ~30 s, results every ~60 s, /me every ~5 min —
 * the same cadence as the app. Ramps to USERS over 3 min, holds 5 min.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = (__ENV.BASE || 'http://localhost:5000').replace(/\/+$/, '') + '/api';
const USERS = parseInt(__ENV.USERS || '3000', 10);
const BIB_START = parseInt(__ENV.BIB_START || '90000', 10);

export const options = {
  scenarios: {
    athletes: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '3m', target: USERS },
        { duration: __ENV.HOLD || '5m', target: USERS },
        { duration: __ENV.DOWN || '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],            // < 1 % errors
    'http_req_duration{name:me}': ['p(95)<1500'],
    'http_req_duration{name:standings}': ['p(95)<800'],
    'http_req_duration{name:login}': ['p(95)<2000'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

export default function () {
  // One persistent "athlete" per VU
  if (!__ITER || !globalThis.token) {
    const bib = BIB_START + ((__VU - 1) % USERS);
    const res = http.post(`${BASE}/athlete/login`, JSON.stringify({ bib: String(bib), dob: '2004-01-01' }), { ...json, tags: { name: 'login' } });
    check(res, { 'login 200': (r) => r.status === 200 });
    globalThis.token = res.status === 200 ? res.json('token') : null;
    globalThis.auth = { headers: { Authorization: `Bearer ${globalThis.token}` } };
    if (globalThis.token) {
      const me = http.get(`${BASE}/athlete/me`, { ...globalThis.auth, tags: { name: 'me' } });
      check(me, { 'me 200': (r) => r.status === 200 });
    }
    sleep(Math.random() * 5);
  }
  if (!globalThis.token) {
    sleep(30);
    return;
  }

  const s = http.get(`${BASE}/live/leaderboard`, { tags: { name: 'standings' } });
  check(s, { 'standings 200': (r) => r.status === 200 });

  if (__ITER % 2 === 0) {
    const p = http.get(`${BASE}/athlete/performance`, { ...globalThis.auth, tags: { name: 'performance' } });
    check(p, { 'performance 200': (r) => r.status === 200 });
  }
  if (__ITER % 10 === 0) {
    const me = http.get(`${BASE}/athlete/me`, { ...globalThis.auth, tags: { name: 'me' } });
    check(me, { 'me 200': (r) => r.status === 200 });
  }
  sleep(25 + Math.random() * 10); // ~30 s like the app's standings refresh
}
