import { describe, expect, it } from 'vitest'
import { buildTruckLoadManifest, classifyVisualState, normalizeRenderableBoxes } from './TruckCargo3D'

describe('TruckCargo3D helpers', () => {
  it('keeps return-assigned layers in reverse state even without upcomingSequence', () => {
    const manifest = {
      layeredSlots: [
        {
          key: '0-0',
          row: 0,
          col: 0,
          layers: [
            {
              layerIndex: 0,
              status: 'return_assigned',
              sequence: 1,
              label: 'Return layer',
              reason: 'Return layer reserved',
            },
          ],
        },
      ],
      slots: [],
    }

    const mapped = buildTruckLoadManifest({ manifest, cargo: [], progressStop: 2 })
    expect(mapped.length).toBe(1)
    const returnLayer = mapped.find((entry) => entry.type === 'returnable')
    expect(returnLayer).toBeTruthy()
    expect(classifyVisualState({
      stopIndex: returnLayer.stopIndex,
      activeStopIndex: 2,
      isReverse: true,
    })).toBe('reverse')
  })

  it('drops unsupported boxes to the nearest supported layer', () => {
    const normalized = normalizeRenderableBoxes([
      { id: 'base', type: 'active', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 1 },
      { id: 'floating', type: 'active', x: 1, y: 2, z: 0, width: 1, depth: 1, height: 1 },
    ])

    const floating = normalized.find((item) => item.id === 'floating')
    expect(floating.y).toBe(0)
    expect(floating.supportAdjusted).toBe(true)
  })
})
