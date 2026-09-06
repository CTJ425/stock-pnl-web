/**
 * Application error capture (Spec 146). Shared by every Edge Function that writes to
 * `public.app_log` — the capture layer for exceptions that would otherwise vanish into an
 * HTTP response nobody keeps (see schema.sql §6d-2).
 *
 * Redaction is an ALLOWLIST, not a denylist: a denylist fails open, and a redaction regex
 * already printed the DEV CRON_SECRET into a transcript once. Never widen this list to a
 * whole header, cookie, or request body — this repo is public.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'

type SupabaseClient = ReturnType<typeof createClient>

const ALLOWED_KEYS = new Set([
  'ticker',
  'count',
  'status',
  'code',
  'hint',
  'stack',
  'path',
  'duration_ms',
  'ymd',
  'attempt',
  'name',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(value: string, key: string | undefined): string {
  const max = key === 'stack' ? 2000 : 500
  return value.length > max ? value.slice(0, max) : value
}

/**
 * An array is the only place `detail` can grow without bound: the allowlist caps the key count
 * and `truncate` caps each string, but nothing caps the element count. `app_log.detail` has no
 * size CHECK in the database (`pg_column_size` is not immutable), so this is the cap.
 */
const MAX_ARRAY_ITEMS = 20

/** Recurses into objects and arrays at every depth, re-applying the same allowlist each time. */
function sanitize(value: unknown, key: string | undefined): unknown {
  if (typeof value === 'string') return truncate(value, key)
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, key))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
      if (!ALLOWED_KEYS.has(k)) continue
      out[k] = sanitize(value[k], k)
    }
    return out
  }
  return value
}

export function redactDetail(detail: unknown): Record<string, unknown> {
  return isPlainObject(detail) ? (sanitize(detail, undefined) as Record<string, unknown>) : {}
}

export interface LogEventInput {
  level: 'error' | 'warn' | 'info'
  action: string
  message: string
  detail?: Record<string, unknown>
  userId?: string | null
  requestId?: string | null
}

/**
 * Inserts one `app_log` row through the service-role client the caller already holds.
 *
 * Never throws and never rejects: this is observation data, and a logging failure must never
 * change, delay, or fail the caller's own result. Do not call this from inside its own catch —
 * that would be recursion into the same failure mode it exists to survive.
 */
export async function logEvent(admin: SupabaseClient, e: LogEventInput): Promise<void> {
  try {
    await admin.from('app_log').insert({
      source: 'edge',
      level: e.level,
      action: e.action.slice(0, 64),
      message: e.message.slice(0, 500),
      detail: redactDetail(e.detail ?? {}),
      user_id: e.userId ?? null,
      request_id: e.requestId ?? null,
    })
  } catch {
    // Discard. See the function comment above.
  }
}
