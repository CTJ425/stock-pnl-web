import { describe, it, expect } from 'vitest'
import { getGroupCategoryName, groupWatchItems } from './stockGrouping'

describe('stockGrouping utility', () => {
  describe('getGroupCategoryName', () => {
    it('簡短徽章名稱規範化為完整產業名稱', () => {
      expect(getGroupCategoryName('航運')).toBe('航運業')
      expect(getGroupCategoryName('半導體')).toBe('半導體業')
      expect(getGroupCategoryName('水泥')).toBe('水泥工業')
      expect(getGroupCategoryName('食品')).toBe('食品工業')
      expect(getGroupCategoryName('金融保險')).toBe('金融保險業')
    })

    it('官方已含「業」或「工業」之名稱保持原樣', () => {
      expect(getGroupCategoryName('航運業')).toBe('航運業')
      expect(getGroupCategoryName('半導體業')).toBe('半導體業')
      expect(getGroupCategoryName('水泥工業')).toBe('水泥工業')
    })

    it('ETF、ETN、特別股等資產類別保持原樣', () => {
      expect(getGroupCategoryName('債券 ETF')).toBe('債券 ETF')
      expect(getGroupCategoryName('股票型 ETF')).toBe('股票型 ETF')
      expect(getGroupCategoryName('槓桿 ETF')).toBe('槓桿 ETF')
      expect(getGroupCategoryName('反向 ETF')).toBe('反向 ETF')
      expect(getGroupCategoryName('特別股')).toBe('特別股')
    })
    it('電腦週邊、化學、建材營造、觀光餐旅各別名稱變體對齊為標準產業名稱', () => {
      expect(getGroupCategoryName('電腦週邊')).toBe('電腦及週邊設備業')
      expect(getGroupCategoryName('電腦週邊業')).toBe('電腦及週邊設備業')
      expect(getGroupCategoryName('電腦及週邊設備')).toBe('電腦及週邊設備業')
      expect(getGroupCategoryName('電腦及週邊設備業')).toBe('電腦及週邊設備業')

      expect(getGroupCategoryName('化學')).toBe('化學工業')
      expect(getGroupCategoryName('化學業')).toBe('化學工業')
      expect(getGroupCategoryName('化學工業')).toBe('化學工業')

      expect(getGroupCategoryName('建材營造')).toBe('建材營造')
      expect(getGroupCategoryName('建材營造業')).toBe('建材營造')

      expect(getGroupCategoryName('觀光餐旅')).toBe('觀光餐旅')
      expect(getGroupCategoryName('觀光餐旅業')).toBe('觀光餐旅')

      expect(getGroupCategoryName('其他')).toBe('其他')
      expect(getGroupCategoryName('其他類')).toBe('其他')
    })
  })

  describe('groupWatchItems', () => {
    it('空清單不觸發分組', () => {
      const res = groupWatchItems([])
      expect(res.hasGroups).toBe(false)
      expect(res.groups).toHaveLength(0)
      expect(res.clusteredGroupNames).toEqual([])
    })

    it('單一標的（count == 1）不觸發 >= 2 分組', () => {
      const items = [{ ticker: '2603', name: '長榮' }]
      const res = groupWatchItems(items)
      expect(res.hasGroups).toBe(false)
      expect(res.groups).toHaveLength(1)
      expect(res.groups[0].items).toEqual(items)
      expect(res.clusteredGroupNames).toEqual([])
    })

    it('多檔不同產業（各 1 檔）不觸發 >= 2 分組', () => {
      const items = [
        { ticker: '2603', name: '長榮' }, // 航運
        { ticker: '2330', name: '台積電' }, // 半導體
        { ticker: '1101', name: '台泥' }, // 水泥
      ]
      const res = groupWatchItems(items)
      expect(res.hasGroups).toBe(false)
      expect(res.groups).toHaveLength(1)
      expect(res.groups[0].items).toEqual(items)
      expect(res.clusteredGroupNames).toEqual([])
    })

    it('同產業 >= 2 檔時自動聚合為獨立產業群組', () => {
      const items = [
        { ticker: '2603', name: '長榮' },
        { ticker: '2609', name: '陽明' },
      ]
      const res = groupWatchItems(items)
      expect(res.hasGroups).toBe(true)
      expect(res.clusteredGroupNames).toEqual(['航運業'])
      expect(res.groups).toHaveLength(1)
      expect(res.groups[0].name).toBe('航運業')
      expect(res.groups[0].items).toEqual(items)
      expect(res.otherCount).toBe(0)
    })

    it('同產業 >= 2 檔加上其他單一標的，形成聚合群組與「其他」群組', () => {
      const items = [
        { ticker: '2603', name: '長榮' },
        { ticker: '2330', name: '台積電' },
        { ticker: '2609', name: '陽明' },
        { ticker: '1101', name: '台泥' },
      ]
      const res = groupWatchItems(items)
      expect(res.hasGroups).toBe(true)
      expect(res.clusteredGroupNames).toEqual(['航運業'])
      expect(res.groups).toHaveLength(2)

      const shipping = res.groups.find((g) => g.key === '航運業')
      expect(shipping?.items.map((i) => i.ticker)).toEqual(['2603', '2609'])

      const other = res.groups.find((g) => g.key === '__other__')
      expect(other?.items.map((i) => i.ticker)).toEqual(['2330', '1101'])
      expect(res.otherCount).toBe(2)
    })

    it('電腦週邊靜態分類與報價電腦及週邊設備業成功對齊聚合', () => {
      const items = [
        { ticker: '2382', name: '廣達' }, // 靜態字典 電腦週邊
        { ticker: '2356', name: '英業達' }, // 靜態字典 電腦週邊
      ]
      // 2382 帶有即時報價的官方名稱
      const res = groupWatchItems(items, (item) => (item.ticker === '2382' ? '電腦及週邊設備業' : undefined))
      expect(res.hasGroups).toBe(true)
      expect(res.clusteredGroupNames).toEqual(['電腦及週邊設備業'])
      expect(res.groups[0].items).toHaveLength(2)
    })

    it('屬於官方「其他」類別之個股不形成「其他業 (2)」獨立族群，自然歸入其他', () => {
      const items = [
        { ticker: '9904', name: '寶成' }, // 其他
        { ticker: '9910', name: '豐泰' }, // 其他
        { ticker: '2603', name: '長榮' },
        { ticker: '2609', name: '陽明' },
      ]
      const res = groupWatchItems(items)
      expect(res.hasGroups).toBe(true)
      expect(res.clusteredGroupNames).toEqual(['航運業'])
      expect(res.clusteredGroupNames).not.toContain('其他')
      expect(res.clusteredGroupNames).not.toContain('其他業')

      const otherGroup = res.groups.find((g) => g.key === '__other__')
      expect(otherGroup?.items.map((i) => i.ticker)).toEqual(['9904', '9910'])
      expect(res.otherCount).toBe(2)
    })

    it('支援傳入 getIndustry 讀取即時報價產業別', () => {
      const items = [
        { ticker: '2330', name: '台積電' },
        { ticker: '2454', name: '聯發科' },
      ]
      const industries: Record<string, string> = {
        '2330': '半導體業',
        '2454': '半導體業',
      }
      const res = groupWatchItems(items, (item) => industries[item.ticker])
      expect(res.hasGroups).toBe(true)
      expect(res.clusteredGroupNames).toEqual(['半導體業'])
      expect(res.groups[0].items).toEqual(items)
    })

    it('覆蓋上限 30 檔混合多元資產標的（ETF、特別股、多產業、單一標的）邊界情境', () => {
      const mixed30 = [
        // 股票型 ETF (3)
        { ticker: '0050', name: '元大台灣50' },
        { ticker: '0056', name: '元大高股息' },
        { ticker: '00878', name: '國泰永續高股息' },
        // 債券 ETF (2)
        { ticker: '00679B', name: '元大美債20年' },
        { ticker: '00687B', name: '國泰20年美債' },
        // 槓桿 ETF (2)
        { ticker: '00631L', name: '元大台灣50正2' },
        { ticker: '00675L', name: '富邦臺灣加權正2' },
        // 特別股 (2)
        { ticker: '2881A', name: '富邦金甲特' },
        { ticker: '2882A', name: '國泰金甲特' },
        // 半導體業 (3)
        { ticker: '2330', name: '台積電' },
        { ticker: '2454', name: '聯發科' },
        { ticker: '3034', name: '聯詠' },
        // 航運業 (2)
        { ticker: '2603', name: '長榮' },
        { ticker: '2609', name: '陽明' },
        // 電腦及週邊設備業 (2)
        { ticker: '2382', name: '廣達' },
        { ticker: '2356', name: '英業達' },
        // 金融保險業 (2)
        { ticker: '2881', name: '富邦金' },
        { ticker: '2882', name: '國泰金' },
        // 水泥 (1)
        { ticker: '1101', name: '台泥' },
        // 塑膠 (1)
        { ticker: '1301', name: '台塑' },
        // 鋼鐵 (1)
        { ticker: '2002', name: '中鋼' },
        // 橡膠 (1)
        { ticker: '2105', name: '正新' },
        // 汽車 (1)
        { ticker: '2201', name: '裕隆' },
        // 建材 (1)
        { ticker: '2501', name: '國建' },
        // 觀光 (1)
        { ticker: '2701', name: '萬華' },
        // 通信 (1)
        { ticker: '2412', name: '中華電' },
        // 光電 (1)
        { ticker: '2409', name: '友達' },
        // 食品 (1)
        { ticker: '1216', name: '統一' },
        // 其他 (1)
        { ticker: '9904', name: '寶成' },
        // 無分類未知標的 (1)
        { ticker: '99999', name: '未知個股' },
      ]
      expect(mixed30).toHaveLength(30)

      const res = groupWatchItems(mixed30)
      expect(res.hasGroups).toBe(true)
      expect(res.clusteredGroupNames).toEqual([
        '股票型 ETF',
        '債券 ETF',
        '槓桿 ETF',
        '特別股',
        '半導體業',
        '航運業',
        '電腦及週邊設備業',
        '金融保險業',
      ])

      // 總計 clustered: 3 + 2 + 2 + 2 + 3 + 2 + 2 + 2 = 18 檔
      // other: 12 檔
      expect(res.otherCount).toBe(12)
      const other = res.groups.find((g) => g.key === '__other__')
      expect(other?.items).toHaveLength(12)
      expect(other?.items.map((i) => i.ticker)).toContain('99999')
      expect(other?.items.map((i) => i.ticker)).toContain('1101')
      expect(other?.items.map((i) => i.ticker)).toContain('9904')
    })
  })
})
