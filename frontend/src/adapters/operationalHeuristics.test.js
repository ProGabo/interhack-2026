import { describe, expect, it } from 'vitest'
import { buildDDIMetrics, buildManifestExplainability, buildSlotManifest } from './operationalHeuristics'

function createStop(sequence, cargo) {
  return {
    sequence,
    stopId: `stop-${sequence}`,
    location: { address: `Stop ${sequence}` },
    cargo,
  }
}

describe('operational heuristics', () => {
  it('computes lateral blockers for current stop', () => {
    const routeStops = [
      createStop(1, [{ position: { row: 0, col: 1 }, label: 'S1-Center', skuCount: 6, type: 'full' }]),
      createStop(2, [{ position: { row: 0, col: 0 }, label: 'S2-Left', skuCount: 6, type: 'full' }]),
      createStop(3, [{ position: { row: 0, col: 2 }, label: 'S3-Right', skuCount: 6, type: 'full' }]),
    ]
    const manifest = buildSlotManifest({ routeStops, progressStop: 0 })
    const metrics = buildDDIMetrics({ manifest, routeStops, progressStop: 0 })

    expect(metrics.blockedPalletsCount).toBe(1)
    expect(metrics.blockedPallets[0].coordinate).toContain('R1-C')
  })

  it('detects vertical blockers and overflow risk for reverse logistics', () => {
    const routeStops = [
      createStop(1, [{ position: { row: 0, col: 0 }, label: 'S1', skuCount: 4, type: 'full' }]),
      createStop(2, [{ position: { row: 0, col: 0 }, label: 'S2', skuCount: 4, type: 'full' }]),
      createStop(3, [{ position: { row: 0, col: 0 }, label: 'S3', skuCount: 4, type: 'full' }]),
      createStop(4, [{ position: { row: 0, col: 0 }, label: 'Return-4', skuCount: 2, type: 'empty_return' }]),
      createStop(5, [{ position: { row: 0, col: 0 }, label: 'Return-5', skuCount: 2, type: 'empty_return' }]),
    ]
    const manifest = buildSlotManifest({ routeStops, progressStop: 2 })
    const metrics = buildDDIMetrics({ manifest, routeStops, progressStop: 2 })

    expect(metrics.blockedVerticalSlotsCount).toBeGreaterThan(0)
    expect(metrics.extraMoves).toBeGreaterThan(0)
    expect(metrics.projectedOverflowRisk).toBe(true)
  })

  it('builds explainability from physical constraints only', () => {
    const routeStops = [
      createStop(1, [{ position: { row: 0, col: 1 }, label: 'S1-Center', skuCount: 6, type: 'full' }]),
      createStop(2, [{ position: { row: 0, col: 0 }, label: 'S2-Left', skuCount: 6, type: 'full' }]),
      createStop(3, [{ position: { row: 0, col: 2 }, label: 'S3-Right', skuCount: 6, type: 'full' }]),
    ]
    const manifest = buildSlotManifest({ routeStops, progressStop: 0 })
    const metrics = buildDDIMetrics({ manifest, routeStops, progressStop: 0 })
    const insights = buildManifestExplainability({ manifest, progressStop: 0, ddiMetrics: metrics })

    expect(insights.length).toBeGreaterThanOrEqual(4)
    expect(insights.join(' ')).toContain('Re-handle')
    expect(insights.join(' ')).toContain('side access')
  })
})
