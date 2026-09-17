/**
 * Discord webhook sender (Task 165). Never throws, never leaks the URL — see spec §2.2.
 */
import { isDiscordWebhookUrl } from './discordUrl.ts'

export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: { text: string }
  timestamp?: string
}

export interface DiscordPayload {
  username?: string
  content?: string
  embeds: DiscordEmbed[]
  allowed_mentions: { parse: never[] }
}

export type DiscordFailReason = 'invalid-url' | 'webhook-gone' | 'rate-limited' | 'http-error' | 'network'

export type DiscordSendResult =
  | { ok: true; httpStatus: number }
  | { ok: false; httpStatus: number | null; reason: DiscordFailReason }

export interface PostDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/** Upper bound for one 429 back-off, so a hostile `retry_after` cannot eat the Edge wall budget. */
export const MAX_RETRY_AFTER_MS = 10_000

/** Parses a 429 response into a wait duration in ms, capped at `MAX_RETRY_AFTER_MS`. */
async function retryAfterMs(res: Response): Promise<number> {
  let sec: number | null = null
  try {
    const body = await res.clone().json()
    if (body && typeof body === 'object' && typeof (body as { retry_after?: unknown }).retry_after === 'number') {
      sec = (body as { retry_after: number }).retry_after
    }
  } catch {
    // body is not JSON — fall through to the header
  }
  if (sec === null) {
    const header = res.headers.get('Retry-After')
    const parsed = header === null ? NaN : Number(header)
    sec = Number.isFinite(parsed) ? parsed : 1
  }
  return Math.min(Math.ceil(sec * 1000), MAX_RETRY_AFTER_MS)
}

function classify(res: Response): DiscordSendResult {
  if (res.ok) return { ok: true, httpStatus: res.status }
  if (res.status === 401 || res.status === 404) return { ok: false, httpStatus: res.status, reason: 'webhook-gone' }
  return { ok: false, httpStatus: res.status, reason: 'http-error' }
}

export async function postDiscordWebhook(
  url: string,
  payload: DiscordPayload,
  deps: PostDeps = {},
): Promise<DiscordSendResult> {
  const trimmed = url.trim()
  if (!isDiscordWebhookUrl(trimmed)) return { ok: false, httpStatus: null, reason: 'invalid-url' }

  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  let res: Response
  try {
    res = await fetchImpl(`${trimmed}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { ok: false, httpStatus: null, reason: 'network' }
  }

  if (res.status === 429) {
    const ms = await retryAfterMs(res)
    await sleep(ms)
    let retryRes: Response
    try {
      retryRes = await fetchImpl(`${trimmed}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      return { ok: false, httpStatus: null, reason: 'network' }
    }
    if (retryRes.status === 429) return { ok: false, httpStatus: 429, reason: 'rate-limited' }
    return classify(retryRes)
  }

  return classify(res)
}
