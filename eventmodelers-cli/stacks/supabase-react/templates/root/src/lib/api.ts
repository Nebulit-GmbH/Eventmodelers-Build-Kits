import { supabase } from './supabase';

/**
 * Common API client — the ONLY place that knows about base URLs, auth headers,
 * correlation/causation tracing, and how to reach Supabase tables. Slice components
 * must never call `fetch` directly, read the Supabase session, or import
 * `./supabase` themselves — they call `postCommand`/`queryReadModel` and handle only
 * the request/response shape their command/read model defines.
 *
 * Every call here has two implementations: a real one (Supabase) and a mock one that
 * serves a numbered sample instead. This is what makes every slice component testable
 * in isolation — flip `VITE_DATA_MODE` to `mock` and every read/write in the app is
 * served from `samples/sample-<VITE_MOCK_SAMPLE>.json` files instead of a live backend.
 */

export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** `true` when reads/writes should be served from samples instead of Supabase/the backend. */
export function isMockMode(): boolean {
  return import.meta.env.VITE_DATA_MODE === 'mock';
}

/** Which numbered sample set is active in mock mode, e.g. `"1"`, `"2"`. */
export function activeMockSample(): string {
  return import.meta.env.VITE_MOCK_SAMPLE ?? '1';
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    'Content-Type': 'application/json',
    Authorization: session ? `Bearer ${session.access_token}` : '',
    'x-correlation-id': crypto.randomUUID(),
    'x-causation-id': crypto.randomUUID(),
  };
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * POST a command to `path` (taken verbatim from the command's API description in
 * slice.json — never invented) with `body` as the JSON payload. Resolves with the
 * parsed JSON response, or throws `ApiError` on a non-2xx response.
 *
 * In mock mode this never hits the network — it resolves with `{ ok: true }` so a
 * command component can be exercised (submitting/success states) fully offline.
 */
export async function postCommand<TResponse = unknown>(
  path: string,
  body: unknown,
): Promise<TResponse> {
  if (isMockMode()) {
    return { ok: true } as TResponse;
  }

  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => undefined);

  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) || `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as TResponse;
}

/**
 * Fill an OpenAPI path template (`/api/customers/{customerId}/reservation`) with values,
 * URL-encoding each one. Throws if a `{param}` has no value — a contract's path parameters are
 * required. Use the contract's path verbatim as `template`; never hand-assemble a URL.
 */
export function buildPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(String(value));
  });
}

function mockSample<T>(samples: Record<string, T> | undefined, what: string): T {
  const n = activeMockSample();
  const sample = samples?.[n];
  if (sample === undefined) {
    throw new Error(
      `Mock mode is on (VITE_MOCK_SAMPLE=${n}) but no sample-${n}.json exists for ${what} — add one under this component's samples/ folder.`,
    );
  }
  return sample;
}

/**
 * GET a read model from the backend's published `GET` UI contract (`path` already filled via
 * `buildPath`, `query` = the contract's query `parameters`). Resolves with the parsed JSON, or
 * throws `ApiError` on a non-2xx response — the status and body let a component render each
 * documented error response as its own state. Mock mode serves `samples` like `queryReadModel`.
 */
export async function getReadModel<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  samples?: Record<string, T>,
): Promise<T> {
  if (isMockMode()) return mockSample(samples, `GET ${path}`);

  const qs = new URLSearchParams(
    Object.entries(query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
  ).toString();
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ''}`, { method: 'GET', headers });

  const payload = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message =
      (payload && (payload.error || payload.message)) || `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, payload);
  }
  return payload as T;
}

export interface ReadModelParams {
  /** `readmodel.apiEndpoint`, verbatim — the Postgres table/view name. */
  table: string;
  /** Column names to select, comma-separated (never `'*'`). */
  select: string;
  /** Simple equality filters, e.g. `{ customer_id: customerId }`. */
  filters?: Record<string, unknown>;
  /** `true` for a single-row read model (`.maybeSingle()`), `false` for a list. */
  single?: boolean;
}

/**
 * Read a read model's data — `params.table` via Supabase in the real implementation,
 * or `samples[activeMockSample()]` in mock mode. `samples` is this component's own
 * `samples/sample-*.json` map (see the component for how it's built); every read model
 * component supplies its own, `queryReadModel` never reaches into a slice folder itself.
 */
export async function queryReadModel<T>(
  params: ReadModelParams,
  samples?: Record<string, T>,
): Promise<T> {
  if (isMockMode()) return mockSample(samples, `table "${params.table}"`);

  let query = supabase.from(params.table).select(params.select);
  for (const [column, value] of Object.entries(params.filters ?? {})) {
    query = query.eq(column, value);
  }

  const { data, error } = params.single ? await query.maybeSingle() : await query;
  if (error) throw new ApiError(error.message, 500, error);
  return data as T;
}
