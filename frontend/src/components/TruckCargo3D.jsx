import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Edges, Html, OrbitControls } from '@react-three/drei'
import mockRoute from '@shared/mock_5_stops.json'

const GRID_COLUMNS = 2
const GRID_LAYERS = 3
const GRID_LENGTH = 8
const CELL = {
  x: 1.32,
  y: 0.92,
  z: 1.1,
}
const GAP = {
  x: 0.18,
  y: 0.08,
  z: 0.14,
}
const BED_THICKNESS = 0.26
const BED_CLEARANCE = 0.32

// Easy swap point for backend algorithm output later.
const LOAD_MANIFEST_MOCK = [
  {
    id: 'mock-1',
    gridPosition: [0, 1, 0],
    size: [1, 1, 1],
    type: 'active',
    status: 'active',
    clientName: 'Client 1',
    skuCount: 6,
    product: 'CERVEZA 33CL',
  },
  {
    id: 'mock-2',
    gridPosition: [1, 1, 0],
    size: [1, 2, 1],
    type: 'active',
    status: 'active',
    clientName: 'Client 1',
    skuCount: 6,
    product: 'AGUA MIX',
  },
  {
    id: 'mock-3',
    gridPosition: [0, 0, 3],
    size: [1, 1, 1],
    type: 'future',
    status: 'future',
    clientName: 'Client 3',
    skuCount: 4,
    product: 'LATA 50CL',
  },
  {
    id: 'mock-4',
    gridPosition: [1, 0, 5],
    size: [1, 1, 1],
    type: 'returnable',
    status: 'returnable',
    clientName: 'Client 4',
    skuCount: 2,
    product: 'RETURNABLE CRATES',
  },
]

function getSlotKey(row, col) {
  return `${row}-${col}`
}

function hashString(value = '') {
  let hash = 0
  for (let index = 0; index < String(value).length; index += 1) {
    hash = ((hash << 5) - hash) + String(value).charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function parseClientName(assignment = '', fallback = 'Current Client') {
  const match = String(assignment).match(/\(([^)]+)\)/)
  if (match?.[1]) return match[1]
  return fallback
}

function normalizeCargoItems(cargo) {
  if (!Array.isArray(cargo)) return []
  return cargo.map((item, index) => ({
    ...item,
    row: Number(item?.position?.row ?? item?.row ?? item?.z ?? 0),
    col: Number(item?.position?.col ?? item?.col ?? item?.x ?? index),
    product: item?.product ?? item?.label ?? null,
    type: item?.type ?? 'full',
  }))
}

function getTypeFromManifestSlot(slot, progressStop) {
  if (slot?.status === 'return_assigned') return 'returnable'
  if (slot?.status === 'active') {
    const currentStop = Number(progressStop) + 1
    const slotStop = Number(slot?.upcomingSequence)
    if (!Number.isFinite(slotStop) || slotStop === currentStop) {
      return 'active'
    }
    return 'future'
  }
  return 'empty'
}

function buildVolumetricManifest({
  manifest,
  cargo = [],
  progressStop = 0,
}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []

  if (slots.length === 0) {
    return LOAD_MANIFEST_MOCK
  }

  const byKey = new Map(
    normalizeCargoItems(cargo).map((item) => [getSlotKey(item.row, item.col), item]),
  )

  return slots
    .filter((slot) => slot.col < GRID_LENGTH && slot.row < GRID_COLUMNS)
    .map((slot, index) => {
      const type = getTypeFromManifestSlot(slot, progressStop)
      if (type === 'empty') return null

      const keyHash = hashString(slot.key)
      const item = byKey.get(slot.key)
      const sizeY = type === 'active'
        ? ((keyHash % 3) === 0 ? 2 : 1)
        : (type === 'future' ? 1 : 1)
      const layerIndex = Math.min(
        GRID_LAYERS - sizeY,
        type === 'active' && sizeY === 1 ? 1 : 0,
      )
      const stopSequence = Number(slot?.upcomingSequence)
      const clientFallback = Number.isFinite(stopSequence) ? `Stop ${stopSequence}` : 'Current Stop'

      return {
        id: `${slot.key}-${index}`,
        gridPosition: [slot.row, layerIndex, slot.col],
        size: [1, sizeY, 1],
        type,
        status: type,
        clientName: parseClientName(slot.assignment, clientFallback),
        skuCount: Math.max(1, Math.round((keyHash % 6) + 2)),
        product: item?.product ?? slot?.product ?? 'Mixed SKU',
      }
    })
    .filter(Boolean)
}

function getGridFootprint() {
  const width = GRID_COLUMNS * CELL.x + (GRID_COLUMNS - 1) * GAP.x
  const length = GRID_LENGTH * CELL.z + (GRID_LENGTH - 1) * GAP.z
  const maxHeight = GRID_LAYERS * CELL.y + (GRID_LAYERS - 1) * GAP.y
  return { width, length, maxHeight }
}

function getBoxWorldPosition(gridPosition, size) {
  const { width, length } = getGridFootprint()
  const [gridX, gridY, gridZ] = gridPosition
  const [sizeX, sizeY, sizeZ] = size
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

function Wheel({ position }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.34, 0.34, 0.24, 28]} />
      <meshStandardMaterial color="#111827" metalness={0.25} roughness={0.72} />
    </mesh>
  )
}

function TruckChassis() {
  const { width, length } = getGridFootprint()
  const cabLength = 1.8
  const cabWidth = Math.max(2.15, width + 0.45)

  return (
    <group>
      <mesh receiveShadow position={[0, BED_CLEARANCE, 0]}>
        <boxGeometry args={[width + 0.32, BED_THICKNESS, length + 0.32]} />
        <meshStandardMaterial color="#1f2937" metalness={0.3} roughness={0.6} />
      </mesh>

      <mesh receiveShadow position={[0, BED_CLEARANCE - 0.22, 0]}>
        <boxGeometry args={[width + 0.82, 0.24, length + 0.62]} />
        <meshStandardMaterial color="#111827" metalness={0.34} roughness={0.55} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, BED_CLEARANCE + 0.58, -(length / 2 + cabLength / 2)]}>
        <boxGeometry args={[cabWidth, 1.25, cabLength]} />
        <meshStandardMaterial color="#374151" metalness={0.22} roughness={0.45} />
      </mesh>

      <mesh position={[0, BED_CLEARANCE + 0.75, -(length / 2 + cabLength / 2 + 0.45)]}>
        <boxGeometry args={[cabWidth * 0.78, 0.45, 0.08]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.75} />
      </mesh>

      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, -(length / 2 + 1.1)]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, -(length / 2 + 1.1)]} />
      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, -0.4]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, -0.4]} />
      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, length / 2 - 0.9]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, length / 2 - 0.9]} />
    </group>
  )
}

function CargoBox({ item }) {
  const { x, y, z, totalX, totalY, totalZ } = getBoxWorldPosition(item.gridPosition, item.size)
  const isReturnable = item.type === 'returnable'
  const isActive = item.type === 'active'
  const isFuture = item.type === 'future'
  const isGoldenZone = (item.gridPosition[0] === 0 || item.gridPosition[0] === GRID_COLUMNS - 1)
    && item.gridPosition[1] === 1

  return (
    <group position={[x, y, z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[totalX, totalY, totalZ]} />
        <meshStandardMaterial
          color={isActive ? '#2563eb' : isFuture ? '#6b7280' : '#f8fafc'}
          emissive={isActive ? '#1d4ed8' : '#0f172a'}
          emissiveIntensity={isActive ? 0.22 : 0.04}
          transparent={!isActive}
          opacity={isReturnable ? 0.08 : isFuture ? 0.45 : 1}
          metalness={0.18}
          roughness={0.48}
        />
        {isReturnable ? <Edges threshold={15} color="#ffffff" /> : null}
      </mesh>

      {isGoldenZone && !isReturnable ? (
        <mesh>
          <boxGeometry args={[totalX + 0.08, totalY + 0.08, totalZ + 0.08]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={0.25}
            transparent
            opacity={0.12}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  )
}

function ActivePalletLabel({ item, skuCount }) {
  const { x, y, z, totalY } = getBoxWorldPosition(item.gridPosition, item.size)
  return (
    <Html position={[x, y + totalY / 2 + 0.55, z]} center distanceFactor={8.5}>
      <div className="active-pallet-label">
        <p className="active-pallet-kicker">Active Stop</p>
        <strong>{item.clientName}</strong>
        <p>{skuCount} SKUs ready to unload</p>
      </div>
    </Html>
  )
}

function CargoScene({ boxes }) {
  const { width, length } = getGridFootprint()
  const activeBoxes = boxes.filter((item) => item.type === 'active')
  const leadActive = activeBoxes[0] ?? null
  const skuCount = activeBoxes.reduce((sum, item) => sum + (item.skuCount ?? 1), 0)

  return (
    <>
      <ambientLight intensity={0.58} />
      <directionalLight castShadow intensity={1.15} position={[7.2, 8.4, 6.4]} />
      <directionalLight intensity={0.45} position={[-5, 4, -6]} />

      <TruckChassis />
      {boxes.map((item) => <CargoBox key={item.id} item={item} />)}
      {leadActive ? <ActivePalletLabel item={leadActive} skuCount={skuCount} /> : null}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, BED_CLEARANCE - 0.9, 0]}>
        <planeGeometry args={[width + 7.5, length + 7.5]} />
        <shadowMaterial opacity={0.24} />
      </mesh>

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={6}
        maxDistance={16}
        minPolarAngle={0.74}
        maxPolarAngle={1.22}
        minAzimuthAngle={-0.95}
        maxAzimuthAngle={0.95}
        target={[0, BED_CLEARANCE + 0.95, 0]}
      />
    </>
  )
}

export default function TruckCargo3D({
  stopData,
  cargo,
  selectedStopId,
  selectedStopIndex,
  manifest = null,
  progressStop = 0,
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

  const activeCargo = Array.isArray(cargo) && cargo.length > 0
    ? cargo
    : selectedMockStop?.cargo ?? []

  const selectedStopKey = selectedStopId ?? selectedMockStop?.stopId ?? `stop-${selectedStopIndex ?? 0}`
  const volumetricBoxes = useMemo(
    () => buildVolumetricManifest({ manifest, cargo: activeCargo, progressStop }),
    [manifest, activeCargo, progressStop],
  )
  const reverseCount = volumetricBoxes.filter((box) => box.type === 'returnable').length

  return (
    <div className="truck-cargo-canvas volumetric-cargo-canvas" aria-label="Volumetric 3D truck cargo viewer">
      <Canvas
        key={selectedStopKey}
        shadows
        camera={{ position: [7.1, 6.4, 8.1], fov: 43, near: 0.1, far: 120 }}
        gl={{ antialias: true, alpha: true }}
      >
        <CargoScene boxes={volumetricBoxes} />
      </Canvas>
      <div className="truck-visual-legend" aria-label="Truck slot legend">
        <div className="legend-item">
          <span className="legend-swatch legend-swatch-active" />
          <span>Blue: Active stop delivery</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch legend-swatch-future" />
          <span>Gray: Future delivery</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch legend-swatch-return" />
          <span>Striped: Reverse logistics returnables</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch legend-swatch-empty" />
          <span>Reverse buffers live: {reverseCount}</span>
        </div>
      </div>
    </div>
  )
}
