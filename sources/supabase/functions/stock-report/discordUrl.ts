/**
 * Discord webhook URL checks (Task 165). Imported by the Edge Function **and** the browser
 * (`src/components/Admin/DiscordSection.tsx`), so this file must stay dependency-free.
 *
 * A webhook URL is a credential: anyone holding it can post into the channel. Callers must
 * never log, return, or render the full value — `webhookLast4` is the only safe projection.
 */

const WEBHOOK_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d{17,20}\/([A-Za-z0-9_-]{20,100})$/

/** True only for `https://discord.com|discordapp.com/api/webhooks/<id>/<token>` (after trim). */
export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_RE.test(url.trim())
}

/** The last 4 characters of the token of a valid webhook URL; `''` for anything else. */
export function webhookLast4(url: string): string {
  const m = WEBHOOK_RE.exec(url.trim())
  return m ? m[1].slice(-4) : ''
}
