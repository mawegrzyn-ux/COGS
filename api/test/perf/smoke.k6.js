// k6 performance smoke test.
//
// Run:  k6 run --vus 10 --duration 30s test/perf/smoke.k6.js
//
// Targets: 5 read endpoints + 1 menu COGS calc. Asserts:
//   - p95 latency < 1500ms
//   - error rate < 1%
//
// Set BASE_URL + AUTH_TOKEN env vars before running.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const options = {
  vus: __ENV.VUS ? Number(__ENV.VUS) : 10,
  duration: __ENV.DURATION || '30s',
  thresholds: {
    http_req_duration: ['p(95)<1500'],   // 95% of requests < 1.5s
    http_req_failed: ['rate<0.01'],      // <1% errors
  },
};

const BASE_URL  = __ENV.BASE_URL  || 'https://cogs-staging.macaroonie.com';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const errors = new Rate('custom_errors');

const HEADERS = {
  'Authorization': `Bearer ${AUTH_TOKEN}`,
  'Accept': 'application/json',
};

const ENDPOINTS = [
  { method: 'GET', path: '/api/health',         auth: false },
  { method: 'GET', path: '/api/me',             auth: true  },
  { method: 'GET', path: '/api/ingredients',    auth: true  },
  { method: 'GET', path: '/api/recipes',        auth: true  },
  { method: 'GET', path: '/api/menus',          auth: true  },
  { method: 'GET', path: '/api/dashboard/stats',auth: true  },
];

export default function () {
  for (const ep of ENDPOINTS) {
    const headers = ep.auth ? HEADERS : {};
    const res = http.request(ep.method, `${BASE_URL}${ep.path}`, null, { headers });
    const ok = check(res, {
      [`${ep.path} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
      [`${ep.path} body non-empty`]: (r) => r.body.length > 0,
    });
    errors.add(!ok);
    sleep(0.1);
  }
}
