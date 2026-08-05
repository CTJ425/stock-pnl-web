import { HelpTip } from './HelpTip'

/** Unsortable table header with field descriptions*/
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
