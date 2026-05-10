const HEURISTIC_CONSTANTS = {
  highVolumeThresholdM3: 3.8,
  heavyWeightThresholdKg: 420,
  nearStopPriorityWindow: 2,
  returnReserveRatio: 0.3,
  balanceTolerance: 0.2,
  co2PerKmKg: 0.92,
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

function estimateRouteDistanceKm(routePoints = []) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) return 0

  const toRadians = (degrees) => (degrees * Math.PI) / 180
  const earthRadiusKm = 6371
  let distanceKm = 0

  for (let index = 1; index < routePoints.length; index += 1) {
    const prev = routePoints[index - 1]
    const next = routePoints[index]
    if (!Number.isFinite(prev?.lat) || !Number.isFinite(prev?.lng) || !Number.isFinite(next?.lat) || !Number.isFinite(next?.lng)) {
      continue
    }
    const dLat = toRadians(next.lat - prev.lat)
    const dLng = toRadians(next.lng - prev.lng)
    const lat1 = toRadians(prev.lat)
    const lat2 = toRadians(next.lat)
    const haversine =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    distanceKm += earthRadiusKm * centralAngle
  }

  return distanceKm
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

export function buildOperationalKpis({
  routePoints = [],
  deliveryStatus = [],
  loadStats = {},
  selectedStopIndex = 0,
} = {}) {
  const totalDistanceKm = estimateRouteDistanceKm(routePoints)
  const deliveredStops = Array.isArray(deliveryStatus)
    ? deliveryStatus.filter((status) => status === 'delivered').length
    : 0
  const stopCount = Math.max(Array.isArray(deliveryStatus) ? deliveryStatus.length : 0, 1)
  const progressRatio = deliveredStops / stopCount
  const distancePenaltyKm = Math.max(0.8, Number((1 + progressRatio * 2.2).toFixed(1)))
  const kmSavedVsManual = Number((distancePenaltyKm + 0.6).toFixed(1))
  const estimatedUnloadMinutes = Math.max(
    6,
    Math.round(
      toFiniteNumber(loadStats?.targetUnloadCount, 0) * 2.9 +
      toFiniteNumber(loadStats?.emptyReturnCount, 0) * 1.4 +
      5,
    ),
  )
  const estimatedUnloadMinutesSaved = Math.round(
    (toFiniteNumber(loadStats?.targetUnloadCount, 0) * 2.5) +
    (toFiniteNumber(loadStats?.emptyReturnCount, 0) * 1.1) +
    (selectedStopIndex <= 1 ? 4 : 2),
  )
  const co2ProjectionKg = Number((distancePenaltyKm * HEURISTIC_CONSTANTS.co2PerKmKg).toFixed(1))
  const co2SavedKg = Number((kmSavedVsManual * HEURISTIC_CONSTANTS.co2PerKmKg).toFixed(1))

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    distancePenaltyKm,
    kmSavedVsManual,
    estimatedUnloadMinutes,
    estimatedUnloadMinutesSaved,
    occupancyPercent: toFiniteNumber(loadStats?.occupancyPercent, 0),
    co2ProjectionKg,
    co2SavedKg,
  }
}

export function buildExplainabilityInsights({
  stopAddress = 'Current stop',
  loadStats = {},
  operationalKpis = {},
  deliveryStatus = [],
} = {}) {
  const deliveredStops = Array.isArray(deliveryStatus)
    ? deliveryStatus.filter((status) => status === 'delivered').length
    : 0
  const totalStops = Math.max(Array.isArray(deliveryStatus) ? deliveryStatus.length : 0, 1)
  const progressPercent = Math.round((deliveredStops / totalStops) * 100)
  const clientLabel = String(stopAddress).split(',')[0] ?? 'client'

  const insights = [
    `Trade-off applied: route can add ~${operationalKpis.distancePenaltyKm ?? 1} km, but saves ~${operationalKpis.estimatedUnloadMinutesSaved ?? 8} minutes by keeping lateral access clear for ${clientLabel}.`,
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

  insights.push(`Operational snapshot: ${operationalKpis.occupancyPercent ?? 0}% occupancy, route progress ${progressPercent}%, projected CO2 impact ~${operationalKpis.co2ProjectionKg ?? 0} kg for the chosen trade-off.`)
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

  const slots = []
  for (let row = 0; row <= maxRow; row += 1) {
    for (let col = 0; col <= maxCol; col += 1) {
      const key = `${row}-${col}`
      const timeline = (slotTimeline.get(key) ?? []).sort((a, b) => a.sequence - b.sequence)
      const upcoming = timeline.find((entry) => entry.sequence > progressStop)
      const delivered = timeline.filter((entry) => entry.sequence <= progressStop)
      const stopSequences = [...new Set(timeline.map((entry) => entry.sequence))].sort(
        (a, b) => a - b,
      )
      const sideCode = getSideCode(col, maxCol)
      const depth = getDepthLabel(row, maxRow)
      const slotId = `R${row + 1}-${sideCode}`
      let status = 'empty'
      let assignment = 'Reserved empty slot'
      let access = getAccessLabel(col, maxCol)
      let upcomingSequence = null
      let product = null
      let reason = ''
      let label = 'Reserved slot'
      let skuCount = 0

      if (upcoming) {
        status = 'active'
        upcomingSequence = upcoming.sequence
        product = upcoming.product
        skuCount = toFiniteNumber(upcoming?.skuCount, 8)
        label = upcoming?.label ?? `${skuCount} SKUs`
        const group = getProductGroupName(upcoming.product)
        assignment = `${group} - Stop ${upcoming.sequence} (${upcoming.stopName})`
        const lateralNode = col === 0 ? 'left side' : col === maxCol ? 'right side' : 'middle lane'
        reason = upcoming?.reason
          ?? `Stop ${upcoming.sequence}: ${label} placed on the ${lateralNode} at waist-height for easy, fast reaching.`
      } else if (delivered.length > 0) {
        status = 'return_assigned'
        assignment = 'Empty Crate/Keg Return Buffer'
        const returnLoad = delivered.at(-1)
        skuCount = Math.max(1, toFiniteNumber(returnLoad?.skuCount, 4))
        label = `${skuCount} Return SKUs`
        reason = returnLoad?.reason
          ?? 'Space reserved here for the empty crates you will pick up.'
      }

      slots.push({
        key,
        row,
        col,
        slotId,
        depth,
        coordinate: `${slotId} (${depth})`,
        access,
        assignment,
        status,
        upcomingSequence,
        product,
        reason,
        label,
        skuCount,
        stopSequences,
      })
    }
  }

  return {
    slots,
    maxRow,
    maxCol,
  }
}

export function buildManifestExplainability({
  manifest = { slots: [] },
  progressStop = 0,
  loadStats = {},
  operationalKpis = {},
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
  const stackingReason = 'Stacked high to save floor space for returns.'
  const stabilityReason = 'Heaviest items at the bottom for safety.'

  if (reasonLines.length > 0) {
    return [...reasonLines, ergonomicsReason, stackingReason, stabilityReason, reverseReason]
  }

  const fallbackEfficiency = Math.max(
    8,
    Math.round(toFiniteNumber(operationalKpis?.estimatedUnloadMinutesSaved, 10) * 0.9),
  )
  return [
    `Stop ${currentSequence}: ${fallbackEfficiency}% faster unloading by keeping this delivery at the back so it does not block later stops.`,
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

export function computeReturnableSpaceReuse({
  manifest = { slots: [] },
} = {}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  const inUseSlots = slots.filter((slot) => slot.status !== 'empty')
  if (inUseSlots.length === 0) return 0
  const returnAssigned = inUseSlots.filter((slot) => slot.status === 'return_assigned').length
  return Math.round((returnAssigned / inUseSlots.length) * 100)
}

export function buildTruckStatusHeatmap({
  manifest = { slots: [], maxRow: 0, maxCol: 0 },
} = {}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  const maxRow = Number.isFinite(manifest?.maxRow) ? manifest.maxRow : 0
  const maxCol = Number.isFinite(manifest?.maxCol) ? manifest.maxCol : 0
  const rows = maxRow + 1
  const cols = maxCol + 1

  const statusBySlot = new Map()
  slots.forEach((slot) => {
    let status = 'empty'
    if (slot?.status === 'active') status = 'delivery'
    if (slot?.status === 'return_assigned') status = 'returnable'
    const redZone = status === 'returnable' && slot?.col !== 0 && slot?.col !== maxCol
    statusBySlot.set(slot.key, {
      key: slot.key,
      row: slot.row,
      col: slot.col,
      status,
      redZone,
      assignment: slot.assignment,
      access: slot.access,
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
