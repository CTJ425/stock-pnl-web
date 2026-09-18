/**
 * A one-off layout probe (spec discord-holdings.md "Revision 7"): the same two cards written in
 * Discord markdown instead of a monospace fence, so the user can see on their own phone whether
 * headings and subtext render. Content is fixed sample text, not a renderer — nothing about the
 * live cards changes. Numbers are the real 09/18 DEV cards, hand-copied.
 */
import type { DiscordPayload } from './discordWebhook.ts'

const FOOTER = '這是排版測試訊息，不是今天的正式推播'

const BRIEF_DESCRIPTION = `### 台股大盤
**45,848.90** 🔴 +337.41（+0.74%）｜成交 6,759.7 億｜三大法人 -213.8 億

### 國際指數
日經225 63,923 ▲0.69%｜S&P 500 7,552 ▼0.45%
-# KOSPI・KOSDAQ・道瓊・那斯達克・費半・羅素2000 暫無資料

### 美國總經
核心CPI **2.45%** ← 2.47%・08月
核心PPI **4.62%** ← 4.26%・08月
聯邦利率 3.5-3.75% 持平
非農就業 **162** 千人 ← 21 千人・08月`

const HOLDINGS_DESCRIPTION = `### 未實現 **+1,519,625**（+90.21%）
市值 3,614,030｜成本 1,684,469｜今日 **+47,260**（+1.34%）
-# 今日已實現 0｜今年已實現 +297,109｜空單市值 1,018,500

### 2330 台積電 ▲1.44%
現價 2,460｜市值 2,460,000｜未實現 **+1,949,879**（+389.62%）
-# 成本 500,463｜均價 500.46｜保本 502.69

### 0050 元大台灣50 ▲2.76%
現價 109.85｜市值 659,100｜未實現 **+31,718**（+5.07%）
-# 成本 625,788｜均價 104.3｜保本 104.56｜已實現 +7,345

### 空 8033 雷虎 ▲2.68%
現價 172.5｜市值 862,500｜未實現 **-366,341**（-73.65%）
-# 價金 497,388｜均價 99.48`

export function buildMarkdownSamplePayload(generatedAt: string): DiscordPayload {
  return {
    username: '版面測試',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: '【版面測試】經濟快報 Markdown 版',
        description: BRIEF_DESCRIPTION,
        footer: { text: FOOTER },
        timestamp: generatedAt,
      },
      {
        title: '【版面測試】持股日報 Markdown 版',
        description: HOLDINGS_DESCRIPTION,
        footer: { text: FOOTER },
        timestamp: generatedAt,
      },
    ],
  }
}
