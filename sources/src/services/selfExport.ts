/**
 * Self-service export (task 144-4): the same three tables the nightly `backup-transactions`
 * job writes, read through the signed-in client so RLS limits every row to the caller.
 *
 * Never touches the service role key — that key only lives in `scripts/backup-download.cjs`,
 * which never runs in a browser.
 */
import { supabase } from './supabase'

export interface SelfExport {
  exportedAt: string
  workspaces: unknown[]
  transactions: unknown[]
  user_settings: unknown[]
}

const PAGE_SIZE = 1000

type Rows = unknown[] | { error: string }

function isError(rows: Rows): rows is { error: string } {
  return !Array.isArray(rows)
}

async function selectAll(table: 'workspaces' | 'user_settings'): Promise<Rows> {
  const { data, error } = await supabase!.from(table).select('*')
  if (error) return { error: (error as { message: string }).message }
  return (data as unknown[]) ?? []
}

// PostgREST caps a single response at 1000 rows and reports no error when it truncates, so an
// unpaged select silently loses rows past the cap.
async function selectTransactions(): Promise<Rows> {
  const rows: unknown[] = []
  let from = 0
  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase!
      .from('transactions')
      .select('*')
      .order('id', { ascending: true })
      .range(from, to)
    if (error) return { error: (error as { message: string }).message }
    const page = (data as unknown[]) ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

/** Reads through the signed-in client, so RLS limits every row to the caller. */
export async function buildSelfExport(): Promise<SelfExport | { error: string }> {
  if (!supabase) return { error: 'Supabase 未設定' }

  try {
    const workspaces = await selectAll('workspaces')
    if (isError(workspaces)) return workspaces

    const transactions = await selectTransactions()
    if (isError(transactions)) return transactions

    const userSettings = await selectAll('user_settings')
    if (isError(userSettings)) return userSettings

    return {
      exportedAt: new Date().toISOString(),
      workspaces,
      transactions,
      user_settings: userSettings,
    }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '匯出失敗' }
  }
}
