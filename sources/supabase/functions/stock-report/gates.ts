/** The three auth gates an action can sit behind: pg_cron secret, admin JWT, any signed-in user. */
import { secretsMatch } from './cronSecret.ts'
import { db, json } from './runtime.ts'

/** generate-all will write Storage, and the endpoint is public (--no-verify-jwt), so x-cron-secret is required to match the environment variable*/
export function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || !secretsMatch(got, expected)) return json({ error: 'Unauthorized' }, 401)
  return null
}

/**
 * Gatekeeping for the admin-specific endpoint: Validate the caller's JWT and `app_metadata.role === 'admin'`.
 *
 * **Cannot use `assertCronSecret`** - that is the shared secret used by pg_cron,
 * The front end can't get it and shouldn't get it (once it's put in the front end, it's public, and anyone can trigger the entire batch of fetching).
 *
 * **Cannot use email to compare**. `app_metadata` can only be written by service role / Dashboard,
 * Users cannot change their own; email is a field that users can change by themselves. Using it as the basis for authorization means no authorization.
 * This is the same set of criteria as `isAdmin()` of `src/services/adminStatus.ts`, and both sides must be consistent.
 *
 * This function is deployed with `--no-verify-jwt`. The platform will not help verify JWT, so you can verify it yourself here.
 */
export async function assertAdmin(req: Request): Promise<Response | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)
  try {
    const { data, error } = await db.auth.getUser(token)
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401)
    const meta = data.user.app_metadata as Record<string, unknown> | undefined
    if (meta?.role !== 'admin') return json({ error: 'Forbidden' }, 403)
    return null
  } catch {
    return json({ error: 'Unauthorized' }, 401)
  }
}

/**
 * Login gate for browser-called endpoints (`generate` / `warm` / admin helpers).
 *
 * 0.7.0 pairs this with `heldTwTickers()` again (search/TOP removed). Keep both: account proof
 * via getUser (anon JWT has no sub) plus the holdings amplification ceiling.
 *
 * **Do not deploy this function with platform JWT verification on.** `generate-all` and cron
 * actions use `x-cron-secret` only; platform JWT would reject them before this file runs.
 */
export async function assertUser(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)
  try {
    const { data, error } = await db.auth.getUser(token)
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401)
    return { userId: data.user.id }
  } catch {
    return json({ error: 'Unauthorized' }, 401)
  }
}
