import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Edges, Html, OrbitControls } from '@react-three/drei'
import { animate } from 'framer-motion'
import mockRoute from '@shared/mock_5_stops.json'

const GRID_COLUMNS = 2
const GRID_LAYERS = 3
const GRID_LENGTH = 10
const CELL = {
  x: 1.3,
  y: 0.9,
  z: 1,
}
const GAP = {
  x: 0.2,
  y: 0.09,
  z: 0.16,
}
const BED_THICKNESS = 0.24
const BED_CLEARANCE = 0.35

// Easy swap point for backend algorithm output later.
const truckLoadManifestMock = [
  {
    id: 'mock-active-1',
    x: 0,
    y: 1,
    z: 0,
    width: 1,
    height: 1,
    depth: 1,
    type: 'active',
    label: '14 SKUs',
    reason: "Stop 1: 14 SKUs placed at Left-Lateral-Floor for zero-climb access.",
  },
  {
    id: 'mock-active-2',
    x: 1,
    y: 1,
    z: 1,
    width: 1,
    height: 2,
    depth: 1,
    type: 'active',
    label: '9 SKUs',
    reason: "Stop 1: 9 SKUs stacked at Right-Lateral-Level 2 for ergonomic side unloading.",
  },
  {
    id: 'mock-future-1',
    x: 0,
    y: 0,
    z: 4,
    width: 1,
    height: 1,
    depth: 1,
    type: 'future',
    label: '11 SKUs',
    reason: 'Stop 2: Stacked on Level 2 to preserve floor space for heavy returnable kegs.',
  },
  {
    id: 'mock-return-1',
    x: 1,
    y: 0,
    z: 8,
    width: 1,
    height: 1,
    depth: 1,
    type: 'returnable',
    label: '6 Return SKUs',
    reason: 'Reverse Logistics: Reserved for empty crates and kegs on return pickup.',
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

function buildTruckLoadManifest({
  manifest,
  cargo = [],
  progressStop = 0,
}) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : []

  if (slots.length === 0) {
    return truckLoadManifestMock
  }

  const byKey = new Map(
    normalizeCargoItems(cargo).map((item) => [getSlotKey(item.row, item.col), item]),
  )

  const mapped = slots
    .filter((slot) => slot.col < GRID_LENGTH && slot.row < GRID_COLUMNS)
    .map((slot, index) => {
      const type = getTypeFromManifestSlot(slot, progressStop)
      if (type === 'empty') return null

      const keyHash = hashString(slot.key)
      const item = byKey.get(slot.key)
      const skuCount = Math.max(1, Number(slot?.skuCount ?? item?.skuCount ?? ((keyHash % 9) + 6)))
      const height = type === 'active'
        ? (skuCount >= 12 ? 2 : 1)
        : 1
      const y = Math.max(
        0,
        Math.min(
          GRID_LAYERS - height,
          type === 'active' && (keyHash % 4 === 0) ? 1 : 0,
        ),
      )
      const label = slot?.label ?? item?.label ?? `${skuCount} SKUs`
      const defaultReason = `Stop ${slot?.upcomingSequence ?? progressStop + 1}: ${label} placed at ${slot?.coordinate ?? 'lateral floor'} for side-curtain access.`

      return {
        id: slot.key ?? `slot-${index}`,
        x: Math.max(0, Math.min(GRID_COLUMNS - 1, Number(slot.row))),
        y,
        z: Math.max(0, Math.min(GRID_LENGTH - 1, Number(slot.col))),
        width: 1,
        height,
        depth: 1,
        type,
        label,
        reason: String(slot?.reason ?? item?.reason ?? defaultReason),
        skuCount,
        product: item?.product ?? slot?.product ?? 'Mixed SKU',
      }
    })
    .filter(Boolean)

  // Always reserve visible reverse-logistics capacity from the first stop.
  const reservedReturnables = slots
    .filter((slot) => slot.col < GRID_LENGTH && slot.row < GRID_COLUMNS)
    .filter((slot) => slot.status === 'empty' || slot.status === 'return_assigned')
    .filter((slot) => slot.col === GRID_LENGTH - 1 || slot.col === GRID_LENGTH - 2)
    .slice(0, 2)
    .map((slot, index) => ({
      id: `reserved-return-${slot.key}-${index}`,
      x: Math.max(0, Math.min(GRID_COLUMNS - 1, Number(slot.row))),
      y: 0,
      z: Math.max(0, Math.min(GRID_LENGTH - 1, Number(slot.col))),
      width: 1,
      height: 1,
      depth: 1,
      type: 'returnable',
      label: 'Empty Box',
      reason: 'Space reserved here for the empty crates you will pick up.',
      skuCount: 0,
      product: 'Returnables',
    }))

  const byCoordinate = new Set(mapped.map((item) => `${item.x}-${item.y}-${item.z}`))
  reservedReturnables.forEach((item) => {
    const coordKey = `${item.x}-${item.y}-${item.z}`
    if (!byCoordinate.has(coordKey)) {
      mapped.push(item)
      byCoordinate.add(coordKey)
    }
  })

  return mapped
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
  const cabLength = 1.2
  const cabWidth = Math.max(2.25, width + 0.55)
  const cabBaseZ = -(length / 2 + cabLength / 2 + 0.25)

  return (
    <group>
      <mesh receiveShadow position={[0, BED_CLEARANCE - 0.25, -0.25]}>
        <boxGeometry args={[width + 0.95, 0.28, length + 2.25]} />
        <meshStandardMaterial color="#1f2937" metalness={0.34} roughness={0.56} />
      </mesh>

      <mesh receiveShadow position={[0, BED_CLEARANCE, 0]}>
        <boxGeometry args={[width + 0.32, BED_THICKNESS, length + 0.32]} />
        <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.34} />
      </mesh>

      <mesh receiveShadow position={[0, BED_CLEARANCE - 0.22, 0]}>
        <boxGeometry args={[width + 0.82, 0.24, length + 0.62]} />
        <meshStandardMaterial color="#1e293b" metalness={0.36} roughness={0.52} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, BED_CLEARANCE + 0.76, cabBaseZ]}>
        <boxGeometry args={[cabWidth, 1.56, cabLength]} />
        <meshStandardMaterial color="#e30613" metalness={0.26} roughness={0.38} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, BED_CLEARANCE + 1.63, cabBaseZ - 0.12]}>
        <boxGeometry args={[cabWidth * 0.82, 0.36, cabLength * 0.82]} />
        <meshStandardMaterial color="#dc2626" metalness={0.22} roughness={0.42} />
      </mesh>

      <mesh position={[0, BED_CLEARANCE + 0.86, cabBaseZ - 0.63]}>
        <boxGeometry args={[cabWidth * 0.76, 0.68, 0.08]} />
        <meshStandardMaterial color="#dbeafe" transparent opacity={0.76} />
      </mesh>

      <mesh position={[-(cabWidth / 2 + 0.12), BED_CLEARANCE + 1.1, cabBaseZ - 0.08]}>
        <boxGeometry args={[0.08, 0.42, 0.24]} />
        <meshStandardMaterial color="#020617" metalness={0.18} roughness={0.7} />
      </mesh>
      <mesh position={[cabWidth / 2 + 0.12, BED_CLEARANCE + 1.1, cabBaseZ - 0.08]}>
        <boxGeometry args={[0.08, 0.42, 0.24]} />
        <meshStandardMaterial color="#020617" metalness={0.18} roughness={0.7} />
      </mesh>

      <mesh position={[-0.55, BED_CLEARANCE + 0.45, cabBaseZ - 0.92]}>
        <boxGeometry args={[0.22, 0.12, 0.1]} />
        <meshStandardMaterial color="#f8fafc" emissive="#e30613" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0.55, BED_CLEARANCE + 0.45, cabBaseZ - 0.92]}>
        <boxGeometry args={[0.22, 0.12, 0.1]} />
        <meshStandardMaterial color="#f8fafc" emissive="#e30613" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, BED_CLEARANCE + 0.18, cabBaseZ - 0.92]}>
        <boxGeometry args={[cabWidth * 0.84, 0.16, 0.16]} />
        <meshStandardMaterial color="#111827" metalness={0.22} roughness={0.68} />
      </mesh>

      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, -(length / 2 + 1.1)]} scale={[1, 1, 1]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, -(length / 2 + 1.1)]} scale={[1, 1, 1]} />
      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, -0.8]} scale={[1, 1, 1.02]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, -0.8]} scale={[1, 1, 1.02]} />
      <Wheel position={[-(width / 2 + 0.42), BED_CLEARANCE - 0.56, 0.9]} scale={[1, 1, 1.05]} />
      <Wheel position={[width / 2 + 0.42, BED_CLEARANCE - 0.56, 0.9]} scale={[1, 1, 1.05]} />
    </group>
  )
}

function DashedWireframe({ totalX, totalY, totalZ }) {
  const ref = useRef(null)
  const geometry = useMemo(
    () => new THREE.BoxGeometry(totalX + 0.03, totalY + 0.03, totalZ + 0.03),
    [totalX, totalY, totalZ],
  )

  useEffect(() => {
    if (ref.current) {
      ref.current.computeLineDistances()
    }
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments ref={ref}>
      <edgesGeometry args={[geometry]} />
      <lineDashedMaterial color="#ffffff" dashSize={0.14} gapSize={0.1} />
    </lineSegments>
  )
}

function CargoBox({ item, shouldAnimate, animateToken }) {
  const { x, y, z, totalX, totalY, totalZ } = getBoxWorldPosition(item)
  const groupRef = useRef(null)
  const isReturnable = item.type === 'returnable'
  const isActive = item.type === 'active'
  const isFuture = item.type === 'future'
  const isGoldenZone = (item.x === 0 || item.x === GRID_COLUMNS - 1) && item.y === 1

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
      <mesh castShadow receiveShadow>
        <boxGeometry args={[totalX, totalY, totalZ]} />
        <meshStandardMaterial
          color={isActive ? '#2563eb' : isFuture ? '#64748b' : '#ffffff'}
          emissive={isActive ? '#1d4ed8' : '#0f172a'}
          emissiveIntensity={isActive ? 0.18 : 0.03}
          transparent={!isActive}
          opacity={isReturnable ? 0.06 : isFuture ? 0.44 : 1}
          metalness={0.18}
          roughness={0.48}
        />
        {isReturnable ? <Edges threshold={15} color="#ffffff" /> : null}
      </mesh>
      {isReturnable ? <DashedWireframe totalX={totalX} totalY={totalY} totalZ={totalZ} /> : null}

      {isGoldenZone && !isReturnable ? (
        <mesh>
          <boxGeometry args={[totalX + 0.08, totalY + 0.08, totalZ + 0.08]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={0.3}
            transparent
            opacity={0.14}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  )
}

function ActivePalletLabel({ item }) {
  const { x, y, z, totalY } = getBoxWorldPosition(item)
  const skuText = String(item?.label ?? `${item?.skuCount ?? 0} SKUs`)
  const skuMatch = skuText.match(/(\d+)/)
  const skuCount = skuMatch?.[1] ?? (item?.skuCount ?? 0)
  return (
    <Html position={[x, y + totalY / 2 + 0.55, z]} center distanceFactor={8.5}>
      <div className="active-pallet-label">
        <p className="active-pallet-kicker">Stop Active</p>
        <strong>{`📦 Deliver: ${skuCount} Boxes`}</strong>
      </div>
    </Html>
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

function CargoScene({ boxes, fadingBoxes = [], enableTransition, animateToken }) {
  const { width, length } = getGridFootprint()
  const activeBoxes = boxes.filter((item) => item.type === 'active')
  const leadActive = activeBoxes[0] ?? null

  return (
    <>
      <ambientLight intensity={0.58} />
      <directionalLight castShadow intensity={1.15} position={[7.2, 8.4, 6.4]} />
      <directionalLight intensity={0.45} position={[-5, 4, -6]} />

      <TruckChassis />
      {boxes.map((item) => (
        <CargoBox
          key={enableTransition ? `${item.id}-${item.type}-${animateToken}` : item.id}
          item={item}
          shouldAnimate={enableTransition}
          animateToken={animateToken}
        />
      ))}
      {fadingBoxes.map((item) => (
        <FadingPoofBox key={`poof-${item.id}-${animateToken}`} item={item} animateToken={animateToken} />
      ))}
      {leadActive ? <ActivePalletLabel item={leadActive} /> : null}

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
  processTransitionTrigger = 0,
  progressAction = 'sync',
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
  const truckLoadManifest = useMemo(
    () => buildTruckLoadManifest({ manifest, cargo: activeCargo, progressStop }),
    [manifest, activeCargo, progressStop],
  )
  const previousManifestRef = useRef(truckLoadManifest)
  const [fadingBoxes, setFadingBoxes] = useState([])
  const reverseCount = truckLoadManifest.filter((box) => box.type === 'returnable').length
  const shouldAnimateTransition = progressAction === 'process' && processTransitionTrigger > 0

  useEffect(() => {
    const previousManifest = previousManifestRef.current ?? []
    const nextManifest = truckLoadManifest ?? []

    if (shouldAnimateTransition) {
      const previousById = new Map(previousManifest.map((item) => [item.id, item]))
      const poofItems = nextManifest
        .filter((item) => item.type === 'returnable' && previousById.get(item.id)?.type === 'active')
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
  }, [truckLoadManifest, shouldAnimateTransition])

  return (
    <div className="truck-cargo-canvas volumetric-cargo-canvas" aria-label="Volumetric 3D truck cargo viewer">
      <Canvas
        key={selectedStopKey}
        shadows
        camera={{ position: [7.1, 6.4, 8.1], fov: 43, near: 0.1, far: 120 }}
        gl={{ antialias: true, alpha: true }}
      >
        <CargoScene
          boxes={truckLoadManifest}
          fadingBoxes={fadingBoxes}
          enableTransition={shouldAnimateTransition}
          animateToken={processTransitionTrigger}
        />
      </Canvas>
      <div className="truck-compass" aria-label="Viewer orientation compass">
        <span className="truck-compass-front">FRONT</span>
        <span className="truck-compass-axis" />
        <span className="truck-compass-rear">REAR</span>
      </div>
      <div className="truck-side-access-tag">⬅️ Side Loading Clear</div>
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
