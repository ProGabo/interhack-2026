import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { animate } from 'framer-motion'
import mockRoute from '@shared/mock_5_stops.json'
import { resolveGranularCubePayload } from '../adapters/cubeLayout'

const GRID_COLUMNS = 3
const GRID_LAYERS = 3
const GRID_LENGTH = 8
const GAP = {
  x: 0.06,
  y: 0.05,
  z: 0.07,
}
const BED_INNER = {
  width: 2.7,
  height: 1.35,
  length: 8.1,
}
const CELL = {
  x: (BED_INNER.width - ((GRID_COLUMNS - 1) * GAP.x)) / GRID_COLUMNS,
  y: (BED_INNER.height - ((GRID_LAYERS - 1) * GAP.y)) / GRID_LAYERS,
  z: (BED_INNER.length - ((GRID_LENGTH - 1) * GAP.z)) / GRID_LENGTH,
}
const BED_THICKNESS = 0.24
const BED_CLEARANCE = 0.35
const MINI_CUBE_SCALE = 1.0
const ELECTRIC_BLUE = '#1E90FF'
const ELECTRIC_BLUE_EMISSIVE = '#3B82F6'
const ECO_GREEN = '#2D6A4F'
const ECO_GREEN_EMISSIVE = '#1B4332'
const GHOST_GRAY = '#D1D5DB'
const FRICTION_RED = '#EF4444'

function getActionMeta(visualState, blockedByStackAbove) {
  if (blockedByStackAbove) return { actionLabel: 'SIDE LOADING FRICTION' }
  if (visualState === 'empty') return { actionLabel: 'AVAILABLE LAYER' }
  if (visualState === 'current') return { actionLabel: 'DELIVER NOW' }
  if (visualState === 'reverse') return { actionLabel: 'RETURNED LOAD' }
  if (visualState === 'future') return { actionLabel: 'FUTURE STOP' }
  return { actionLabel: 'INACTIVE' }
}

function formatFixed(value, digits = 1) {
  return Number(value).toFixed(digits)
}

function getSlotKey(row, col) {
  return `${row}-${col}`
}

function normalizeCargoItems(cargo) {
  if (!Array.isArray(cargo)) return []
  return cargo.map((item, index) => ({
    ...item,
    row: Number(item?.position?.row ?? item?.row ?? item?.z ?? 0),
    col: Number(item?.position?.col ?? item?.col ?? item?.x ?? index),
    product: item?.product ?? item?.label ?? 'Mixed SKU',
    label: item?.label ?? `${Number(item?.skuCount ?? item?.qty ?? item?.units ?? 8)} SKUs`,
    reason: item?.reason ?? '',
    skuCount: Number(item?.skuCount ?? item?.qty ?? item?.units ?? 8),
    type: item?.type ?? 'full',
  }))
}

function getDenseRenderableLayers(layers = [], maxLayers = GRID_LAYERS) {
  const occupied = layers.filter((layer) => String(layer?.status ?? 'empty') !== 'empty')
  const emptyCount = Math.max(0, maxLayers - occupied.length)
  const emptyLayers = Array.from({ length: emptyCount }, (_, index) => {
    const fallbackLayer = layers.find((layer) => String(layer?.status ?? 'empty') === 'empty') ?? {}
    return {
      ...fallbackLayer,
      status: 'empty',
      layerIndex: occupied.length + index,
      label: fallbackLayer?.label ?? 'Available layer',
      reason: fallbackLayer?.reason ?? 'Free vertical capacity for reverse logistics.',
    }
  })
  return [...occupied, ...emptyLayers]
    .slice(0, maxLayers)
    .map((layer, index) => ({ ...layer, layerIndex: index }))
}

function classifyVisualState({ stopIndex, activeStopIndex, isReverse = false }) {
  if (isReverse) {
    if (Number(stopIndex) < 0) return activeStopIndex > 0 ? 'reverse' : 'future'
    return stopIndex < activeStopIndex ? 'reverse' : 'past'
  }
  if (Number(stopIndex) < 0) return 'empty'
  if (stopIndex < activeStopIndex) return 'past'
  if (stopIndex === activeStopIndex) return 'current'
  return 'future'
}

function isReverseCargoType(item) {
  const marker = String(item?.type ?? item?.product ?? item?.label ?? '').toLowerCase()
  return marker.includes('return') || marker.includes('empty') || marker.includes('vacio')
}

function hasOverlap(startA, sizeA, startB, sizeB) {
  const endA = startA + Math.max(1, sizeA) - 1
  const endB = startB + Math.max(1, sizeB) - 1
  return startA <= endB && startB <= endA
}

function getFootprintCells(item) {
  const xStart = Math.max(0, Number(item?.x ?? 0))
  const zStart = Math.max(0, Number(item?.z ?? 0))
  const yStart = Math.max(0, Number(item?.y ?? 0))
  const width = Math.max(1, Number(item?.width ?? 1))
  const depth = Math.max(1, Number(item?.depth ?? 1))
  const height = Math.max(1, Number(item?.height ?? 1))
  const cells = []
  for (let xi = 0; xi < width; xi += 1) {
    for (let zi = 0; zi < depth; zi += 1) {
      for (let yi = 0; yi < height; yi += 1) {
        cells.push({
          x: xStart + xi,
          y: yStart + yi,
          z: zStart + zi,
        })
      }
    }
  }
  return cells
}

function normalizeRenderableBoxes(items = []) {
  const safeItems = Array.isArray(items) ? items : []
  const nonEmptyOccupancy = new Set()
  const normalized = []

  const hasSupportAtLayer = (box, layerBelow) => {
    const xStart = Math.max(0, Number(box?.x ?? 0))
    const zStart = Math.max(0, Number(box?.z ?? 0))
    const width = Math.max(1, Number(box?.width ?? 1))
    const depth = Math.max(1, Number(box?.depth ?? 1))
    for (let xi = 0; xi < width; xi += 1) {
      for (let zi = 0; zi < depth; zi += 1) {
        const belowKey = `${xStart + xi}:${layerBelow}:${zStart + zi}`
        if (!nonEmptyOccupancy.has(belowKey)) return false
      }
    }
    return true
  }

  safeItems.forEach((item) => {
    const draft = {
      ...item,
      x: Math.max(0, Math.min(GRID_COLUMNS - 1, Number(item?.x ?? 0))),
      z: Math.max(0, Math.min(GRID_LENGTH - 1, Number(item?.z ?? 0))),
      y: Math.max(0, Math.min(GRID_LAYERS - 1, Number(item?.y ?? 0))),
      width: Math.max(1, Number(item?.width ?? 1)),
      depth: Math.max(1, Number(item?.depth ?? 1)),
      height: Math.max(1, Number(item?.height ?? 1)),
      supportAdjusted: false,
      collisionAdjusted: false,
    }
    draft.width = Math.min(draft.width, GRID_COLUMNS - draft.x)
    draft.depth = Math.min(draft.depth, GRID_LENGTH - draft.z)
    draft.height = Math.min(draft.height, GRID_LAYERS - draft.y)

    if (draft.type !== 'empty') {
      while (draft.y > 0 && !hasSupportAtLayer(draft, draft.y - 1)) {
        draft.y -= 1
        draft.supportAdjusted = true
      }

      let attempts = 0
      while (attempts < GRID_LAYERS) {
        const occupiedCells = getFootprintCells(draft)
        const hasCollision = occupiedCells.some((cell) => nonEmptyOccupancy.has(`${cell.x}:${cell.y}:${cell.z}`))
        if (!hasCollision) break
        if (draft.y > 0) {
          draft.y -= 1
          draft.collisionAdjusted = true
          attempts += 1
          continue
        }
        break
      }

      getFootprintCells(draft).forEach((cell) => nonEmptyOccupancy.add(`${cell.x}:${cell.y}:${cell.z}`))
    }
    normalized.push(draft)
  })
  return normalized
}

function enrichBoxInteractions(items) {
  const safeItems = normalizeRenderableBoxes(items)
  return safeItems.map((item) => {
    const blockedByStackAbove = safeItems.some((candidate) => {
      if (candidate?.id === item?.id) return false
      if (String(candidate?.type) === 'empty') return false
      const candidateY = Number(candidate?.y ?? 0)
      const itemY = Number(item?.y ?? 0)
      if (candidateY <= itemY) return false
      const xOverlap = hasOverlap(
        Number(item?.x ?? 0),
        Number(item?.width ?? 1),
        Number(candidate?.x ?? 0),
        Number(candidate?.width ?? 1),
      )
      const zOverlap = hasOverlap(
        Number(item?.z ?? 0),
        Number(item?.depth ?? 1),
        Number(candidate?.z ?? 0),
        Number(candidate?.depth ?? 1),
      )
      return xOverlap && zOverlap
    })
    const { actionLabel } = getActionMeta(item?.visualState, blockedByStackAbove)
    const quantity = Math.max(0, Number(item?.skuCount ?? 0))
    const weightKg = Number(item?.weightKg ?? quantity * 0.85)
    const volumeM3 = Number(item?.volumeM3 ?? Math.max(0.04, quantity * 0.028))

    return {
      ...item,
      blockedByStackAbove,
      actionLabel,
      productType: item?.product ?? item?.label ?? 'Mixed SKU',
      quantityLabel: `${quantity} units`,
      quantityUnits: quantity,
      weightLabel: `${formatFixed(weightKg, 1)} kg`,
      volumeLabel: `${formatFixed(volumeM3, 2)} m3`,
      unloadInstruction: item?.reason ?? 'Maintain side-curtain access and follow stop discharge order.',
      hoverId: `box-${item?.id ?? `${item?.x}-${item?.y}-${item?.z}`}`,
    }
  })
}

function enrichCubeInteractions(cubes) {
  const safeCubes = Array.isArray(cubes) ? cubes : []
  return safeCubes.map((cube, index) => {
    const blockedByStackAbove = safeCubes.some((candidate, candidateIndex) => {
      if (candidateIndex === index) return false
      const sameX = Number(candidate?.x ?? 0) === Number(cube?.x ?? 0)
      const sameY = Number(candidate?.y ?? 0) === Number(cube?.y ?? 0)
      const above = Number(candidate?.z ?? 0) > Number(cube?.z ?? 0)
      return sameX && sameY && above
    })
    const { actionLabel } = getActionMeta(cube?.visualState, blockedByStackAbove)
    const quantity = Math.max(1, Number(cube?.qty ?? cube?.units ?? cube?.skuCount ?? 1))
    const weightKg = Number(cube?.weightKg ?? quantity * 0.82)
    const volumeM3 = Number(cube?.volumeM3 ?? Math.max(0.04, quantity * 0.024))

    return {
      ...cube,
      blockedByStackAbove,
      actionLabel,
      productType: cube?.product_id ?? cube?.product ?? cube?.label ?? 'Mixed SKU',
      quantityLabel: `${quantity} units`,
      quantityUnits: quantity,
      weightLabel: `${formatFixed(weightKg, 1)} kg`,
      volumeLabel: `${formatFixed(volumeM3, 2)} m3`,
      unloadInstruction: cube?.reason ?? 'Unload by route order and keep lateral lane clear for next stop.',
      hoverId: `cube-${cube?.product_id ?? index}-${cube?.x ?? 0}-${cube?.y ?? 0}-${cube?.z ?? 0}`,
    }
  })
}

function buildScheduleDrivenBoxes(routeStops, activeStopIndex) {
  if (!Array.isArray(routeStops) || routeStops.length === 0) return []
  const boxes = []
  let slotIndex = 0

  function nextSlotPosition() {
    const x = slotIndex % GRID_COLUMNS
    const z = Math.floor(slotIndex / GRID_COLUMNS) % GRID_LENGTH
    const y = Math.floor(slotIndex / (GRID_COLUMNS * GRID_LENGTH)) % GRID_LAYERS
    slotIndex += 1
    return { x, y, z }
  }

  routeStops.forEach((stop, stopIndex) => {
    const cargoItems = Array.isArray(stop?.cargo) ? stop.cargo : []
    cargoItems.forEach((item, itemIndex) => {
      const isReverse = isReverseCargoType(item)
      const shouldRender = isReverse ? stopIndex < activeStopIndex : stopIndex >= activeStopIndex
      if (!shouldRender) return
      const slot = nextSlotPosition()

      boxes.push({
        id: `${stop?.stopId ?? `stop-${stopIndex + 1}`}-${item?.id ?? itemIndex}`,
        x: slot.x,
        y: slot.y,
        z: slot.z,
        width: 1,
        depth: 1,
        height: 1,
        label: item?.label ?? item?.product ?? `Pallet ${itemIndex + 1}`,
        reason: item?.reason ?? '',
        skuCount: Number(item?.skuCount ?? item?.qty ?? item?.units ?? 1),
        product: item?.product ?? item?.label ?? 'Mixed SKU',
        stopIndex,
        isReverse,
      })
    })
  })

  return boxes
}

function buildTruckLoadManifest({
  manifest,
  cargo = [],
  progressStop = 0,
}) {
  const layeredSlots = Array.isArray(manifest?.layeredSlots) ? manifest.layeredSlots : []
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []
  if (layeredSlots.length === 0 && slots.length === 0) {
    return []
  }

  const byKey = new Map(normalizeCargoItems(cargo).map((item) => [getSlotKey(item.row, item.col), item]))
  const sourceSlots = layeredSlots.length > 0
    ? layeredSlots
    : slots.map((slot) => ({
      ...slot,
      layers: [{
        ...slot,
        layerIndex: 0,
        status: slot.status,
      }],
    }))

  return sourceSlots
    .filter((slot) => Number(slot?.col ?? 0) < GRID_LENGTH && Number(slot?.row ?? 0) < GRID_COLUMNS)
    .flatMap((slot, slotIndex) => {
      const item = byKey.get(slot.key)
      const sourceLayers = Array.isArray(slot?.layers) ? slot.layers : []
      const layers = getDenseRenderableLayers(sourceLayers, Math.min(GRID_LAYERS, sourceLayers.length || GRID_LAYERS))
      return layers.map((layer) => {
        const layerIndex = Math.max(0, Number(layer?.layerIndex ?? 0))
        const status = String(layer?.status ?? 'empty')
        const type = status === 'active' ? 'active' : status === 'return_assigned' ? 'returnable' : 'empty'
        const skuCount = Math.max(0, Number(layer?.skuCount ?? item?.skuCount ?? 0))
        const label = layer?.label ?? (type === 'empty' ? 'Available layer' : `${Math.max(1, skuCount)} SKUs`)
        const stopSequence = Number(layer?.upcomingSequence ?? layer?.sequence)
        const fallbackReturnStop = Math.max(0, Number(progressStop) - 1)
        const stopIndex = Number.isFinite(stopSequence)
          ? Math.max(0, stopSequence - 1)
          : type === 'returnable' ? fallbackReturnStop : -1
        const defaultReason = type === 'empty'
          ? 'Free vertical capacity for reverse logistics.'
          : `Stop ${layer?.upcomingSequence ?? progressStop + 1}: ${label} aligned for side-curtain unloading order.`
        return {
          id: `${slot.key}-${layerIndex}-${slotIndex}`,
          x: Math.max(0, Math.min(GRID_COLUMNS - 1, Number(slot.row))),
          y: Math.max(0, Math.min(GRID_LAYERS - 1, layerIndex)),
          z: Math.max(0, Math.min(GRID_LENGTH - 1, Number(slot.col))),
          width: 1,
          height: 1,
          depth: 1,
          type,
          label,
          reason: String(layer?.reason ?? item?.reason ?? defaultReason),
          skuCount,
          product: layer?.product ?? item?.product ?? 'Mixed SKU',
          stopIndex,
          isReverse: type === 'returnable',
        }
      })
    })
}

function getGridFootprint() {
  const width = GRID_COLUMNS * CELL.x + (GRID_COLUMNS - 1) * GAP.x
  const length = GRID_LENGTH * CELL.z + (GRID_LENGTH - 1) * GAP.z
  const maxHeight = GRID_LAYERS * CELL.y + (GRID_LAYERS - 1) * GAP.y
  return { width, length, maxHeight }
}

function getBoxWorldPosition(item) {
  const { width, length } = getGridFootprint()
  const gridX = Number(item?.x ?? 0)
  const gridY = Number(item?.y ?? 0)
  const gridZ = Number(item?.z ?? 0)
  const sizeX = Number(item?.width ?? 1)
  const sizeY = Number(item?.height ?? 1)
  const sizeZ = Number(item?.depth ?? 1)
  const totalX = sizeX * CELL.x + (sizeX - 1) * GAP.x
  const totalY = sizeY * CELL.y + (sizeY - 1) * GAP.y
  const totalZ = sizeZ * CELL.z + (sizeZ - 1) * GAP.z

  const originX = -(width / 2) + (CELL.x / 2)
  const originZ = -(length / 2) + (CELL.z / 2)
  const x = originX + gridX * (CELL.x + GAP.x)
  const y = BED_CLEARANCE + BED_THICKNESS + (totalY / 2) + (gridY * (CELL.y + GAP.y))
  const z = originZ + gridZ * (CELL.z + GAP.z)

  return { x, y, z, totalX, totalY, totalZ }
}

function getMiniCubePosition(cube, dim) {
  const { width, length } = getGridFootprint()
  const safeL = Math.max(1, Number(dim?.L ?? 1))
  const safeW = Math.max(1, Number(dim?.W ?? 1))
  const safeH = Math.max(1, Number(dim?.H ?? 1))
  const unitX = width / safeL
  const unitZ = length / safeW
  const unitY = Math.max(0.26, (Math.min(unitX, unitZ) * MINI_CUBE_SCALE) / safeH)
  const offsetX = -(width / 2) + unitX / 2
  const offsetZ = -(length / 2) + unitZ / 2
  const sx = Math.max(0.28, unitX * 0.95)
  const sz = Math.max(0.24, unitZ * 0.9)
  return {
    x: offsetX + Number(cube?.x ?? 0) * unitX,
    y: BED_CLEARANCE + BED_THICKNESS + unitY / 2 + Number(cube?.z ?? 0) * (unitY * 0.92),
    z: offsetZ + Number(cube?.y ?? 0) * unitZ,
    sx,
    sy: unitY,
    sz,
  }
}

function Wheel({ position, scale = [1, 1, 1] }) {
  return (
    <mesh position={position} scale={scale} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.34, 0.34, 0.24, 28]} />
      <meshStandardMaterial color="#0f172a" metalness={0.22} roughness={0.78} />
    </mesh>
  )
}

function TruckChassis() {
  const { width, length } = getGridFootprint()
  const cabLength = 0.72
  const cabWidth = Math.max(1.45, width + 0.12)
  const cabHeight = 0.98
  const chassisMargin = 0.24
  const bedLength = length + (chassisMargin * 2)
  const sideWallLength = bedLength + 0.02
  const cabBaseZ = -((bedLength / 2) + (cabLength / 2) + 0.1)
  const rearWallZ = (bedLength / 2) + 0.01
  const frontAxleZ = -(bedLength / 2) + 0.68
  const rearAxlePrimaryZ = (bedLength / 2) - 0.3
  const rearAxleSecondaryZ = rearAxlePrimaryZ - 0.58

  return (
    <group>
      <mesh receiveShadow position={[0, BED_CLEARANCE - 0.25, -0.25]}>
        <boxGeometry args={[width + 0.88, 0.28, bedLength + 1.05]} />
        <meshStandardMaterial color="#1f2937" metalness={0.08} roughness={0.88} />
      </mesh>

      <mesh receiveShadow position={[0, BED_CLEARANCE, 0]}>
        <boxGeometry args={[width + 0.24, BED_THICKNESS, bedLength]} />
        <meshStandardMaterial color="#475569" metalness={0.1} roughness={0.84} />
      </mesh>

      <mesh receiveShadow position={[0, BED_CLEARANCE - 0.22, 0]}>
        <boxGeometry args={[width + 0.78, 0.24, bedLength + 0.5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.08} roughness={0.86} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, BED_CLEARANCE + 0.56, cabBaseZ]}>
        <boxGeometry args={[cabWidth, cabHeight, cabLength]} />
        <meshStandardMaterial color="#e30613" metalness={0.06} roughness={0.9} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, BED_CLEARANCE + 1.08, cabBaseZ - 0.08]}>
        <boxGeometry args={[cabWidth * 0.78, 0.24, cabLength * 0.78]} />
        <meshStandardMaterial color="#dc2626" metalness={0.06} roughness={0.9} />
      </mesh>

      <mesh position={[0, BED_CLEARANCE + 0.58, cabBaseZ - 0.4]}>
        <boxGeometry args={[cabWidth * 0.72, 0.42, 0.07]} />
        <meshStandardMaterial color="#dbeafe" transparent opacity={0.76} />
      </mesh>

      <mesh position={[-(cabWidth / 2 + 0.09), BED_CLEARANCE + 0.74, cabBaseZ - 0.02]}>
        <boxGeometry args={[0.06, 0.28, 0.18]} />
        <meshStandardMaterial color="#020617" metalness={0.18} roughness={0.7} />
      </mesh>
      <mesh position={[cabWidth / 2 + 0.09, BED_CLEARANCE + 0.74, cabBaseZ - 0.02]}>
        <boxGeometry args={[0.06, 0.28, 0.18]} />
        <meshStandardMaterial color="#020617" metalness={0.18} roughness={0.7} />
      </mesh>

      <mesh position={[-0.36, BED_CLEARANCE + 0.32, cabBaseZ - 0.5]}>
        <boxGeometry args={[0.16, 0.08, 0.08]} />
        <meshStandardMaterial color="#f8fafc" emissive="#e30613" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0.36, BED_CLEARANCE + 0.32, cabBaseZ - 0.5]}>
        <boxGeometry args={[0.16, 0.08, 0.08]} />
        <meshStandardMaterial color="#f8fafc" emissive="#e30613" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, BED_CLEARANCE + 0.12, cabBaseZ - 0.52]}>
        <boxGeometry args={[cabWidth * 0.82, 0.1, 0.12]} />
        <meshStandardMaterial color="#111827" metalness={0.22} roughness={0.68} />
      </mesh>

      <mesh position={[-(width / 2 + 0.06), BED_CLEARANCE + BED_THICKNESS + 0.02, 0]}>
        <boxGeometry args={[0.03, 0.04, sideWallLength]} />
        <meshStandardMaterial color="#bfdbfe" emissive="#60a5fa" emissiveIntensity={0.22} transparent opacity={0.85} />
      </mesh>
      <mesh position={[width / 2 + 0.06, BED_CLEARANCE + BED_THICKNESS + 0.02, 0]}>
        <boxGeometry args={[0.03, 0.04, sideWallLength]} />
        <meshStandardMaterial color="#bfdbfe" emissive="#60a5fa" emissiveIntensity={0.22} transparent opacity={0.85} />
      </mesh>
      <mesh position={[-(width / 2 + 0.14), BED_CLEARANCE + 0.56, 0]}>
        <boxGeometry args={[0.02, 0.82, sideWallLength]} />
        <meshPhysicalMaterial color="#dbeafe" transparent opacity={0.12} roughness={0.1} metalness={0.04} transmission={0.8} ior={1.18} />
      </mesh>
      <mesh position={[width / 2 + 0.14, BED_CLEARANCE + 0.56, 0]}>
        <boxGeometry args={[0.02, 0.82, sideWallLength]} />
        <meshPhysicalMaterial color="#dbeafe" transparent opacity={0.12} roughness={0.1} metalness={0.04} transmission={0.8} ior={1.18} />
      </mesh>

      <mesh position={[0, BED_CLEARANCE + 0.55, rearWallZ]}>
        <boxGeometry args={[width + 0.26, 0.78, 0.06]} />
        <meshStandardMaterial color="#334155" metalness={0.08} roughness={0.85} />
      </mesh>

      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, frontAxleZ]} scale={[1, 1, 1]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, frontAxleZ]} scale={[1, 1, 1]} />
      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, rearAxleSecondaryZ]} scale={[1, 1, 1.02]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, rearAxleSecondaryZ]} scale={[1, 1, 1.02]} />
      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, rearAxlePrimaryZ]} scale={[1, 1, 1.05]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, rearAxlePrimaryZ]} scale={[1, 1, 1.05]} />
    </group>
  )
}

function CargoBox({
  item,
  shouldAnimate,
  animateToken,
  hovered,
  blockedByStackAbove,
  onEnter,
  onLeave,
}) {
  const { x, y, z, totalX, totalY, totalZ } = getBoxWorldPosition(item)
  const groupRef = useRef(null)
  const materialRef = useRef(null)
  const isReverse = item.visualState === 'reverse'
  const isCurrent = item.visualState === 'current'
  const isFuture = item.visualState === 'future'
  const isEmpty = item.visualState === 'empty' || item.type === 'empty'

  useFrame(({ clock }) => {
    if (!materialRef.current) return
    if (blockedByStackAbove) {
      const frictionPulse = 0.16 + (Math.sin(clock.elapsedTime * 7.8) * 0.07)
      materialRef.current.emissive.set(FRICTION_RED)
      materialRef.current.emissiveIntensity = Math.max(0.08, frictionPulse)
      return
    }
    if (isEmpty) {
      materialRef.current.emissive.set('#6b7280')
      materialRef.current.emissiveIntensity = 0.02
      return
    }
    if (hovered) {
      const glow = 0.32 + (Math.sin(clock.elapsedTime * 7.2) * 0.1)
      materialRef.current.emissive.set('#e2e8f0')
      materialRef.current.emissiveIntensity = Math.max(0.14, glow)
      return
    }
    if (isCurrent) {
      const pulse = 0.6 + (Math.sin(clock.elapsedTime * 5.6) * 0.22)
      materialRef.current.emissive.set(ELECTRIC_BLUE_EMISSIVE)
      materialRef.current.emissiveIntensity = Math.max(0.35, pulse)
      return
    }
    if (isReverse) {
      materialRef.current.emissive.set(ECO_GREEN_EMISSIVE)
      materialRef.current.emissiveIntensity = 0.05
      return
    }
    materialRef.current.emissive.set('#1f2937')
    materialRef.current.emissiveIntensity = 0.02
  }, [hovered, blockedByStackAbove, isCurrent, isReverse, isEmpty])

  useEffect(() => {
    if (!groupRef.current) return () => {}
    if (!shouldAnimate) {
      groupRef.current.scale.set(1, 1, 1)
      groupRef.current.position.set(x, y, z)
      return () => {}
    }

    groupRef.current.scale.set(0.82, 0.82, 0.82)
    groupRef.current.position.set(x, y + 0.14, z)
    const controls = animate(0, 1, {
      duration: 0.34,
      ease: 'easeOut',
      onUpdate: (latest) => {
        const scale = 0.82 + (latest * 0.18)
        groupRef.current?.scale.set(scale, scale, scale)
        groupRef.current?.position.set(x, y + ((1 - latest) * 0.14), z)
      },
    })
    return () => controls.stop()
  }, [shouldAnimate, animateToken, x, y, z])

  return (
    <group ref={groupRef} position={[x, y, z]}>
      <mesh
        castShadow
        receiveShadow
        onPointerEnter={(event) => {
          event.stopPropagation()
          onEnter?.(event)
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          onLeave?.()
        }}
      >
        <boxGeometry args={[totalX, totalY, totalZ]} />
        <meshStandardMaterial
          ref={materialRef}
          color={isEmpty ? '#cbd5e1' : isCurrent ? ELECTRIC_BLUE : isReverse ? ECO_GREEN : isFuture ? GHOST_GRAY : '#b91c1c'}
          emissive={isCurrent ? ELECTRIC_BLUE_EMISSIVE : isReverse ? ECO_GREEN_EMISSIVE : '#1f2937'}
          emissiveIntensity={isCurrent ? 0.58 : 0.03}
          transparent={isFuture || isEmpty}
          opacity={isEmpty ? 0.08 : isFuture ? 0.3 : 1}
          metalness={0.05}
          roughness={isReverse ? 0.95 : 0.74}
        />
      </mesh>
      {isFuture || isEmpty ? (
        <mesh scale={[1.01, 1.01, 1.01]}>
          <boxGeometry args={[totalX, totalY, totalZ]} />
          <meshBasicMaterial color={isEmpty ? '#9ca3af' : '#ffffff'} wireframe transparent opacity={isEmpty ? 0.45 : 0.28} />
        </mesh>
      ) : null}
    </group>
  )
}

function FadingPoofBox({ item, animateToken }) {
  const { x, y, z, totalX, totalY, totalZ } = getBoxWorldPosition(item)
  const groupRef = useRef(null)
  const materialRef = useRef(null)

  useEffect(() => {
    if (!groupRef.current || !materialRef.current) return () => {}
    groupRef.current.scale.set(1, 1, 1)
    materialRef.current.opacity = 0.3

    const controls = animate(0, 1, {
      duration: 0.38,
      ease: 'easeOut',
      onUpdate: (latest) => {
        const scale = 1 - (latest * 0.35)
        groupRef.current?.scale.set(scale, scale, scale)
        groupRef.current?.position.set(x, y + (latest * 0.18), z)
        if (materialRef.current) {
          materialRef.current.opacity = 0.3 * (1 - latest)
        }
      },
    })
    return () => controls.stop()
  }, [animateToken, x, y, z])

  return (
    <group ref={groupRef} position={[x, y, z]}>
      <mesh>
        <boxGeometry args={[totalX, totalY, totalZ]} />
        <meshStandardMaterial
          ref={materialRef}
          color="#60a5fa"
          emissive="#2563eb"
          emissiveIntensity={0.25}
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function CargoScene({
  boxes,
  fadingBoxes = [],
  enableTransition,
  animateToken,
  hoveredId,
  selectedStopIndex,
  onHoverChange,
}) {
  const { width, length } = getGridFootprint()

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight castShadow intensity={1.25} position={[0, 10, 0]} />
      <directionalLight intensity={0.38} position={[6.2, 4.8, 5.4]} />

      <TruckChassis />
      {boxes.map((item) => (
        <CargoBox
          key={enableTransition ? `${item.id}-${item.type}-${animateToken}` : item.id}
          item={item}
          shouldAnimate={enableTransition}
          animateToken={animateToken}
          hovered={hoveredId === item.hoverId}
          blockedByStackAbove={item.blockedByStackAbove}
          onEnter={(event) => onHoverChange?.(item, event)}
          onLeave={() => onHoverChange?.(null)}
        />
      ))}
      {fadingBoxes.map((item) => (
        <FadingPoofBox key={`poof-${item.id}-${animateToken}`} item={item} animateToken={animateToken} />
      ))}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, BED_CLEARANCE - 0.9, 0]}>
        <planeGeometry args={[width + 3.2, length + 3.2]} />
        <shadowMaterial opacity={0.24} />
      </mesh>

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={3.8}
        maxDistance={8.4}
        minPolarAngle={0.8}
        maxPolarAngle={1.2}
        target={[0, BED_CLEARANCE + 0.72, 0.08]}
      />
    </>
  )
}

function MiniCube({ cube, dim, faded, hovered, blockedByStackAbove, onEnter, onLeave }) {
  const pos = getMiniCubePosition(cube, dim)
  const materialRef = useRef(null)
  const isCurrent = cube.visualState === 'current'
  const isFuture = cube.visualState === 'future'
  const isReverse = cube.visualState === 'reverse'

  useFrame(({ clock }) => {
    if (!materialRef.current) return
    if (blockedByStackAbove) {
      const frictionPulse = 0.14 + (Math.sin(clock.elapsedTime * 7.6) * 0.07)
      materialRef.current.emissive.set(FRICTION_RED)
      materialRef.current.emissiveIntensity = Math.max(0.08, frictionPulse)
      return
    }
    if (hovered) {
      const glow = 0.28 + (Math.sin(clock.elapsedTime * 6.9) * 0.1)
      materialRef.current.emissive.set('#e2e8f0')
      materialRef.current.emissiveIntensity = Math.max(0.14, glow)
      return
    }
    if (isCurrent) {
      const pulse = 0.56 + (Math.sin(clock.elapsedTime * 5.4) * 0.2)
      materialRef.current.emissive.set(ELECTRIC_BLUE_EMISSIVE)
      materialRef.current.emissiveIntensity = Math.max(0.32, pulse)
      return
    }
    materialRef.current.emissive.set(isReverse ? ECO_GREEN_EMISSIVE : '#1f2937')
    materialRef.current.emissiveIntensity = isReverse ? 0.05 : 0.02
  }, [hovered, blockedByStackAbove, isCurrent, isReverse])

  return (
    <mesh
      position={[pos.x, pos.y, pos.z]}
      castShadow
      onPointerEnter={(event) => {
        event.stopPropagation()
        onEnter(event)
      }}
      onPointerLeave={onLeave}
    >
      <boxGeometry args={[pos.sx, pos.sy, pos.sz]} />
      <meshStandardMaterial
        ref={materialRef}
        color={isCurrent ? ELECTRIC_BLUE : isReverse ? ECO_GREEN : isFuture ? GHOST_GRAY : '#b91c1c'}
        emissive={isCurrent ? ELECTRIC_BLUE_EMISSIVE : isReverse ? ECO_GREEN_EMISSIVE : '#1f2937'}
        emissiveIntensity={isCurrent ? 0.54 : 0.03}
        roughness={isReverse ? 0.95 : 0.74}
        metalness={0.04}
        transparent={faded}
        opacity={faded ? 0.22 : isFuture ? 0.3 : 1}
      />
      {isFuture ? (
        <mesh scale={[1.01, 1.01, 1.01]}>
          <boxGeometry args={[pos.sx, pos.sy, pos.sz]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.26} />
        </mesh>
      ) : null}
    </mesh>
  )
}

function GranularCubeScene({
  cubes,
  cubeGrid,
  activeStopIndex,
  hoveredId,
  selectedStopIndex,
  onHoverChange,
}) {
  const rows = Math.max(1, Math.ceil((Number(cubeGrid?.W ?? 1)) / 3))
  const cols = Math.max(1, Math.ceil((Number(cubeGrid?.L ?? 1)) / 3))

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight castShadow intensity={1.2} position={[0, 10, 0]} />
      <directionalLight intensity={0.36} position={[6, 4.5, 5]} />
      <TruckChassis />

      {cubes.map((cube, index) => (
        <MiniCube
          key={`${cube.product_id ?? 'cube'}-${index}`}
          cube={cube}
          dim={cubeGrid}
          faded={cube.stop_index < activeStopIndex}
          hovered={hoveredId === cube.hoverId}
          blockedByStackAbove={cube.blockedByStackAbove}
          onEnter={(event) => onHoverChange?.(cube, event)}
          onLeave={() => onHoverChange?.(null)}
        />
      ))}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, BED_CLEARANCE - 0.9, 0]}>
        <planeGeometry args={[cols * 2.1, rows * 3.2]} />
        <shadowMaterial opacity={0.24} />
      </mesh>

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={3.8}
        maxDistance={8.4}
        minPolarAngle={0.8}
        maxPolarAngle={1.2}
        target={[0, BED_CLEARANCE + 0.72, 0.08]}
      />
    </>
  )
}

export default function TruckCargo3D({
  stopData,
  cargo,
  routeContext = null,
  deliveryStatus = [],
  selectedStopId,
  selectedStopIndex,
  manifest = null,
  progressStop = 0,
  activeStopIndex = 0,
  processTransitionTrigger = 0,
  progressAction = 'sync',
  onTrackedSlotsChange,
  onHighlightReasonChange,
}) {
  const selectedMockStop =
    mockRoute?.stops?.find((stop, index) => {
      if (selectedStopId && (stop?.stopId === selectedStopId || stop?.id === selectedStopId)) {
        return true
      }
      if (Number.isInteger(selectedStopIndex) && selectedStopIndex >= 0) {
        return index === selectedStopIndex
      }
      return false
    }) ?? mockRoute?.stops?.[0] ?? null

  const activeRouteContext = routeContext ?? mockRoute ?? {}
  const routeStops = Array.isArray(activeRouteContext?.stops) ? activeRouteContext.stops : []
  const activeCargo = Array.isArray(cargo) && cargo.length > 0
    ? cargo
    : selectedMockStop?.cargo ?? []

  const selectedStopKey = selectedStopId ?? selectedMockStop?.stopId ?? `stop-${selectedStopIndex ?? 0}`
  const effectiveActiveStopIndex = Math.max(
    0,
    Math.min(
      Math.max(0, deliveryStatus?.length ?? routeStops.length ?? 0),
      Number.isFinite(activeStopIndex) ? activeStopIndex : progressStop,
    ),
  )
  const scheduleDrivenBoxes = useMemo(
    () => buildScheduleDrivenBoxes(routeStops, effectiveActiveStopIndex),
    [routeStops, effectiveActiveStopIndex],
  )
  const truckLoadManifest = useMemo(
    () => buildTruckLoadManifest({ manifest, cargo: activeCargo, progressStop }),
    [manifest, activeCargo, progressStop],
  )
  const granularPayload = useMemo(
    () =>
      resolveGranularCubePayload({
        cubes: activeRouteContext?.cubes,
        cubeGrid: activeRouteContext?.cube_grid,
        pallets: activeRouteContext?.pallets,
        deliveries: activeRouteContext?.deliveries,
        cargo: activeCargo,
        layout: activeRouteContext?.truck_layout,
        selectedStopIndex,
      }),
    [activeRouteContext, activeCargo, selectedStopIndex],
  )
  const previousManifestRef = useRef([])
  const [fadingBoxes, setFadingBoxes] = useState([])
  const [hoveredPayload, setHoveredPayload] = useState(null)
  const classifiedManifestBoxes = useMemo(
    () =>
      truckLoadManifest.map((item) => ({
        ...item,
        visualState: classifyVisualState({
          stopIndex: Number.isFinite(item?.stopIndex) ? item.stopIndex : effectiveActiveStopIndex,
          activeStopIndex: effectiveActiveStopIndex,
          isReverse: Boolean(item?.isReverse),
        }),
      })),
    [truckLoadManifest, effectiveActiveStopIndex],
  )
  const classifiedScheduleBoxes = useMemo(
    () =>
      scheduleDrivenBoxes.map((item) => ({
        ...item,
        visualState: classifyVisualState({
          stopIndex: Number(item?.stopIndex ?? 0),
          activeStopIndex: effectiveActiveStopIndex,
          isReverse: Boolean(item?.isReverse),
        }),
      })),
    [scheduleDrivenBoxes, effectiveActiveStopIndex],
  )
  const classifiedGranularCubes = useMemo(
    () =>
      granularPayload.cubes.map((cube) => ({
        ...cube,
        visualState: classifyVisualState({
          stopIndex: Number(cube?.stop_index ?? 0),
          activeStopIndex: effectiveActiveStopIndex,
          isReverse: Boolean(cube?.is_reverse),
        }),
      })),
    [granularPayload.cubes, effectiveActiveStopIndex],
  )
  const hasManifestData = Array.isArray(manifest?.layeredSlots)
    ? manifest.layeredSlots.length > 0
    : Array.isArray(manifest?.slots) && manifest.slots.length > 0
  const hasScheduleDrivenData = classifiedScheduleBoxes.length > 0
  const useGranularMode = false
  const renderBoxes = hasManifestData
    ? classifiedManifestBoxes
    : hasScheduleDrivenData
      ? classifiedScheduleBoxes
      : classifiedManifestBoxes
  const visibleGranularCubes = useMemo(
    () => classifiedGranularCubes.filter((item) => item.visualState !== 'past'),
    [classifiedGranularCubes],
  )
  const interactiveBoxes = useMemo(
    () => enrichBoxInteractions(renderBoxes),
    [renderBoxes],
  )
  const interactiveGranularCubes = useMemo(
    () => enrichCubeInteractions(visibleGranularCubes),
    [visibleGranularCubes],
  )
  const activeRenderItems = useGranularMode ? interactiveGranularCubes : interactiveBoxes
  const reverseCount = activeRenderItems
    .filter((item) => item.visualState === 'reverse')
    .length
  const trackedSlots = activeRenderItems
    .filter((item) => item.visualState !== 'past' && item.visualState !== 'empty')
    .length
  const currentStopBoxes = activeRenderItems
    .filter((item) => item.visualState === 'current')
    .length
  const expectedCurrentDeliveries = useMemo(() => {
    const currentStop = routeStops?.[effectiveActiveStopIndex]
    if (!currentStop) return 0
    const currentCargo = Array.isArray(currentStop?.cargo) ? currentStop.cargo : []
    return currentCargo.filter((item) => !isReverseCargoType(item)).length
  }, [routeStops, effectiveActiveStopIndex])
  const shouldAnimateTransition = progressAction === 'process' && processTransitionTrigger > 0
  const hoverSummary = useMemo(() => {
    if (!hoveredPayload) return null
    const hoveredStopIndex = Number(hoveredPayload?.stopIndex ?? hoveredPayload?.stop_index ?? -1)
    const isEmptyLayer = hoveredPayload?.visualState === 'empty' || hoveredPayload?.type === 'empty'
    const hoveredStop = hoveredStopIndex >= 0 ? routeStops?.[hoveredStopIndex] : null
    const stopName = hoveredStop?.location?.address
      ?? hoveredStop?.address
      ?? (isEmptyLayer ? 'Available capacity' : `Stop ${hoveredStopIndex + 1}`)
    return {
      kicker: isEmptyLayer ? 'Open Capacity' : 'Stop Active',
      headline: hoveredPayload.actionLabel,
      detail: `${hoveredPayload.productType} • ${hoveredPayload.quantityLabel}`,
      secondaryDetail: `${isEmptyLayer ? 'Reserve layer' : `Stop #${Math.max(1, hoveredStopIndex + 1)}`} • ${hoveredPayload.weightLabel} • ${hoveredPayload.volumeLabel}`,
      instruction: hoveredPayload.unloadInstruction,
      stopIndex: hoveredStopIndex,
      stopName,
      isEmptyLayer,
    }
  }, [hoveredPayload, routeStops])

  const handleHoverChange = (payload) => {
    setHoveredPayload(payload ?? null)
  }

  useEffect(() => {
    onTrackedSlotsChange?.(trackedSlots)
  }, [trackedSlots, onTrackedSlotsChange])

  useEffect(() => {
    setHoveredPayload((prev) => {
      if (!prev) return null
      const refreshed = activeRenderItems.find((item) => item.hoverId === prev.hoverId)
      return refreshed ?? null
    })
  }, [activeRenderItems, useGranularMode])

  useEffect(() => {
    if (!hoverSummary) {
      onHighlightReasonChange?.('')
      return
    }
    if (hoverSummary.isEmptyLayer) {
      onHighlightReasonChange?.('Available layers are reserved bottom-up for reverse logistics to avoid blocking active deliveries.')
      return
    }
    const sequence = (hoverSummary.stopIndex ?? 0) + 1
    onHighlightReasonChange?.(`Optimal discharge sequence for Stop #${sequence}: ${hoverSummary.stopName}. Highlighted load aligns with side-curtain unloading order.`)
  }, [hoverSummary, onHighlightReasonChange])

  useEffect(() => {
    if (currentStopBoxes !== expectedCurrentDeliveries) {
      console.warn('3D/current stop count mismatch', {
        currentStopBoxes,
        expectedCurrentDeliveries,
        activeStop: effectiveActiveStopIndex + 1,
      })
    }
  }, [currentStopBoxes, expectedCurrentDeliveries, effectiveActiveStopIndex])

  useEffect(() => {
    const previousManifest = previousManifestRef.current ?? []
    const nextManifest = renderBoxes ?? []

    if (shouldAnimateTransition) {
      const previousById = new Map(previousManifest.map((item) => [item.id, item]))
      const poofItems = renderBoxes
        .filter((item) => item.visualState === 'reverse' && previousById.get(item.id)?.visualState === 'current')
        .map((item) => previousById.get(item.id))
        .filter(Boolean)
      setFadingBoxes(poofItems)
      const timeoutId = setTimeout(() => setFadingBoxes([]), 420)
      previousManifestRef.current = nextManifest
      return () => clearTimeout(timeoutId)
    }

    previousManifestRef.current = nextManifest
    setFadingBoxes([])
    return () => {}
  }, [renderBoxes, shouldAnimateTransition])

  return (
    <div
      className="truck-cargo-canvas volumetric-cargo-canvas"
      aria-label="Volumetric 3D truck cargo viewer"
      style={{ position: 'relative' }}
    >
      <Canvas
        key={selectedStopKey}
        shadows
        camera={{ position: [-3.9, 5.2, 4.1], fov: 33, near: 0.1, far: 120 }}
        gl={{ antialias: true, alpha: true }}
      >
        {useGranularMode ? (
          <GranularCubeScene
            cubes={interactiveGranularCubes}
            cubeGrid={granularPayload.cubeGrid}
            activeStopIndex={effectiveActiveStopIndex}
            hoveredId={hoveredPayload?.hoverId ?? null}
            selectedStopIndex={selectedStopIndex}
            onHoverChange={handleHoverChange}
          />
        ) : (
          <CargoScene
            boxes={interactiveBoxes}
            fadingBoxes={fadingBoxes}
            enableTransition={shouldAnimateTransition}
            animateToken={processTransitionTrigger}
            hoveredId={hoveredPayload?.hoverId ?? null}
            selectedStopIndex={selectedStopIndex}
            onHoverChange={handleHoverChange}
          />
        )}
      </Canvas>
      <div
        className="active-pallet-label"
        style={{ position: 'absolute', top: 18, right: 18, zIndex: 5, pointerEvents: 'none' }}
      >
        <p className="active-pallet-kicker">{hoverSummary?.kicker ?? 'Stop Active'}</p>
        <strong>{hoverSummary?.headline ?? `${expectedCurrentDeliveries} units to unload`}</strong>
        {hoverSummary?.detail ? <p>{hoverSummary.detail}</p> : null}
        {hoverSummary?.secondaryDetail ? <p>{hoverSummary.secondaryDetail}</p> : null}
        {hoverSummary?.instruction ? <p>{hoverSummary.instruction}</p> : null}
      </div>
    </div>
  )
}

export { classifyVisualState, buildTruckLoadManifest, normalizeRenderableBoxes }
