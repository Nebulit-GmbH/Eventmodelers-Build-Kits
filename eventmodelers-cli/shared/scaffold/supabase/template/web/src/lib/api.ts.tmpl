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

async function getAuthHeaders(json = true): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    // multipart bodies must leave Content-Type unset so the browser adds the boundary
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: session ? `Bearer ${session.access_token}` : '',
    'x-correlation-id': crypto.randomUUID(),
    'x-causation-id': crypto.randomUUID(),
  };
}

/** 501 means the endpoint is modeled but its slice is not built yet (distinct from a 404 for a wrong URL). */
export const NOT_BUILT_MESSAGE = 'This feature is not built yet.';

function errorMessage(status: number, payload: { error?: string; message?: string } | undefined): string {
  if (status === 501) return NOT_BUILT_MESSAGE;
  return (payload && (payload.error || payload.message)) || `Request failed with status ${status}`;
}

/** True when an error from this module means "modeled, but its slice is not built yet" (HTTP 501). */
export function isNotBuilt(err: unknown): boolean {
  return err instanceof ApiError && err.status === 501;
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
    throw new ApiError(errorMessage(res.status, payload), res.status, payload);
  }

  return payload as TResponse;
}

/**
 * POST a multipart/form-data command (e.g. one carrying a file) to `path`. Same contract as
 * `postCommand`: resolves with the parsed JSON response, throws `ApiError` on a non-2xx
 * response, and resolves with `{ ok: true }` locally in mock mode.
 */
export async function postForm<TResponse = unknown>(
  path: string,
  body: FormData,
): Promise<TResponse> {
  if (isMockMode()) {
    return { ok: true } as TResponse;
  }

  const headers = await getAuthHeaders(false);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body });

  const payload = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new ApiError(errorMessage(res.status, payload), res.status, payload);
  }

  return payload as TResponse;
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
  if (isMockMode()) {
    return mockSample(samples, `table "${params.table}"`);
  }

  let query = supabase.from(params.table).select(params.select);
  for (const [column, value] of Object.entries(params.filters ?? {})) {
    query = query.eq(column, value);
  }

  const { data, error } = params.single ? await query.maybeSingle() : await query;
  // A read-model table that does not exist yet means its slice is not built: same 501 as the backend fallback.
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) throw new ApiError(NOT_BUILT_MESSAGE, 501, error);
  if (error) throw new ApiError(error.message, 500, error);
  return data as T;
}

/**
 * GET a read model from a backend query route, e.g. `/api/query/orderlist-collection` —
 * for read models whose table has RLS on with no policies (kept off Supabase's Data API),
 * so `queryReadModel` would only ever see an empty result. Resolves with the parsed JSON
 * response, or throws `ApiError` on a non-2xx response; mock-aware like `queryReadModel`.
 */
export async function getReadModel<T>(path: string, samples?: Record<string, T>): Promise<T> {
  if (isMockMode()) {
    return mockSample(samples, `"${path}"`);
  }

  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers });

  const payload = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new ApiError(errorMessage(res.status, payload), res.status, payload);
  }

  return payload as T;
}

async function fetchFile(path: string): Promise<Blob> {
  const headers = await getAuthHeaders(false);
  const res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => undefined);
    throw new ApiError(errorMessage(res.status, payload), res.status, payload);
  }
  return res.blob();
}

/**
 * GET a binary file (e.g. a generated PDF) from `path` with auth headers and open it in a new
 * browser tab. In mock mode nothing is fetched; the call just resolves.
 */
export async function openFile(path: string): Promise<void> {
  if (isMockMode()) return;

  const url = URL.createObjectURL(await fetchFile(path));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * GET a file (e.g. a template logo) from `path` with auth headers and return a blob URL for an
 * `<img src>`, which would send no bearer token itself. The caller revokes it with
 * `URL.revokeObjectURL`. In mock mode nothing is fetched; resolves with `null`.
 */
export async function fileUrl(path: string): Promise<string | null> {
  if (isMockMode()) return null;

  return URL.createObjectURL(await fetchFile(path));
}

function mockSample<T>(samples: Record<string, T> | undefined, source: string): T {
  const n = activeMockSample();
  const sample = samples?.[n];
  if (sample === undefined) {
    throw new Error(
      `Mock mode is on (VITE_MOCK_SAMPLE=${n}) but no sample-${n}.json exists for ${source} — add one under this component's samples/ folder.`,
    );
  }
  return sample;
}
