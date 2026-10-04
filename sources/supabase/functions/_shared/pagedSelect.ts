/**
 * PostgREST caps a single response at `max_rows` (1000, see `supabase/config.toml`). A select that
 * can plausibly return more rows than that needs explicit paging, or rows past the cap are silently
 * dropped (AUDIT-2026-09-04 #3: this under-counted `existingKeys` for accounts past 1000
 * `transactions`, so the backup-restore preview reported existing rows as missing).
 *
 * `build` must return a fresh, fully-specified query (including any `.order()`) for the given
 * `[from, to]` range — a supabase-js query builder cannot be re-awaited after use, so each page
 * needs its own builder call.
 */
export async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return { data: rows, error: null }
}
