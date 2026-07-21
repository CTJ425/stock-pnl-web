import { HelpTip } from './HelpTip'

/** 不可排序但附欄位說明的表頭 */
export function HelpTh({ label, help, numeric }: { label: string; help: string; numeric?: boolean }) {
  return (
    <th className={numeric ? 'num th-sort' : 'th-sort'}>
      <div className="th-head">
        <span className="th-plain">{label}</span>
        <HelpTip label={label} text={help} />
      </div>
    </th>
  )
}
