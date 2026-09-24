/** Process-wide handles and HTTP helpers shared by index.ts and its action modules. */
import { createClient } from 'jsr:@supabase/supabase-js@2'

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatically injected by the Supabase execution environment;
// The service role is not restricted by RLS and is the only way to read and write chip_raw_cache.
export const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** ER-14: documented request body cap, checked against `Content-Length` before `req.json()` runs. */
export const MAX_REQUEST_BODY_BYTES = 1_000_000

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/**
 * ER-15: `err.stack` is unbounded and can echo an upstream response verbatim — a stack that runs
 * through a URL carrying a signed query string would leak it straight into app_log. Keep only the
 * message line plus the first 3 call frames, and mask anything shaped like a long token (20+ chars
 * of base64/hex/JWT alphabet) before it ever reaches `logEvent`. This is a mask, not the allowlist
 * redaction _shared/log.ts already does on every field — see that file's header comment on why a
 * denylist is never enough on its own.
 */
export function safeStack(err: unknown): string | undefined {
  if (!(err instanceof Error) || !err.stack) return undefined
  const [head, ...frames] = err.stack.split('\n')
  return [head, ...frames.slice(0, 3)].join('\n').replace(/[A-Za-z0-9+/_=-]{20,}/g, '[redacted]')
}
