export interface SortState<K extends string> {
  key: K
  dir: 'asc' | 'desc'
}

/** Click on the header: switch directions in the same field, and start with the default direction when changing fields.*/
export function nextSort<K extends string>(
  sort: SortState<K>,
  key: K,
  defaultDir: 'asc' | 'desc' = 'desc',
): SortState<K> {
  if (sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: defaultDir }
}
