/** Clickable sorting header: displays the current sorting direction, click to switch ascending/descending power; additional field descriptions can be attached*/
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { AppIcon } from './AppIcon'
import { HelpTip } from './HelpTip'

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

interface SortableThProps<K extends string> {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort: (key: K) => void
  numeric?: boolean
  /** Field description; when provided, there will be an additional "?" icon in the header*/
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
      <AppIcon icon={Icon} size="xs" className={active ? 'sort-ind active' : 'sort-ind'} />
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
