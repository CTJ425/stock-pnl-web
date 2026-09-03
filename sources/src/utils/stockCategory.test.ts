import { describe, expect, it } from 'vitest'
import { getStockCategory } from './stockCategory'

describe('stockCategory', () => {
  describe('Rule-based ETF / ETN / TDR / REITs / Preferred shares', () => {
    it('identifies bond ETFs (00...B)', () => {
      expect(getStockCategory('00679B')).toBe('債券 ETF')
      expect(getStockCategory('00687B')).toBe('債券 ETF')
      expect(getStockCategory('00720b')).toBe('債券 ETF')
      expect(getStockCategory('00937B')).toBe('債券 ETF')
    })

    it('identifies leveraged ETFs (00...L)', () => {
      expect(getStockCategory('00631L')).toBe('槓桿 ETF')
      expect(getStockCategory('00675L')).toBe('槓桿 ETF')
      expect(getStockCategory('00715l')).toBe('槓桿 ETF')
    })

    it('identifies inverse ETFs (00...R)', () => {
      expect(getStockCategory('00632R')).toBe('反向 ETF')
      expect(getStockCategory('00671R')).toBe('反向 ETF')
      expect(getStockCategory('00676r')).toBe('反向 ETF')
    })

    it('identifies equity ETFs (00...)', () => {
      expect(getStockCategory('0050')).toBe('股票型 ETF')
      expect(getStockCategory('0056')).toBe('股票型 ETF')
      expect(getStockCategory('00878')).toBe('股票型 ETF')
      expect(getStockCategory('00919')).toBe('股票型 ETF')
      expect(getStockCategory('00929')).toBe('股票型 ETF')
      expect(getStockCategory('006208')).toBe('股票型 ETF')
    })

    it('identifies ETN (02...)', () => {
      expect(getStockCategory('020000')).toBe('ETN')
      expect(getStockCategory('020001')).toBe('ETN')
    })

    it('identifies TDR (91...)', () => {
      expect(getStockCategory('9105')).toBe('TDR')
      expect(getStockCategory('9103')).toBe('TDR')
    })

    it('identifies REITs (01...)', () => {
      expect(getStockCategory('01001T')).toBe('REITs')
      expect(getStockCategory('01002T')).toBe('REITs')
    })

    it('identifies preferred shares (e.g. 2881A) and distinguishes them from warrants', () => {
      expect(getStockCategory('2881A')).toBe('特別股')
      expect(getStockCategory('2882a')).toBe('特別股')
      expect(getStockCategory('2887E')).toBe('特別股')
      expect(getStockCategory('2891C')).toBe('特別股')
      expect(getStockCategory('2002A')).toBe('特別股')
      // Warrants (5+ digits with letter) should NOT be classified as preferred shares
      expect(getStockCategory('03001P')).toBeNull()
      expect(getStockCategory('08321B')).toBeNull()
      expect(getStockCategory('70001P')).toBeNull()
    })
  })

  describe('Common stock industry mapping', () => {
    it('maps semiconductor stocks including TPEx leaders', () => {
      expect(getStockCategory('2330')).toBe('半導體')
      expect(getStockCategory('2454')).toBe('半導體')
      expect(getStockCategory('2303')).toBe('半導體')
      expect(getStockCategory('3711')).toBe('半導體')
      expect(getStockCategory('5483')).toBe('半導體') // 中美晶
      expect(getStockCategory('3105')).toBe('半導體') // 穩懋
      expect(getStockCategory('3680')).toBe('半導體') // 家登
      expect(getStockCategory('6187')).toBe('半導體') // 萬潤
      expect(getStockCategory('6515')).toBe('半導體') // 穎崴
    })

    it('maps TPEx cultural creative and living sector stocks', () => {
      expect(getStockCategory('3293')).toBe('文化創意') // 鈊象
      expect(getStockCategory('5478')).toBe('文化創意') // 智冠
      expect(getStockCategory('6180')).toBe('文化創意') // 橘子
      expect(getStockCategory('8464')).toBe('居家生活') // 億豐
      expect(getStockCategory('9911')).toBe('居家生活') // 櫻花
    })

    it('maps CPO and electronics channel leaders', () => {
      expect(getStockCategory('3363')).toBe('通信網路') // 上詮
      expect(getStockCategory('5434')).toBe('電子通路') // 崇越
      expect(getStockCategory('6139')).toBe('其他電子') // 亞翔
      expect(getStockCategory('6691')).toBe('其他電子') // 洋基工程
    })

    it('maps shipping stocks including 2208 台船 (BUG-046 fix)', () => {
      expect(getStockCategory('2603')).toBe('航運')
      expect(getStockCategory('2609')).toBe('航運')
      expect(getStockCategory('2615')).toBe('航運')
      expect(getStockCategory('2618')).toBe('航運')
      expect(getStockCategory('2208')).toBe('航運業') // 台船
    })

    it('maps tourism stocks including 5701 劍湖山 (BUG-046 fix)', () => {
      expect(getStockCategory('2701')).toBe('觀光餐旅')
      expect(getStockCategory('5701')).toBe('觀光餐旅') // 劍湖山
    })

    it('maps finance / insurance stocks', () => {
      expect(getStockCategory('2881')).toBe('金融保險')
      expect(getStockCategory('2882')).toBe('金融保險')
      expect(getStockCategory('2891')).toBe('金融保險')
      expect(getStockCategory('2886')).toBe('金融保險')
    })

    it('maps other key sectors', () => {
      expect(getStockCategory('2317')).toBe('其他電子')
      expect(getStockCategory('2382')).toBe('電腦週邊')
      expect(getStockCategory('2308')).toBe('電子零組件')
      expect(getStockCategory('2327')).toBe('電子零組件')
      expect(getStockCategory('3008')).toBe('光電')
      expect(getStockCategory('2412')).toBe('通信網路')
      expect(getStockCategory('2002')).toBe('鋼鐵')
      expect(getStockCategory('1101')).toBe('水泥')
      expect(getStockCategory('1216')).toBe('食品')
      expect(getStockCategory('1301')).toBe('塑膠')
    })
  })

  describe('Name-based heuristic fallback', () => {
    it('identifies industry from name when ticker is not in dictionary', () => {
      expect(getStockCategory('9999', '某某金控')).toBe('金融保險')
      expect(getStockCategory('9998', '某某鋼鐵')).toBe('鋼鐵')
      expect(getStockCategory('9997', '某某海運')).toBe('航運')
      expect(getStockCategory('9996', '某某水泥')).toBe('水泥')
      expect(getStockCategory('9995', '某某生技')).toBe('生技醫療')
      expect(getStockCategory('9994', '某某建設')).toBe('建材營造')
      expect(getStockCategory('9993', '某某遊戲')).toBe('文化創意')
      expect(getStockCategory('9992', '某某綠能')).toBe('綠能環保')
      expect(getStockCategory('9991', '某某軟體')).toBe('資訊服務')
      expect(getStockCategory('9990', '某某醫材')).toBe('生技醫療')
    })
  })

  describe('Industry argument priority from live quote', () => {
    it('prioritizes live quote industry over dictionary / rule-based', () => {
      expect(getStockCategory('2330', '台積電', '半導體業')).toBe('半導體業')
      expect(getStockCategory('2208', '台船', '航運業')).toBe('航運業')
      expect(getStockCategory('5701', '劍湖山', '觀光餐旅')).toBe('觀光餐旅')
      expect(getStockCategory('9999', '未知股', '綠能環保')).toBe('綠能環保')
    })

    it('falls back to rules/dictionary when industry is null, undefined, or empty', () => {
      expect(getStockCategory('0050', '元大台灣50', null)).toBe('股票型 ETF')
      expect(getStockCategory('00679B', '元大美債20年', undefined)).toBe('債券 ETF')
      expect(getStockCategory('2208', '台船', '')).toBe('航運業')
      expect(getStockCategory('5701', '劍湖山', null)).toBe('觀光餐旅')
    })

    it('ignores placeholder industry values like "-" or "--"', () => {
      expect(getStockCategory('2330', '台積電', '-')).toBe('半導體')
      expect(getStockCategory('2330', '台積電', '--')).toBe('半導體')
    })

    it('trims whitespace around industry', () => {
      expect(getStockCategory('2330', '台積電', '  半導體業  ')).toBe('半導體業')
    })

    it('returns null if ticker is empty even if industry is provided', () => {
      expect(getStockCategory('', '台積電', '半導體業')).toBeNull()
      expect(getStockCategory('   ', '台積電', '半導體業')).toBeNull()
    })
  })

  describe('Boundary / empty / unknown inputs', () => {
    it('returns null for empty string or unknown ticker without matching name', () => {
      expect(getStockCategory('')).toBeNull()
      expect(getStockCategory('   ')).toBeNull()
      expect(getStockCategory('888888')).toBeNull()
      expect(getStockCategory('UNKNOWN')).toBeNull()
    })

    it('handles trimming and lowercase symbols gracefully', () => {
      expect(getStockCategory(' 2330 ')).toBe('半導體')
      expect(getStockCategory(' 00679b ')).toBe('債券 ETF')
    })
  })
})
