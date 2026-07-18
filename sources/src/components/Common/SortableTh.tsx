/** 可點擊排序的表頭：顯示目前排序方向，點擊切換升冪/降冪；可另附欄位說明 */
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { HelpTip } from './HelpTip'

export interface SortState<K extends string> {
  key: K
  dir: 'asc' | 'desc'
}

/** 點擊表頭：同欄位切換方向，換欄位則以預設方向開始 */
export function nextSort<K extends string>(
  sort: SortState<K>,
  key: K,
  defaultDir: 'asc' | 'desc' = 'desc',
): SortState<K> {
  if (sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: defaultDir }
}

interface SortableThProps<K extends string> {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort: (key: K) => void
  numeric?: boolean
  /** 欄位說明；提供時表頭會多一個「?」圖示 */
  help?: string
}

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
  help,
}: SortableThProps<K>) {
  const active = sort.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  const btn = (
    <button type="button" className="th-sort-btn" onClick={() => onSort(sortKey)}>
      {label}
      <Icon size={12} className={active ? 'sort-ind active' : 'sort-ind'} />
    </button>
  )
  return (
    <th
      className={numeric ? 'num th-sort' : 'th-sort'}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {help ? (
        <div className="th-head">
          {btn}
          <HelpTip label={label} text={help} />
        </div>
      ) : (
        btn
      )}
    </th>
  )
}
