// Frontend test setup.
// - Adds @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// - Mocks @auth0/auth0-react so components under test never hit real Auth0
// - Mocks fetch with a queue helper for predictable API responses

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auth0 mock — return a permissive default that tests can override per-spec.
vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isLoading: false,
    isAuthenticated: true,
    user: { sub: 'auth0|test', email: 'test@example.com', name: 'Test User' },
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn().mockResolvedValue('test-token'),
  }),
  Auth0Provider: ({ children }: { children: React.ReactNode }) => children,
  withAuthenticationRequired: (c: unknown) => c,
}));

// Fetch mock helpers — tests can call mockFetchOnce / mockFetchSequence.
const fetchQueue: Array<() => Promise<Response>> = [];

beforeEach(() => {
  fetchQueue.length = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (fetchQueue.length > 0) {
      const next = fetchQueue.shift()!;
      return next();
    }
    // Default: return empty array for any unmocked GET, {} for everything else.
    const url = typeof input === 'string' ? input : input.toString();
    return new Response(JSON.stringify(url.includes('?') ? [] : {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

export function mockFetchOnce(body: unknown, status = 200) {
  fetchQueue.push(() => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })));
}

export function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>) {
  for (const r of responses) mockFetchOnce(r.body, r.status ?? 200);
}
