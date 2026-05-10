const HEURISTIC_CONSTANTS = {
  highVolumeThresholdM3: 3.8,
  largeItemVolumeThresholdM3: 1.0,
  heavyWeightThresholdKg: 420,
  nearStopPriorityWindow: 2,
  returnReserveRatio: 0.3,
  balanceTolerance: 0.2,
  slotVolumeM3: 0.9,
  minStackLayers: 2,
  maxStackLayers: 3,
  fallbackReturnStopsRatio: 0.6,
}

const HANDLING_SECONDS_BY_TYPE = {
  target_unload: 120,
  full: 75,
  empty_return: 55,
  free: 0,
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toUpperText(value) {
  return String(value ?? '').toUpperCase()
}

function inferVolumeProxy(item) {
  const width = toFiniteNumber(item?.size?.w, 0)
  const height = toFiniteNumber(item?.size?.h, 0)
  const depth = toFiniteNumber(item?.size?.d, 0)
  if (width > 0 && height > 0 && depth > 0) {
    return width * height * depth
  }

  const label = toUpperText(item?.product ?? item?.label)
  if (label.includes('BARRIL') || label.includes('KEG')) return 1.15
  if (label.includes('CAJA') || label.includes('CRATE')) return 0.72
  if (label.includes('AGUA')) return 1.05
  return 0.9
}

function getLoadType(item) {
  return item?.type ?? 'full'
}

function getBayLabel(col, totalCols) {
  if (!Number.isFinite(col) || !Number.isFinite(totalCols) || totalCols < 2) return 'Center Bay'
  if (col === 0) return 'Left Lateral'
  if (col === totalCols - 1) return 'Right Lateral'
  return 'Center Bay'
}

function getSideCode(col, maxCol) {
  if (col === 0) return 'L'
  if (col === maxCol) return 'R'
  return 'C'
}

function getAccessLabel(col, maxCol) {
  if (col === 0) return 'Access via Left Curtain'
  if (col === maxCol) return 'Access via Right Curtain'
  return 'Center lane access'
}

function getDepthLabel(row, maxRow) {
  if (row === 0) return 'Front'
  if (row === maxRow) return 'Rear'
  return 'Mid'
}

function getProductGroupName(product) {
  const text = toUpperText(product)
  if (text.includes('BARRIL') || text.includes('KEG')) return 'Kegs'
  if (text.includes('CAJA') || text.includes('CRATE')) return 'Crates'
  return 'Mixed references'
}

function isReturnMarker(value) {
  const marker = String(value ?? '').toLowerCase()
  return marker.includes('return') || marker.includes('empty') || marker.includes('vacio')
}

function getMaxStackLayersForItem(item) {
  const volume = inferVolumeProxy(item)
  return volume > HEURISTIC_CONSTANTS.largeItemVolumeThresholdM3
    ? HEURISTIC_CONSTANTS.minStackLayers
    : HEURISTIC_CONSTANTS.maxStackLayers
}

function getSlotMaxLayers(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return HEURISTIC_CONSTANTS.maxStackLayers
  return entries.reduce(
    (limit, entry) => Math.min(limit, getMaxStackLayersForItem(entry)),
    HEURISTIC_CONSTANTS.maxStackLayers,
  )
}

function createLayerRecord({
  key,
  row,
  col,
  layerIndex,
  sideCode,
  depth,
  maxCol,
  source = null,
  status = 'empty',
  progressStop = 0,
}) {
  const slotId = `R${row + 1}-${sideCode}`
  const access = getAccessLabel(col, maxCol)
  const coordinate = `${slotId}L${layerIndex + 1} (${depth})`

  if (!source) {
    return {
      key,
      row,
      col,
      layerIndex,
      slotId,
      depth,
      coordinate,
      access,
      status: 'empty',
      assignment: 'Reserved empty layer',
      upcomingSequence: null,
      product: null,
      reason: '',
      label: `Layer ${layerIndex + 1} empty`,
      skuCount: 0,
      stopSequences: [],
    }
  }

  const sequence = toFiniteNumber(source?.sequence, 0)
  const group = getProductGroupName(source?.product)
  const label = source?.label ?? `${toFiniteNumber(source?.skuCount, 1)} SKUs`
  const lateralNode = col === 0 ? 'left side' : col === maxCol ? 'right side' : 'middle lane'
  const assignment = status === 'return_assigned'
    ? 'Empty Crate/Keg Return Buffer'
    : `${group} - Stop ${sequence} (${source?.stopName ?? `Stop ${sequence}`})`
  const reason = source?.reason
    ?? (status === 'return_assigned'
      ? 'Space reserved here for the empty crates you will pick up.'
      : `Stop ${sequence}: ${label} placed on the ${lateralNode} at waist-height for easy, fast reaching.`)

  return {
    key,
    row,
    col,
    layerIndex,
    slotId,
    depth,
    coordinate,
    access,
    status,
    assignment,
    upcomingSequence: status === 'active' ? sequence : null,
    product: source?.product ?? null,
    reason,
    label,
    skuCount: toFiniteNumber(source?.skuCount, 0),
    stopSequences: [sequence],
    type: source?.type ?? 'full',
    isCurrentStop: status === 'active' && sequence === Number(progressStop) + 1,
  }
}

function flattenTopLayerSlots(layeredSlots = [], maxLayers = 1) {
  return layeredSlots.map((slot) => {
    const visibleLayer = [...slot.layers].reverse().find((layer) => layer.status !== 'empty') ?? slot.layers[0]
    return {
      key: slot.key,
      row: slot.row,
      col: slot.col,
      slotId: slot.slotId,
      depth: slot.depth,
      coordinate: `${slot.slotId} (${slot.depth})`,
      access: slot.access,
      assignment: visibleLayer?.assignment ?? 'Reserved empty slot',
      status: visibleLayer?.status ?? 'empty',
      upcomingSequence: visibleLayer?.upcomingSequence ?? null,
      product: visibleLayer?.product ?? null,
      reason: visibleLayer?.reason ?? '',
      label: visibleLayer?.label ?? `Layer ${maxLayers} empty`,
      skuCount: visibleLayer?.skuCount ?? 0,
      stopSequences: slot.stopSequences ?? [],
      layers: slot.layers,
      stackUnits: slot.filledLayers,
      availableLayers: slot.availableLayers,
    }
  })
}

function normalizeDenseLayers(slotLayers = [], maxLayers = HEURISTIC_CONSTANTS.maxStackLayers) {
  const occupied = slotLayers.filter((layer) => layer?.status !== 'empty')
  const empties = slotLayers.filter((layer) => layer?.status === 'empty')
  const ordered = [...occupied, ...empties].slice(0, maxLayers)
  return ordered.map((layer, layerIndex) => ({
    ...layer,
    layerIndex,
    key: `${String(layer?.key ?? `layer-${layerIndex}`).split('-').slice(0, 2).join('-')}-${layerIndex}`,
    coordinate: String(layer?.coordinate ?? '')
      .replace(/L\d+/, `L${layerIndex + 1}`),
  }))
}

function computeBlockedPalletDetails({ manifest = { slots: [] }, progressStop = 0 } = {}) {
  const layeredSlots = Array.isArray(manifest?.layeredSlots) ? manifest.layeredSlots : []
  const slots = layeredSlots.length > 0
    ? flattenTopLayerSlots(layeredSlots, manifest?.maxLayers ?? HEURISTIC_CONSTANTS.maxStackLayers)
    : Array.isArray(manifest?.slots) ? manifest.slots : []
  const currentSequence = Number(progressStop) + 1
  const currentStopSlots = slots
    .filter((slot) => slot.status === 'active' && slot.upcomingSequence === currentSequence)
  if (currentStopSlots.length === 0) return []

  const laterStopSlots = slots.filter(
    (slot) => slot.status === 'active' && Number(slot.upcomingSequence) > currentSequence,
  )

  const blocked = currentStopSlots.filter((currentSlot) => {
    const rowMatches = laterStopSlots.filter((slot) => slot.row === currentSlot.row)
    const blockedFromLeft = rowMatches.some((slot) => slot.col < currentSlot.col)
    const blockedFromRight = rowMatches.some((slot) => slot.col > currentSlot.col)
    return blockedFromLeft && blockedFromRight
  })

  return blocked
    .sort((a, b) => {
      const rowDelta = Number(a?.row ?? 0) - Number(b?.row ?? 0)
      if (rowDelta !== 0) return rowDelta
      return Number(a?.col ?? 0) - Number(b?.col ?? 0)
    })
    .map((slot) => ({
      key: slot.key,
      coordinate: slot.coordinate ?? `R${Number(slot?.row ?? 0) + 1}C${Number(slot?.col ?? 0) + 1}`,
      access: slot.access ?? 'Center lane access',
    }))
}

function computeVerticalBlockedDetails({ manifest = { layeredSlots: [] }, progressStop = 0 } = {}) {
  const layeredSlots = Array.isArray(manifest?.layeredSlots) ? manifest.layeredSlots : []
  const currentSequence = Number(progressStop) + 1
  const blockedSlots = []

  layeredSlots.forEach((slot) => {
    const layers = Array.isArray(slot?.layers) ? slot.layers : []
    const targetLayer = layers.find(
      (layer) => layer.status === 'active' && Number(layer.upcomingSequence) === currentSequence,
    )
    if (!targetLayer) return
    const blockingLayers = layers.filter(
      (layer) =>
        layer.layerIndex > targetLayer.layerIndex
        && layer.status !== 'empty'
        && Number(layer.upcomingSequence) !== currentSequence,
    )
    if (blockingLayers.length === 0) return

    blockedSlots.push({
      key: slot.key,
      coordinate: `R${slot.row + 1}C${slot.col + 1}`,
      blockedLayer: targetLayer.layerIndex,
      topLayer: Math.max(...blockingLayers.map((layer) => layer.layerIndex)),
      extraMoves: blockingLayers.length,
      blockers: blockingLayers.map((layer) => ({
        layerIndex: layer.layerIndex,
        sequence: layer.upcomingSequence,
        label: layer.label,
      })),
    })
  })

  return blockedSlots.sort((a, b) => (a.extraMoves - b.extraMoves) || a.coordinate.localeCompare(b.coordinate))
}

function computeLoadGroupingMode({ manifest = { slots: [] } } = {}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  const activeSlots = slots.filter((slot) => slot.status === 'active')
  if (activeSlots.length === 0) {
    return {
      loadGroupingMode: 'Hybrid',
      orderScore: 0,
      skuScore: 0,
      groupedByOrderRows: 0,
      groupedBySkuRows: 0,
      analyzedRows: 0,
    }
  }

  const rowMap = new Map()
  activeSlots.forEach((slot) => {
    if (!rowMap.has(slot.row)) {
      rowMap.set(slot.row, [])
    }
    rowMap.get(slot.row).push(slot)
  })

  const rows = [...rowMap.values()]
  const analyzedRows = rows.length
  const groupedByOrderRows = rows.filter((rowSlots) => {
    const distinctSequences = new Set(rowSlots.map((slot) => Number(slot.upcomingSequence)))
    return distinctSequences.size <= 1
  }).length
  const groupedBySkuRows = rows.filter((rowSlots) => {
    const distinctGroups = new Set(rowSlots.map((slot) => getProductGroupName(slot?.product)))
    const distinctSequences = new Set(rowSlots.map((slot) => Number(slot.upcomingSequence)))
    return distinctGroups.size <= 1 && distinctSequences.size > 1
  }).length

  const orderScore = groupedByOrderRows / Math.max(analyzedRows, 1)
  const skuScore = groupedBySkuRows / Math.max(analyzedRows, 1)

  let loadGroupingMode = 'Hybrid'
  if (skuScore >= 0.6 && orderScore < 0.4) {
    loadGroupingMode = 'Grouped by SKU'
  } else if (orderScore >= 0.6 && skuScore < 0.4) {
    loadGroupingMode = 'Grouped by Order'
  }

  return {
    loadGroupingMode,
    orderScore,
    skuScore,
    groupedByOrderRows,
    groupedBySkuRows,
    analyzedRows,
  }
}

function computeReturnPayload({
  manifest = { slots: [] },
  routeStops = [],
  progressStop = 0,
} = {}) {
  const layeredSlots = Array.isArray(manifest?.layeredSlots) ? manifest.layeredSlots : []
  const layers = layeredSlots.length > 0
    ? layeredSlots.flatMap((slot) => slot.layers ?? [])
    : (Array.isArray(manifest?.slots) ? manifest.slots : [])
  const emptySlots = layers.filter((slot) => slot.status === 'empty').length
  const returnAssignedSlots = layers.filter((slot) => slot.status === 'return_assigned').length
  const returnsVolumeUsed = Number((returnAssignedSlots * HEURISTIC_CONSTANTS.slotVolumeM3).toFixed(2))
  const returnsVolumeAvailable = Number((emptySlots * HEURISTIC_CONSTANTS.slotVolumeM3).toFixed(2))

  const currentSequence = Number(progressStop) + 1
  const remainingStops = (Array.isArray(routeStops) ? routeStops : [])
    .filter((stop) => toFiniteNumber(stop?.sequence, 0) > currentSequence)
  const knownPendingReturnSlots = remainingStops.reduce((sum, stop) => {
    const cargo = Array.isArray(stop?.cargo) ? stop.cargo : []
    return sum + cargo.filter((item) => isReturnMarker(item?.type ?? item?.label ?? item?.product)).length
  }, 0)
  const fallbackPendingReturnSlots = Math.ceil(
    remainingStops.length * HEURISTIC_CONSTANTS.fallbackReturnStopsRatio,
  )
  const projectedPendingReturnSlots = Math.max(knownPendingReturnSlots, fallbackPendingReturnSlots)
  const projectedPendingReturnVolume = Number(
    (projectedPendingReturnSlots * HEURISTIC_CONSTANTS.slotVolumeM3).toFixed(2),
  )
  const projectedOverflowRisk = projectedPendingReturnVolume > returnsVolumeAvailable

  return {
    returnAssignedSlots,
    emptySlots,
    returnsVolumeUsed,
    returnsVolumeAvailable,
    projectedPendingReturnSlots,
    projectedPendingReturnVolume,
    projectedOverflowRisk,
  }
}

function buildHybridNarrative({ grouping = {}, blockedPalletsCount = 0 } = {}) {
  if (grouping.loadGroupingMode === 'Grouped by SKU') {
    return `SKU Loading: ${grouping.groupedBySkuRows}/${Math.max(grouping.analyzedRows, 1)} rows are SKU-clustered for warehouse picking speed, with ${blockedPalletsCount} blocked pallets currently requiring rehandle.`
  }
  if (grouping.loadGroupingMode === 'Grouped by Order') {
    return `Order Loading: ${grouping.groupedByOrderRows}/${Math.max(grouping.analyzedRows, 1)} rows follow stop sequence to reduce driver movement, with ${blockedPalletsCount} blocked pallets currently requiring rehandle.`
  }
  return `Hybrid Loading: ${grouping.groupedBySkuRows}/${Math.max(grouping.analyzedRows, 1)} rows are SKU-grouped for warehouse speed while ${grouping.groupedByOrderRows}/${Math.max(grouping.analyzedRows, 1)} rows remain delivery-sequenced to reduce driver movement, with ${blockedPalletsCount} blocked pallets currently requiring rehandle.`
}

export function computeLoadStats({ pallets = [], matrix = [] } = {}) {
  const safePallets = Array.isArray(pallets) ? pallets : []
  const rowCount = Array.isArray(matrix) ? matrix.length : 0
  const colCount = Array.isArray(matrix?.[0]) ? matrix[0].length : 0
  const totalSlots = rowCount > 0 && colCount > 0 ? rowCount * colCount : Math.max(safePallets.length, 1)
  const occupiedSlots = rowCount > 0 && colCount > 0
    ? matrix.flat().filter((slot) => slot?.type !== 'free').length
    : safePallets.length

  const leftSideWeight = safePallets
    .filter((pallet) => toFiniteNumber(pallet?.col, 0) <= Math.floor((Math.max(colCount, 2) - 1) / 2))
    .reduce((sum, pallet) => sum + toFiniteNumber(pallet?.weight, pallet?.weightKg ?? 0), 0)
  const rightSideWeight = safePallets
    .filter((pallet) => toFiniteNumber(pallet?.col, 0) > Math.floor((Math.max(colCount, 2) - 1) / 2))
    .reduce((sum, pallet) => sum + toFiniteNumber(pallet?.weight, pallet?.weightKg ?? 0), 0)

  const totalWeightKg = safePallets.reduce(
    (sum, pallet) => sum + toFiniteNumber(pallet?.weight, pallet?.weightKg ?? 0),
    0,
  )
  const totalVolumeProxyM3 = safePallets.reduce((sum, pallet) => sum + inferVolumeProxy(pallet), 0)
  const targetUnloadCount = safePallets.filter((pallet) => getLoadType(pallet) === 'target_unload').length
  const emptyReturnCount = safePallets.filter((pallet) => getLoadType(pallet) === 'empty_return').length
  const occupancyPercent = Math.min(100, Math.round((occupiedSlots / Math.max(totalSlots, 1)) * 100))
  const sideDiffRatio = totalWeightKg > 0 ? Math.abs(leftSideWeight - rightSideWeight) / totalWeightKg : 0

  return {
    rowCount,
    colCount,
    totalSlots,
    occupiedSlots,
    totalWeightKg,
    totalVolumeProxyM3,
    targetUnloadCount,
    emptyReturnCount,
    occupancyPercent,
    sideDiffRatio,
    leftSideWeight,
    rightSideWeight,
  }
}

export function buildDDIMetrics({
  manifest = { slots: [] },
  routeStops = [],
  progressStop = 0,
  loadStats = {},
} = {}) {
  const blockedPallets = computeBlockedPalletDetails({ manifest, progressStop })
  const verticalBlockedSlots = computeVerticalBlockedDetails({ manifest, progressStop })
  const extraMoves = verticalBlockedSlots.reduce((sum, slot) => sum + Number(slot?.extraMoves ?? 0), 0)
  const grouping = computeLoadGroupingMode({ manifest })
  const returnPayload = computeReturnPayload({ manifest, routeStops, progressStop })
  const blockedPalletsCount = blockedPallets.length
  const blockedVerticalSlotsCount = verticalBlockedSlots.length
  const slotVolumeM3 = Number(HEURISTIC_CONSTANTS.slotVolumeM3.toFixed(2))
  const fallbackReturnStopsRatio = HEURISTIC_CONSTANTS.fallbackReturnStopsRatio
  const recommendation = returnPayload.projectedOverflowRisk
    ? `Overflow risk: reserve at least ${Math.max(1, returnPayload.projectedPendingReturnSlots - returnPayload.emptySlots)} extra return slot(s) before stop ${Math.min(routeStops.length, progressStop + 2)}.`
    : extraMoves > 0
      ? `Blocked Slot / Re-handle Risk: ${blockedVerticalSlotsCount} slot(s) blocked by top layers. Plan ${extraMoves} extra move(s) before unloading the current stop.`
    : blockedPalletsCount > 0
      ? `Unload sequence warning: prioritize ${Math.min(blockedPalletsCount, 3)} blocked pallet(s) first to avoid lateral rehandles.`
      : 'Layout looks feasible: maintain current sequence and keep lateral curtains clear.'

  return {
    blockedPalletsCount,
    blockedPallets,
    blockedVerticalSlotsCount,
    verticalBlockedSlots,
    extraMoves,
    loadGroupingMode: grouping.loadGroupingMode,
    groupedByOrderRows: grouping.groupedByOrderRows,
    groupedBySkuRows: grouping.groupedBySkuRows,
    analyzedRows: grouping.analyzedRows,
    returnsVolumeUsed: returnPayload.returnsVolumeUsed,
    returnsVolumeAvailable: returnPayload.returnsVolumeAvailable,
    projectedPendingReturnSlots: returnPayload.projectedPendingReturnSlots,
    projectedPendingReturnVolume: returnPayload.projectedPendingReturnVolume,
    projectedOverflowRisk: returnPayload.projectedOverflowRisk,
    narrative: buildHybridNarrative({ grouping, blockedPalletsCount }),
    recommendation,
    assumptions: {
      slotVolumeM3,
      fallbackReturnStopsRatio,
    },
    occupancyPercent: toFiniteNumber(loadStats?.occupancyPercent, 0),
  }
}

export function buildExplainabilityInsights({
  stopAddress = 'Current stop',
  loadStats = {},
  ddiMetrics = {},
  deliveryStatus = [],
} = {}) {
  const deliveredStops = Array.isArray(deliveryStatus)
    ? deliveryStatus.filter((status) => status === 'delivered').length
    : 0
  const totalStops = Math.max(Array.isArray(deliveryStatus) ? deliveryStatus.length : 0, 1)
  const progressPercent = Math.round((deliveredStops / totalStops) * 100)
  const clientLabel = String(stopAddress).split(',')[0] ?? 'client'

  const insights = [
    `Current stop focus for ${clientLabel}: ${ddiMetrics.blockedPalletsCount ?? 0} blocked pallets require rehandle before lateral unloading can finish.`,
  ]

  if (toFiniteNumber(loadStats?.totalVolumeProxyM3, 0) > HEURISTIC_CONSTANTS.highVolumeThresholdM3) {
    insights.push('Grouping rule: high-volume references are prioritized in center bays to improve truck stability on urban turns.')
  } else {
    insights.push('Grouping rule: mixed-client references are kept closer to lateral bays to reduce rehandles on next stops.')
  }

  if (toFiniteNumber(loadStats?.sideDiffRatio, 0) > HEURISTIC_CONSTANTS.balanceTolerance) {
    insights.push('Balance correction: returnables are shifted to the lighter side to avoid side-load imbalance during pickups.')
  } else {
    insights.push('Balance status: left-right load remains within tolerance, so return zones can stay near central-low lanes.')
  }

  insights.push(`Operational snapshot: ${ddiMetrics.occupancyPercent ?? 0}% occupancy, route progress ${progressPercent}%, and ${ddiMetrics.returnsVolumeAvailable ?? 0} m3 still free for incoming returnables.`)
  return insights
}

export function buildRouteProgressStatus(totalStops = 0, progressStop = 0) {
  const safeTotalStops = Math.max(0, Number(totalStops) || 0)
  const deliveredCount = Math.max(0, Math.min(safeTotalStops, Number(progressStop) || 0))
  return Array.from({ length: safeTotalStops }, (_, index) =>
    index < deliveredCount ? 'delivered' : 'pending',
  )
}

export function buildGhostZones({
  matrix = [],
  loadStats = {},
  deliveryStatus = [],
  selectedStopIndex = 0,
} = {}) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) return []

  const rowCount = matrix.length
  const colCount = matrix[0].length
  const freeSlots = []
  const pendingAhead = Array.isArray(deliveryStatus)
    ? deliveryStatus.slice(selectedStopIndex + 1).some((status) => status !== 'delivered')
    : true
  const deliveredStops = Array.isArray(deliveryStatus)
    ? deliveryStatus.filter((status) => status === 'delivered').length
    : 0
  const progressRatio = deliveredStops / Math.max(deliveryStatus.length || 1, 1)

  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      if (matrix[row]?.[col]?.type === 'free') {
        freeSlots.push({ row, col })
      }
    }
  }

  if (freeSlots.length === 0) return []

  const targetReserve = Math.max(
    1,
    Math.min(
      freeSlots.length,
      Math.ceil(freeSlots.length * (HEURISTIC_CONSTANTS.returnReserveRatio + progressRatio * 0.35)),
    ),
  )
  const centerCol = (colCount - 1) / 2
  const preferredSide = loadStats.leftSideWeight > loadStats.rightSideWeight ? 'right' : 'left'

  const ranked = [...freeSlots].sort((a, b) => {
    const lanePenaltyA = pendingAhead && (a.col === 0 || a.col === colCount - 1) ? 1.8 : 0
    const lanePenaltyB = pendingAhead && (b.col === 0 || b.col === colCount - 1) ? 1.8 : 0
    const centerDistanceA = Math.abs(a.col - centerCol)
    const centerDistanceB = Math.abs(b.col - centerCol)
    const lowRowA = a.row
    const lowRowB = b.row
    const sideBonusA = preferredSide === 'left'
      ? (a.col <= centerCol ? -0.45 : 0)
      : (a.col > centerCol ? -0.45 : 0)
    const sideBonusB = preferredSide === 'left'
      ? (b.col <= centerCol ? -0.45 : 0)
      : (b.col > centerCol ? -0.45 : 0)
    const scoreA = lanePenaltyA + centerDistanceA + lowRowA + sideBonusA
    const scoreB = lanePenaltyB + centerDistanceB + lowRowB + sideBonusB
    return scoreA - scoreB
  })

  return ranked.slice(0, targetReserve).map((slot, index) => ({
    id: `ghost-${slot.row}-${slot.col}-${index}`,
    row: slot.row,
    col: slot.col,
    label: index === 0 ? 'RETURN BUFFER PRIORITY' : 'RETURN BUFFER',
    reason: pendingAhead ? 'Lane kept open for next unload' : 'Reserved for incoming empties',
  }))
}

export function buildLoadingSequence({
  routeStops = [],
  matrix = [],
} = {}) {
  const stops = Array.isArray(routeStops) ? routeStops : []
  const colCount = Array.isArray(matrix?.[0]) ? matrix[0].length : 4

  const byLoadOrder = [...stops]
    .filter((stop) => Array.isArray(stop?.cargo) && stop.cargo.length > 0)
    .sort((a, b) => toFiniteNumber(b?.sequence, 0) - toFiniteNumber(a?.sequence, 0))

  let stepNumber = 1
  const steps = []

  byLoadOrder.forEach((stop) => {
    const stopName = stop?.location?.address?.split(',')?.[0] ?? `Stop ${stop?.sequence ?? '?'}`
    const cargo = [...stop.cargo].sort((a, b) => {
      const aType = getLoadType(a)
      const bType = getLoadType(b)
      const typeWeight = { empty_return: 2, full: 1, target_unload: 0, free: 3 }
      const deltaType = (typeWeight[aType] ?? 9) - (typeWeight[bType] ?? 9)
      if (deltaType !== 0) return deltaType
      return toFiniteNumber(a?.position?.row, 0) - toFiniteNumber(b?.position?.row, 0)
    })

    cargo.forEach((item) => {
      const col = toFiniteNumber(item?.position?.col ?? item?.col, 0)
      const bay = getBayLabel(col, colCount)
      const productGroup = getProductGroupName(item?.product)
      const rationale = bay === 'Center Bay'
        ? 'stability-first placement'
        : 'lateral quick-access placement'

      steps.push({
        step: stepNumber,
        text: `Step ${stepNumber}: Load ${productGroup} for ${stopName} into ${bay} (${rationale}).`,
      })
      stepNumber += 1
    })
  })

  if (steps.length === 0) {
    return {
      steps: [
        { step: 1, text: 'Step 1: No cargo matrix detected. Keep center bay reserved and load next-stop pallets nearest lateral access.' },
      ],
      plainText: 'Step 1: No cargo matrix detected. Keep center bay reserved and load next-stop pallets nearest lateral access.',
    }
  }

  return {
    steps,
    plainText: steps.map((item) => item.text).join('\n'),
  }
}

export function buildSlotManifest({
  routeStops = [],
  progressStop = 0,
  matrix = [],
} = {}) {
  const stops = Array.isArray(routeStops) ? [...routeStops] : []
  const sortedStops = stops.sort(
    (a, b) => toFiniteNumber(a?.sequence, 0) - toFiniteNumber(b?.sequence, 0),
  )
  const slotTimeline = new Map()
  let maxRow = 0
  let maxCol = 0

  sortedStops.forEach((stop) => {
    const sequence = toFiniteNumber(stop?.sequence, 0)
    const cargo = Array.isArray(stop?.cargo) ? stop.cargo : []
    cargo.forEach((item, index) => {
      const row = toFiniteNumber(item?.position?.row ?? item?.row, Math.floor(index / 4))
      const col = toFiniteNumber(item?.position?.col ?? item?.col, index % 4)
      const key = `${row}-${col}`
      maxRow = Math.max(maxRow, row)
      maxCol = Math.max(maxCol, col)
      if (!slotTimeline.has(key)) {
        slotTimeline.set(key, [])
      }
      slotTimeline.get(key).push({
        ...item,
        sequence,
        stopId: stop?.stopId ?? null,
        stopName: stop?.location?.address?.split(',')?.[0] ?? `Stop ${sequence}`,
        type: item?.type ?? 'full',
        label: item?.label ?? `${toFiniteNumber(item?.skuCount ?? item?.qty ?? item?.units, 8)} SKUs`,
        reason: item?.reason ?? null,
        skuCount: toFiniteNumber(item?.skuCount ?? item?.qty ?? item?.units, 8),
        product: item?.product ?? item?.label ?? 'Mixed pallet',
        weightKg: toFiniteNumber(item?.weightKg ?? item?.weight, 0),
      })
    })
  })

  if (Array.isArray(matrix) && matrix.length > 0 && Array.isArray(matrix[0])) {
    maxRow = Math.max(maxRow, matrix.length - 1)
    maxCol = Math.max(maxCol, matrix[0].length - 1)
  }

  const layeredSlots = []
  const globalMaxLayers = HEURISTIC_CONSTANTS.maxStackLayers
  for (let row = 0; row <= maxRow; row += 1) {
    for (let col = 0; col <= maxCol; col += 1) {
      const key = `${row}-${col}`
      const timeline = (slotTimeline.get(key) ?? []).sort((a, b) => a.sequence - b.sequence || a.skuCount - b.skuCount)
      const activeDeliveries = timeline
        .filter((entry) => entry.sequence > progressStop && !isReturnMarker(entry.type))
        .sort((a, b) => b.sequence - a.sequence)
      const delivered = timeline.filter((entry) => entry.sequence <= progressStop && !isReturnMarker(entry.type))
      const explicitReturns = timeline.filter((entry) => entry.sequence <= progressStop && isReturnMarker(entry.type))
      const stopSequences = [...new Set(timeline.map((entry) => entry.sequence))].sort((a, b) => a - b)
      const sideCode = getSideCode(col, maxCol)
      const depth = getDepthLabel(row, maxRow)
      const slotId = `R${row + 1}-${sideCode}`
      const maxLayers = Math.max(
        HEURISTIC_CONSTANTS.minStackLayers,
        Math.min(HEURISTIC_CONSTANTS.maxStackLayers, getSlotMaxLayers(timeline)),
      )
      const slotLayers = Array.from({ length: maxLayers }, (_, layerIndex) =>
        createLayerRecord({
          key: `${key}-${layerIndex}`,
          row,
          col,
          layerIndex,
          sideCode,
          depth,
          maxCol,
          status: 'empty',
          progressStop,
        }))

      let filledLayers = 0
      activeDeliveries.slice(0, maxLayers).forEach((entry, index) => {
        slotLayers[index] = createLayerRecord({
          key: `${key}-${index}`,
          row,
          col,
          layerIndex: index,
          sideCode,
          depth,
          maxCol,
          source: entry,
          status: 'active',
          progressStop,
        })
        filledLayers += 1
      })

      const recycledReturns = delivered.map((entry) => ({
        ...entry,
        sequence: progressStop,
        type: 'empty_return',
        product: 'Returnables',
        label: entry?.label ?? 'Reused return layer',
        reason: 'Layer reused after delivery for reverse logistics pickup.',
      }))
      const returnEntries = [...explicitReturns, ...recycledReturns]

      returnEntries
        .slice(0, Math.max(0, maxLayers - filledLayers))
        .forEach((entry, offset) => {
          const layerIndex = filledLayers + offset
          slotLayers[layerIndex] = createLayerRecord({
            key: `${key}-${layerIndex}`,
            row,
            col,
            layerIndex,
            sideCode,
            depth,
            maxCol,
            source: entry,
            status: 'return_assigned',
            progressStop,
          })
        })

      const denseLayers = normalizeDenseLayers(slotLayers, maxLayers)
      layeredSlots.push({
        key,
        row,
        col,
        slotId,
        depth,
        access: getAccessLabel(col, maxCol),
        layers: denseLayers,
        maxLayers,
        filledLayers: denseLayers.filter((layer) => layer.status !== 'empty').length,
        availableLayers: denseLayers.filter((layer) => layer.status === 'empty').length,
        stopSequences,
      })
    }
  }

  const slots = flattenTopLayerSlots(layeredSlots, globalMaxLayers)

  return {
    slots,
    layeredSlots,
    maxRow,
    maxCol,
    maxLayers: globalMaxLayers,
  }
}

export function buildManifestExplainability({
  manifest = { slots: [] },
  progressStop = 0,
  loadStats = {},
  ddiMetrics = {},
} = {}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  const currentSequence = Number(progressStop) + 1
  const activeNow = slots.filter(
    (slot) => slot.status === 'active' && slot.upcomingSequence === currentSequence,
  )
  const activeSlots = activeNow.length > 0 ? activeNow : slots.filter((slot) => slot.status === 'active')
  const returnSlots = slots.filter((slot) => slot.status === 'return_assigned')
  const lateralActive = activeSlots.filter(
    (slot) => slot.col === 0 || slot.col === manifest.maxCol,
  )
  const goldenZonePercent = activeSlots.length > 0
    ? Math.round((lateralActive.length / activeSlots.length) * 100)
    : 80
  const reasonLines = activeSlots
    .map((slot) => slot.reason)
    .filter((reason) => String(reason ?? '').trim().length > 0)
    .slice(0, 2)
  const reverseReason = returnSlots[0]?.reason
    ?? 'Space reserved here for the empty crates you will pick up.'
  const ergonomicsReason = 'Placed on the side so you do not have to climb in.'
  const stackingReason = 'By stacking Stop 3 deliveries beneath Stop 2, we eliminate vertical re-handling while maintaining lateral access via the side lanes.'
  const stabilityReason = 'Heaviest items at the bottom for safety.'

  if (reasonLines.length > 0) {
    return [
      ddiMetrics?.narrative ?? buildHybridNarrative({}),
      ...reasonLines,
      ergonomicsReason,
      stackingReason,
      stabilityReason,
      reverseReason,
    ]
  }
  return [
    ddiMetrics?.narrative ?? 'Hybrid Loading: early pallets are grouped for warehouse speed and next-stop pallets remain side-accessible for driver efficiency.',
    ergonomicsReason,
    stackingReason,
    stabilityReason,
    reverseReason,
  ]
}

export function computeAccessibilityIndex({
  manifest = { slots: [], maxCol: 0 },
  progressStop = 0,
} = {}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  const maxCol = Number.isFinite(manifest?.maxCol) ? manifest.maxCol : 0
  const currentSequence = Number(progressStop) + 1
  const activeNow = slots.filter(
    (slot) => slot.status === 'active' && slot.upcomingSequence === currentSequence,
  )
  const activeSlots = activeNow.length > 0 ? activeNow : slots.filter((slot) => slot.status === 'active')

  if (activeSlots.length === 0) return 100

  const edgeActive = activeSlots.filter((slot) => slot.col === 0 || slot.col === maxCol).length
  return Math.round((edgeActive / activeSlots.length) * 100)
}

export function buildTruckStatusLayers({
  manifest = { slots: [], maxRow: 0, maxCol: 0 },
} = {}) {
  const layeredSlots = Array.isArray(manifest?.layeredSlots) ? manifest.layeredSlots : []
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  const maxRow = Number.isFinite(manifest?.maxRow) ? manifest.maxRow : 0
  const maxCol = Number.isFinite(manifest?.maxCol) ? manifest.maxCol : 0
  const rows = maxRow + 1
  const cols = maxCol + 1

  const statusBySlot = new Map()
  const sourceSlots = layeredSlots.length > 0 ? layeredSlots : slots
  sourceSlots.forEach((slot) => {
    const layers = Array.isArray(slot?.layers) ? slot.layers : [slot]
    const filled = layers.filter((layer) => layer.status !== 'empty')
    const topLayer = [...layers].reverse().find((layer) => layer.status !== 'empty') ?? layers[0]
    const deliveryCount = layers.filter((layer) => layer.status === 'active').length
    const returnCount = layers.filter((layer) => layer.status === 'return_assigned').length
    const emptyCount = layers.filter((layer) => layer.status === 'empty').length
    const status = topLayer?.status === 'active'
      ? 'delivery'
      : topLayer?.status === 'return_assigned'
        ? 'returnable'
        : 'empty'
    const composition = [
      deliveryCount > 0 ? 'Delivery' : null,
      returnCount > 0 ? 'Return' : null,
      emptyCount > 0 ? 'Empty' : null,
    ].filter(Boolean).join(' / ')
    const totalUnits = filled.length
    const redZone = returnCount > 0 && Number(slot?.col) !== 0 && Number(slot?.col) !== maxCol
    statusBySlot.set(slot.key, {
      key: slot.key,
      row: slot.row,
      col: slot.col,
      status,
      redZone,
      assignment: topLayer?.assignment ?? slot.assignment,
      access: topLayer?.access ?? slot.access,
      topLayerStatus: status,
      totalUnits,
      layersUsed: totalUnits,
      layersCapacity: layers.length,
      composition: composition || 'Empty',
      stackedLabel: `R${Number(slot?.row ?? 0) + 1}C${Number(slot?.col ?? 0) + 1}: ${totalUnits} Units (${composition || 'Empty'})`,
    })
  })

  const cells = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = `${row}-${col}`
      const fromManifest = statusBySlot.get(key)
      cells.push(
        fromManifest ?? {
          key,
          row,
          col,
          status: 'empty',
          redZone: false,
          assignment: 'Reserved empty slot',
          access: col === 0 ? 'Access via Left Curtain' : col === maxCol ? 'Access via Right Curtain' : 'Center lane access',
          totalUnits: 0,
          layersUsed: 0,
          layersCapacity: Number(manifest?.maxLayers ?? HEURISTIC_CONSTANTS.maxStackLayers),
          composition: 'Empty',
          stackedLabel: `R${row + 1}C${col + 1}: 0 Units (Empty)`,
        },
      )
    }
  }

  const redZoneWarnings = cells.filter((cell) => cell.redZone)
  return {
    rows,
    cols,
    cells,
    redZoneWarnings,
  }
}

export { HEURISTIC_CONSTANTS, HANDLING_SECONDS_BY_TYPE }
