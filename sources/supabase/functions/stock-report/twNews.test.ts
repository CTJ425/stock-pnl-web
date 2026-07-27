import { describe, it, expect } from 'vitest'
import { decodeXmlEntities, googleNewsRssUrl, parseGoogleNewsRss } from './twNews.ts'

/**
 * fixture 仿 2026-07-27 對 news.google.com/rss 的實際回應結構：
 * 單行 XML、title 為「標題 - 來源」純文字＋entity、pubDate RFC 822、
 * source 帶 url 屬性。另補 CDATA 形態（Google 端格式可能變動，兩種都要解）。
 */
const NOW = new Date('2026-07-27T04:00:00Z')

function item(title: string, pubDate: string | null, source: string | null): string {
  return (
    '<item>' +
    `<title>${title}</title>` +
    '<link>https://news.google.com/rss/articles/x?oc=5</link>' +
    (pubDate ? `<pubDate>${pubDate}</pubDate>` : '') +
    (source ? `<source url="https://example.com">${source}</source>` : '') +
    '</item>'
  )
}

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"台積電" - Google 新聞</title>${item(
  '台積電先進製程需求強勁 - 自由財經',
  'Mon, 27 Jul 2026 02:08:08 GMT',
  '自由財經',
)}${item(
  '外資調節台積電 &amp; 聯電持股',
  'Sun, 26 Jul 2026 10:00:00 GMT',
  '經濟日報',
)}</channel></rss>`

describe('twNews', () => {
  it('googleNewsRssUrl 對股票名稱做 URL 編碼並帶台灣繁中參數', () => {
    const url = googleNewsRssUrl('台積電')
    expect(url).toContain('q=%E5%8F%B0%E7%A9%8D%E9%9B%BB')
    expect(url).toContain('hl=zh-TW')
    expect(url).toContain('ceid=TW:zh-Hant')
  })

  it('解析標題、來源與發布時間（entity 需還原）', () => {
    const items = parseGoogleNewsRss(RSS, { now: NOW })
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      title: '台積電先進製程需求強勁 - 自由財經',
      source: '自由財經',
      publishedAt: '2026-07-27T02:08:08.000Z',
    })
    expect(items[1].title).toBe('外資調節台積電 & 聯電持股')
  })

  it('CDATA 形態的標題也要能解', () => {
    const xml = `<rss><channel>${item('<![CDATA[法說會前夕 <台積電> 觀望]]>', 'Mon, 27 Jul 2026 01:00:00 GMT', null)}</channel></rss>`
    const items = parseGoogleNewsRss(xml, { now: NOW })
    expect(items[0].title).toBe('法說會前夕 <台積電> 觀望')
    expect(items[0].source).toBeNull()
  })

  it('壞的 pubDate 得到 null 時間並排在最後，缺 title 的項目整筆丟棄', () => {
    const xml = `<rss><channel>${item('有時間', 'Mon, 27 Jul 2026 01:00:00 GMT', null)}${item('沒時間', 'not-a-date', null)}<item><pubDate>Mon, 27 Jul 2026 01:00:00 GMT</pubDate></item></channel></rss>`
    const items = parseGoogleNewsRss(xml, { now: NOW })
    expect(items.map((i) => i.title)).toEqual(['有時間', '沒時間'])
    expect(items[1].publishedAt).toBeNull()
  })

  it('超過 sinceDays 的舊聞丟棄、maxItems 截斷由新到舊', () => {
    const xml = `<rss><channel>${item('太舊', 'Wed, 01 Jul 2026 01:00:00 GMT', null)}${item(
      '較舊',
      'Sat, 25 Jul 2026 01:00:00 GMT',
      null,
    )}${item('最新', 'Mon, 27 Jul 2026 01:00:00 GMT', null)}</channel></rss>`
    const all = parseGoogleNewsRss(xml, { now: NOW, sinceDays: 14 })
    expect(all.map((i) => i.title)).toEqual(['最新', '較舊'])
    const capped = parseGoogleNewsRss(xml, { now: NOW, sinceDays: 14, maxItems: 1 })
    expect(capped.map((i) => i.title)).toEqual(['最新'])
  })

  it('非 XML 或空輸入回空陣列而不 throw', () => {
    expect(parseGoogleNewsRss('not xml at all', { now: NOW })).toEqual([])
    expect(parseGoogleNewsRss('', { now: NOW })).toEqual([])
  })

  it('decodeXmlEntities 處理具名與數字型 entity', () => {
    expect(decodeXmlEntities('A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; &#x4E2D;')).toBe(
      'A & B <C> "D" \'E\' 中',
    )
  })
})
