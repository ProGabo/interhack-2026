function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : fallback
}

function normalizeStopIndex(rawStopIndex) {
  const parsed = toInt(rawStopIndex, 0)
  // Backend route docs often emit 1-based stop indexes; keep frontend internal
  // representation 0-based for direct alignment with slider/delivery arrays.
  return parsed > 0 ? parsed - 1 : 0
}

function normalizeCube(cube, index = 0) {
  const reverseMarker = String(cube?.type ?? cube?.product_id ?? '').toLowerCase()
  return {
    x: toInt(cube?.x),
    y: toInt(cube?.y),
    z: toInt(cube?.z),
    stop_index: normalizeStopIndex(cube?.stop_index),
    product_id: cube?.product_id ?? `unit-${index + 1}`,
    is_reverse: reverseMarker.includes('return') || reverseMarker.includes('empty') || reverseMarker.includes('vacio'),
  }
}

function inferCubeGrid(cubes, cubeGrid, layout) {
  if (cubeGrid && Number.isFinite(cubeGrid?.L) && Number.isFinite(cubeGrid?.W) && Number.isFinite(cubeGrid?.H)) {
    return {
      L: toInt(cubeGrid.L, 1),
      W: toInt(cubeGrid.W, 1),
      H: toInt(cubeGrid.H, 1),
    }
  }

  const rows = toInt(layout?.rows, 2)
  const cols = toInt(layout?.cols, 3)
  const fallback = { L: Math.max(1, cols * 3), W: Math.max(1, rows * 3), H: 1 }
  if (!Array.isArray(cubes) || cubes.length === 0) return fallback

  const maxX = cubes.reduce((max, item) => Math.max(max, toInt(item?.x)), 0)
  const maxY = cubes.reduce((max, item) => Math.max(max, toInt(item?.y)), 0)
  const maxZ = cubes.reduce((max, item) => Math.max(max, toInt(item?.z)), 0)
  return {
    L: Math.max(fallback.L, maxX + 1),
    W: Math.max(fallback.W, maxY + 1),
    H: Math.max(fallback.H, maxZ + 1),
  }
}

export function deriveCubesFromLegacy(pallets, deliveries) {
  if (!Array.isArray(pallets) || pallets.length === 0) return []

  const stopByPallet = {}
  deliveries?.forEach((delivery, stopIndex) => {
    if (stopIndex === 0) return
    delivery?.pallet_positions?.forEach((position) => {
      stopByPallet[`${position.row},${position.col}`] = stopIndex
    })
  })

  const cubes = []
  pallets.forEach((pallet) => {
    const stopIndex = stopByPallet[`${pallet.row},${pallet.col}`] ?? 0
    const units = []
    pallet?.products?.forEach((product) => {
      const quantity = Math.max(1, toInt(product?.quantity, 1))
      for (let index = 0; index < quantity; index += 1) {
        units.push(product?.product_id ?? 'SKU')
      }
    })
    units.slice(0, 9).forEach((productId, index) => {
      const lower = String(productId ?? '').toLowerCase()
      cubes.push({
        x: toInt(pallet?.col) * 3 + (index % 3),
        y: toInt(pallet?.row) * 3 + Math.floor(index / 3),
        z: 0,
        stop_index: normalizeStopIndex(stopIndex),
        product_id: productId,
        is_reverse: lower.includes('return') || lower.includes('empty') || lower.includes('vacio'),
      })
    })
  })
  return cubes
}

function deriveCubesFromCargo(cargo, selectedStopIndex = 0) {
  if (!Array.isArray(cargo) || cargo.length === 0) return []
  const stopIndex = toInt(selectedStopIndex, 0)
  const cubes = []
  cargo.forEach((item, itemIndex) => {
    const baseRow = toInt(item?.position?.row ?? item?.row ?? 0)
    const baseCol = toInt(item?.position?.col ?? item?.col ?? itemIndex)
    const quantity = Math.max(1, toInt(item?.skuCount ?? item?.qty ?? item?.units ?? 4, 4))
    const productId = item?.product_id ?? item?.product ?? item?.label ?? `cargo-${itemIndex + 1}`
    const reverseMarker = String(item?.type ?? productId ?? '').toLowerCase()
    const isReverse = reverseMarker.includes('return') || reverseMarker.includes('empty') || reverseMarker.includes('vacio')
    const units = Math.min(9, quantity)
    for (let index = 0; index < units; index += 1) {
      cubes.push({
        x: baseCol * 3 + (index % 3),
        y: baseRow * 3 + Math.floor(index / 3),
        z: 0,
        stop_index: stopIndex,
        product_id: productId,
        is_reverse: isReverse,
      })
    }
  })
  return cubes
}

export function resolveGranularCubePayload({
  cubes,
  cubeGrid,
  pallets,
  deliveries,
  cargo,
  layout,
  selectedStopIndex = 0,
}) {
  const normalizedIncoming = Array.isArray(cubes) ? cubes.map(normalizeCube).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z)) : []
  const legacy = normalizedIncoming.length > 0 ? [] : deriveCubesFromLegacy(pallets, deliveries)
  const cargoFallback = normalizedIncoming.length > 0 || legacy.length > 0 ? [] : deriveCubesFromCargo(cargo, selectedStopIndex)
  const resolved = normalizedIncoming.length > 0 ? normalizedIncoming : legacy.length > 0 ? legacy : cargoFallback

  return {
    cubes: resolved,
    cubeGrid: inferCubeGrid(resolved, cubeGrid, layout),
  }
}
