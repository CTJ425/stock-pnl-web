/**
 * 基本面分頁：估值指標（本益比 / 殖利率 / 股價淨值比 / 反推年化 EPS）與財報單季 EPS。
 *
 * 為什麼獨立一個分頁而不併進籌碼：EPS 是公司每季的獲利，籌碼是每日的交易流量，
 * 兩者性質與更新頻率都不同，混在一起會讓「盤後籌碼」報告與其 PDF 失焦、資料日期語意混亂。
 *
 * 三種空狀態必須分開講，不能都寫「查無」：
 * ETF（本質上沒有 EPS）、上櫃（官方端點只收上市）、尚未累積到（歷史靠每季公布累積）。
 */
import { Inbox, Layers } from 'lucide-react'
import type { Fundamentals } from '../../services/reportProxy'
import { BarSeriesChart } from '../Charts/BarSeriesChart'
import {
  fmtMultiple,
  fmtPerShare,
  fmtPercentValue,
  fmtQuarterLabel,
  fmtQuarterShort,
  fmtThousandsAsBillions,
} from './fundamentalFormat'
import { chipClass } from './chipFormat'

interface FundamentalsTabProps {
  fundamentals: Fundamentals | null | undefined
  ticker: string
}

export function FundamentalsTab({ fundamentals, ticker }: FundamentalsTabProps) {
  // schema 2 的舊報告沒有這個欄位；重新產生後就會有
  if (fundamentals === undefined) {
    return (
      <section className="rpt-section">
        <h3>基本面</h3>
        <div className="empty-state">
          <div className="empty-icon">
            <Inbox size={32} />
          </div>
          <div>這份報告是舊格式，還沒有基本面資料。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            下一次盤後更新後就會出現。
          </div>
        </div>
      </section>
    )
  }

  if (fundamentals === null) {
    return (
      <section className="rpt-section">
        <h3>基本面</h3>
        <div className="empty-state">
          <div className="empty-icon">
            <Inbox size={32} />
          </div>
          <div>查無 {ticker} 的基本面資料。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            官方財報與本益比資料只涵蓋上市公司。上櫃、興櫃與美股目前不支援。
          </div>
        </div>
      </section>
    )
  }

  const { valuation, quarters, isEtf } = fundamentals
  const latest = quarters[quarters.length - 1] ?? null

  return (
    <>
      <section className="rpt-section">
        <h3>估值指標</h3>
        {valuation === null ? (
          <p className="hint">
            {isEtf
              ? // ETF 不是「查無」本益比，而是本質上不適用；證交所的估值檔也不收 ETF
                'ETF 沒有本益比（它沒有自己的獲利）。它的配息與淨值請看發行商公告。'
              : '查無此股的本益比等估值資料。'}
          </p>
        ) : (
          <>
            <div className="rpt-cards">
              <div className="rpt-card">
                <div className="k">本益比</div>
                <div className="v">{fmtMultiple(valuation.peRatio)}</div>
              </div>
              <div className="rpt-card">
                <div className="k">殖利率</div>
                <div className="v">{fmtPercentValue(valuation.dividendYield)}</div>
              </div>
              <div className="rpt-card">
                <div className="k">股價淨值比</div>
                <div className="v">{fmtMultiple(valuation.pbRatio)}</div>
              </div>
              <div className="rpt-card">
                <div className="k">年化 EPS（推算）</div>
                <div className="v">{fmtPerShare(valuation.ttmEps)}</div>
              </div>
            </div>
            <p className="hint">
              本益比是「股價是每年賺的幾倍」，數字越低代表買得越便宜（但也可能是市場不看好）。
              殖利率是「照去年配息，現在買一年可以領回幾 %」。股價淨值比是「股價相對公司帳上淨資產的倍數」。
              年化 EPS 是用股價÷本益比反推的，不是財報原始數字，本益比很高時這個推算會不準。
              {valuation.date && `資料日期 ${valuation.date}（每日更新）。`}
            </p>
          </>
        )}
      </section>

      <section className="rpt-section">
        <h3>每股盈餘（EPS）</h3>
        {isEtf ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Layers size={32} />
            </div>
            <div>{ticker} 是 ETF，沒有 EPS。</div>
            <div className="hint" style={{ marginTop: 6 }}>
              EPS 是「一家公司賺的錢分到每一股」。ETF 本身不做生意、不會賺錢，
              它的價值來自它持有的那一籃子股票，所以沒有自己的 EPS 或本益比。
            </div>
          </div>
        ) : quarters.length === 0 ? (
          <p className="hint">查無此股的財報資料。官方財報只涵蓋上市公司。</p>
        ) : (
          <>
            <div className="rpt-cards">
              <div className="rpt-card">
                <div className="k">最新一季（{latest && fmtQuarterLabel(latest.year, latest.quarter)}）</div>
                <div className={`v ${chipClass(latest?.eps)}`}>{fmtPerShare(latest?.eps)}</div>
              </div>
              <div className="rpt-card">
                <div className="k">當季營收</div>
                <div className="v">{fmtThousandsAsBillions(latest?.revenue)}</div>
              </div>
              <div className="rpt-card">
                <div className="k">當季淨利</div>
                <div className={`v ${chipClass(latest?.netIncome)}`}>
                  {fmtThousandsAsBillions(latest?.netIncome)}
                </div>
              </div>
            </div>

            {quarters.length >= 2 ? (
              <>
                <div className="chart-title" style={{ marginTop: 16 }}>
                  單季 EPS 走勢（元）
                </div>
                <BarSeriesChart
                  labels={quarters.map((q) => fmtQuarterShort(q.year, q.quarter))}
                  series={[{ name: '單季 EPS', values: quarters.map((q) => q.eps) }]}
                  formatValue={(v) => fmtPerShare(v)}
                  ariaLabel={`${ticker} 近 ${quarters.length} 季每股盈餘長條圖`}
                />
              </>
            ) : (
              <p className="hint">
                目前只有一季的財報。官方端點不提供歷史季別，之後每季公布時會自動累積，
                累積到兩季以上就會出現走勢圖。
              </p>
            )}

            <div className="table-scroll" style={{ marginTop: 14 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>季別</th>
                    <th className="num">EPS（元）</th>
                    <th className="num">營收（億元）</th>
                    <th className="num">淨利（億元）</th>
                  </tr>
                </thead>
                <tbody>
                  {[...quarters].reverse().map((q) => (
                    <tr key={`${q.year}Q${q.quarter}`}>
                      <td>{fmtQuarterLabel(q.year, q.quarter)}</td>
                      <td className={`num ${chipClass(q.eps)}`}>{fmtPerShare(q.eps)}</td>
                      <td className="num">{fmtThousandsAsBillions(q.revenue)}</td>
                      <td className={`num ${chipClass(q.netIncome)}`}>
                        {fmtThousandsAsBillions(q.netIncome)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              EPS 是公司當季賺的錢分到每一股，單位是元。營收與淨利的官方單位是千元，
              這裡換成億元顯示。淨利是「歸屬母公司業主」的部分。這些是每季公布一次的數字，
              和「籌碼」分頁每日更新的法人買賣完全無關。
            </p>
          </>
        )}
      </section>

      <p className="rpt-disclaimer">
        數據來源：臺灣證券交易所（TWSE）官方揭露。財報每季公布、估值指標每日更新，兩者日期不同。
        本頁只彙整公開數據供參考，不是投資建議；實際請以官方揭露與公司財報為準。
      </p>
    </>
  )
}
