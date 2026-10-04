/**
 * One line in 台股市場 pointing at the 資金流向 page, which used to be a card here. A plain anchor:
 * the hash change is the navigation (AppShell reads it), and it works with a middle click too.
 */
export function SectorFlowLink() {
  return (
    <div className="section glass sf-link">
      <div>
        <h3 className="head-tight">類股資金流向</h3>
        <p className="hint">看外資、投信、自營商今天買賣了哪些產業；半導體再細分到 IC 設計。</p>
      </div>
      <a className="btn btn-sm" href="#/sector-flow">
        前往資金流向
      </a>
    </div>
  )
}
