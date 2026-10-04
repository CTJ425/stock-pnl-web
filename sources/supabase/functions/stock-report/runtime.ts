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

// Moved to _shared/log.ts so stock-price masks its stacks the same way (Task 193); re-exported for index.ts.
export { safeStack } from '../_shared/log.ts'
