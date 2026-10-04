/**
 * The words for a failed Discord webhook send, shared by the admin console (`DiscordSection`) and the
 * per-account settings (`DiscordMySettings`). They kept two identical copies of the map and of the
 * sentence built from it, and a reason added to one would have read 「未知錯誤」 in the other (Task 193).
 */
export const DISCORD_FAIL_REASON_LABELS: Record<string, string> = {
  'webhook-gone': '網址已失效',
  'rate-limited': 'Discord 限流',
  'http-error': 'Discord 回應錯誤',
  network: '連線失敗',
  'invalid-url': '網址格式不正確',
}

/** 「測試訊息已送出」 or 「發送失敗（原因）」 for one send result. */
export function discordSendResultText(result: { ok: boolean; reason?: string | null }): string {
  if (result.ok) return '測試訊息已送出'
  const reason = DISCORD_FAIL_REASON_LABELS[result.reason ?? ''] ?? '未知錯誤'
  return `發送失敗（${reason}）`
}
