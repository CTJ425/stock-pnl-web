// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SectorFlowLink } from './SectorFlowLink'

afterEach(cleanup)

describe('SectorFlowLink', () => {
  it('points 台股市場 at the 資金流向 page with a plain hash link', () => {
    render(<SectorFlowLink />)
    expect(screen.getByRole('link', { name: '前往資金流向' }).getAttribute('href')).toBe('#/sector-flow')
    expect(screen.getByText('類股資金流向')).toBeTruthy()
  })
})
