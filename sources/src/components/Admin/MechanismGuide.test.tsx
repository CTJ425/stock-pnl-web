// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MechanismGuide } from './MechanismGuide'

describe('MechanismGuide', () => {
  afterEach(cleanup)

  it('預設為收合狀態，顯示標題與展開按鈕', () => {
    render(<MechanismGuide />)
    expect(screen.getByText('探針與排程機制運作總覽')).toBeTruthy()
    expect(screen.getByText('展開機制與週期對照表')).toBeTruthy()
    expect(screen.queryByText('資料源探針運作週期（7 大來源）')).toBeNull()
  })

  it('點擊可展開並顯示雙軌架構說明與對照表格', () => {
    render(<MechanismGuide />)
    const toggle = screen.getByRole('button', { name: /探針與排程機制運作總覽/ })
    fireEvent.click(toggle)

    expect(screen.getByText('收合說明')).toBeTruthy()
    expect(screen.getByText('資料源探針運作週期（7 大來源）')).toBeTruthy()
    expect(screen.getByText('pg_cron 定時排程與兜底備援（5 大排程）')).toBeTruthy()

    // 驗證探針來源都在表中
    for (const id of ['bfi82u', 't86', 'bwibbu', 'margin', 'borrow', 'mops_revenue', 'mops_profit']) {
      expect(screen.getByText(id)).toBeTruthy()
    }

    // 驗證 5 大排程都在表中
    for (const job of ['source-probe', 'macro-daily', 'fx-daily', 'market-data-daily', 'history-daily']) {
      expect(screen.getAllByText(job).length).toBeGreaterThan(0)
    }
  })

  it('再次點擊可收合', () => {
    render(<MechanismGuide />)
    const toggle = screen.getByRole('button', { name: /探針與排程機制運作總覽/ })
    fireEvent.click(toggle)
    expect(screen.getByText('收合說明')).toBeTruthy()

    fireEvent.click(toggle)
    expect(screen.getByText('展開機制與週期對照表')).toBeTruthy()
    expect(screen.queryByText('資料源探針運作週期（7 大來源）')).toBeNull()
  })
})
