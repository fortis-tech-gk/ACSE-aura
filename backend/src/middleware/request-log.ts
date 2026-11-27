/**
 * One structured log line per API request, for meet-day debugging and the traffic numbers.
 *
 * Cloud Run sends each JSON line on stdout to Cloud Logging, which reads `severity` and
 * `message` and indexes every other field, so you can filter e.g.
 *   jsonPayload.route="/api/catering/scan" AND jsonPayload.status>=500
 * A log sink copies these lines to BigQuery (DEPLOY.md → "Logs and meet numbers") so the
 * per-minute traffic and error figures survive the 30-day log retention.
 *
 * Privacy: never logs request bodies, query strings, tokens, names, PINs, phone or Aadhaar.
 * Ids in the path are replaced by placeholders; only the offline scan id (a random UUID made
 * by the app) and the meal type are read from the body, to trace a single scan end to end.
 */
import { createHash, randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { peekUser } from './auth';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/api/heats/1b2c…/results/3" → "/api/heats/:id/results/:n" (no ids, no query string) */
export function routeOf(originalUrl: string): string {
  return (originalUrl.split('?')[0] || '/')
    .replace(UUID_RE, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/:token')
    .slice(0, 120);
}

/** A database error can echo row data ("Failing row contains (…names…)"): keep only the first line. */
export function safeError(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const text = String(typeof raw === 'object' && raw && 'error' in (raw as any) ? (raw as any).error : raw);
  return text.split('\n')[0].replace(/Failing row contains.*$/i, 'Failing row …').replace(UUID_RE, ':id').slice(0, 300);
}

function severityOf(status: number): 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG' {
  if (status >= 500) return 'ERROR';
  if (status >= 400) return 'WARNING';
  return 'INFO';
}

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  // Cloud Run's trace header ties this line to the platform's own request log
  const trace = String(req.headers['x-cloud-trace-context'] || '').split('/')[0] || randomUUID();

  // Keep what the handler answered on a failure (the error text), without logging whole bodies
  let errorText: string | undefined;
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && 'error' in body) errorText = safeError(body.error);
    return json(body);
  };

  res.on('finish', () => {
    const route = routeOf(req.originalUrl || req.url);
    // Health checks and CORS pre-flights are noise in the numbers
    if (req.method === 'OPTIONS' || route === '/health') return;

    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const user = peekUser(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const line: Record<string, unknown> = {
      severity: severityOf(res.statusCode),
      message: `${req.method} ${route} ${res.statusCode} ${Math.round(ms)}ms`,
      type: 'request',
      env: process.env.AURA_ENV || process.env.NODE_ENV || 'dev',
      method: req.method,
      route,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      role: user?.role || 'anonymous',
      // Which login / tablet sent it (hash of the token, not the token): follow one food counter
      device: req.headers.authorization
        ? createHash('sha256').update(String(req.headers.authorization)).digest('hex').slice(0, 10)
        : undefined,
      scanId: typeof body.clientScanUuid === 'string' ? body.clientScanUuid.slice(0, 40) : undefined,
      meal: typeof body.mealType === 'string' ? body.mealType.slice(0, 12) : undefined,
      errorText,
      trace,
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  });

  next();
}

/**
 * One line with EVERY field a request line can carry, written when the API starts.
 * The BigQuery log sink adds a column the first time it sees a field, and a line that brings
 * new fields can be held back or lost while that happens (seen 27-11: the first food-scan line,
 * which brought scanId / meal / errorText at once, never arrived). Announcing all fields at
 * start-up means every column exists before real traffic. Reports skip it (type = 'schema').
 */
export function logSchemaWarmup() {
  process.stdout.write(
    JSON.stringify({
      severity: 'DEBUG',
      message: 'request log fields',
      type: 'schema',
      env: process.env.AURA_ENV || process.env.NODE_ENV || 'dev',
      method: 'GET',
      route: '/',
      status: 0.5,
      ms: 0.5,
      role: 'none',
      device: 'none',
      scanId: 'none',
      meal: 'none',
      errorText: 'none',
      trace: 'none',
      stack: 'none',
    }) + '\n'
  );
}

/** Crashes that never reach a route's catch block: logged in the same structured form. */
export function logFatal(kind: string, err: unknown) {
  const e = err as any;
  process.stdout.write(
    JSON.stringify({
      severity: 'ERROR',
      message: `${kind}: ${safeError(e?.message ?? e)}`,
      type: kind,
      env: process.env.AURA_ENV || process.env.NODE_ENV || 'dev',
      stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 8).join('\n') : undefined,
    }) + '\n'
  );
}
