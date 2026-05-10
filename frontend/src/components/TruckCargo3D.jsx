import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Edges, Html, OrbitControls } from '@react-three/drei'

/* The truck is rendered from the route doc's `items` (3D anchored boxes) plus
   `item_grid` ({L, W, H}) — the same format as backend/firestore_writer.py.
   Lattice axes:
     x ∈ [0, L)  truck length (cab at -X)
     y ∈ [0, W)  truck width
     z ∈ [0, H)  vertical stacking
   Each item carries `position {x,y,z}` (anchor / min corner), `shape
   {w_x, w_y, w_z}` (cells), and a `type` tagged by the caller for color
   coding (target_unload / full / empty_return). */

// Lattice cells are 0.4 m in the backend; CELL is its on-screen size. We use
// a slightly enlarged value to keep the truck visually substantial in the
// drawer without distorting proportions.
const CELL = 0.5
const CELL_GAP = 0.02
const FLOOR_Y = 0

const TYPE_STYLES = {
  target_unload: {
    fill: '#facc15',
    edge: '#fde047',
    emissive: '#f59e0b',
    emissiveIntensity: 0.4,
    label: 'UNLOAD NOW',
  },
  full: {
    fill: '#3b82f6',
    edge: '#60a5fa',
    emissive: '#1d4ed8',
    emissiveIntensity: 0.08,
    label: 'NEXT STOP',
  },
  empty_return: {
    fill: '#4b5563',
    edge: '#9ca3af',
    emissive: '#111827',
    emissiveIntensity: 0.05,
    label: 'EMPTY RETURN',
  },
}
const RETURNABLE_EDGE = '#F5C24D'

function styleFor(type) {
  return TYPE_STYLES[type] ?? TYPE_STYLES.full
}

/* Cell index → world coord. The lattice is centered around 0; an item with
   shape (w_x, w_y, w_z) anchored at (x, y, z) has its centroid at
   (x + (w_x-1)/2 - (L-1)/2). Y (vertical) starts on the floor instead of
   centering, so item z=0 sits flush. */
function cellCenter(anchor, shape, grid) {
  const { x, y, z } = anchor
  const { w_x, w_y, w_z } = shape
  const xWorld = (x + (w_x - 1) / 2 - (grid.L - 1) / 2) * CELL
  const zWorld = (y + (w_y - 1) / 2 - (grid.W - 1) / 2) * CELL
  const yWorld = FLOOR_Y + ((w_z - 1) / 2 + z) * (CELL + CELL_GAP) + (CELL + CELL_GAP) / 2
  return [xWorld, yWorld, zWorld]
}

function ItemMesh({ item, grid }) {
  const [hovered, setHovered] = useState(false)
  const style = styleFor(item.type)
  const w_x = item.shape?.w_x ?? 1
  const w_y = item.shape?.w_y ?? 1
  const w_z = item.shape?.w_z ?? 1

  const sx = w_x * CELL + (w_x - 1) * (-CELL_GAP * 0.0)
  const sz = w_y * CELL + (w_y - 1) * (-CELL_GAP * 0.0)
  const sy = w_z * (CELL + CELL_GAP) - CELL_GAP

  const center = cellCenter(item.position ?? { x: 0, y: 0, z: 0 }, item.shape ?? { w_x: 1, w_y: 1, w_z: 1 }, grid)

  const edgeColor = item.is_returnable ? RETURNABLE_EDGE : style.edge

  return (
    <mesh
      castShadow
      receiveShadow
      position={center}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[sx - CELL_GAP, sy, sz - CELL_GAP]} />
      <meshStandardMaterial
        color={style.fill}
        emissive={style.emissive}
        emissiveIntensity={style.emissiveIntensity}
        metalness={0.15}
        roughness={0.45}
      />
      <Edges scale={1.001} color={edgeColor} />
      {hovered && (
        <Html distanceFactor={9.5} center position={[0, sy / 2 + 0.18, 0]} zIndexRange={[20, 0]}>
          <div className="truck-slot-badge-wrap">
            <div className="truck-slot-badge" style={{ borderColor: style.edge }}>
              <p className="truck-slot-badge-title">
                {style.label}{item.is_returnable ? ' · RET' : ''}
              </p>
              <p className="truck-slot-badge-product">
                {item.product_id ?? 'Unknown'} · {w_x}×{w_y}×{w_z}
              </p>
            </div>
          </div>
        </Html>
      )}
    </mesh>
  )
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

/* `length` runs along world X (truck length, cab at -X), `width` runs along
   world Z, `height` along Y. Sized to fit the lattice exactly. */
function TruckFrame({ length, width, height }) {
  const frameHeight = Math.max(1.0, height)
  const cabWidth = THREE.MathUtils.clamp(width * 0.85, 1.6, 3.3)
  const cabFrontX = -(length / 2 + 1.45)
  const chassisLength = length + 1.6
  const chassisCenterX = (cabFrontX + length / 2) / 2
  const wheelTrack = width + 1
  const frontAxleX = cabFrontX + 0.15
  const rearAxle1X = length * 0.14
  const rearAxle2X = length * 0.36

  return (
    <group>
      {/* Chassis under the cargo */}
      <mesh receiveShadow position={[0, FLOOR_Y - 0.62, 0]}>
        <boxGeometry args={[length + 1.15, 0.15, width + 1.05]} />
        <meshStandardMaterial color="#111827" metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh receiveShadow position={[chassisCenterX, FLOOR_Y - 0.88, 0]}>
        <boxGeometry args={[chassisLength, 0.22, width + 1.05]} />
        <meshStandardMaterial color="#1f2937" metalness={0.35} roughness={0.45} />
      </mesh>

      {/* Cargo box walls (long sides only — back and front stay open so we
          can see the lattice). */}
      <mesh position={[0, FLOOR_Y + frameHeight / 2, -(width / 2 + 0.06)]}>
        <boxGeometry args={[length + 0.1, frameHeight, 0.05]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.2} roughness={0.55} transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, FLOOR_Y + frameHeight / 2, width / 2 + 0.06]}>
        <boxGeometry args={[length + 0.1, frameHeight, 0.05]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.2} roughness={0.55} transparent opacity={0.35} />
      </mesh>
      {/* Roof outline (wireframe so items inside remain visible) */}
      <mesh position={[0, FLOOR_Y + frameHeight, 0]}>
        <boxGeometry args={[length + 0.1, 0.05, width + 0.1]} />
        <meshStandardMaterial color="#475569" transparent opacity={0.15} />
        <Edges color="#64748b" />
      </mesh>

      {/* Cab */}
      <group position={[cabFrontX, FLOOR_Y, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh castShadow receiveShadow position={[0.28, -0.22, 0]}>
          <boxGeometry args={[cabWidth + 0.42, 0.34, 1.62]} />
          <meshStandardMaterial color="#374151" metalness={0.3} roughness={0.48} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, -0.18, 0]}>
          <boxGeometry args={[cabWidth, 0.72, 1.5]} />
          <meshStandardMaterial color="#1f2937" metalness={0.25} roughness={0.5} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.27, 0.16]}>
          <boxGeometry args={[cabWidth * 0.9, 0.62, 1.02]} />
          <meshStandardMaterial color="#334155" metalness={0.22} roughness={0.48} />
        </mesh>
        <mesh position={[0, 0.34, -0.33]}>
          <boxGeometry args={[cabWidth * 0.84, 0.36, 0.08]} />
          <meshStandardMaterial
            color="#7dd3fc"
            emissive="#0f172a"
            emissiveIntensity={0.14}
            metalness={0.1}
            roughness={0.12}
            transparent
            opacity={0.7}
          />
        </mesh>
      </group>

      <Wheel position={[frontAxleX, FLOOR_Y - 1.16,  wheelTrack / 2]} />
      <Wheel position={[frontAxleX, FLOOR_Y - 1.16, -wheelTrack / 2]} />
      <Wheel position={[rearAxle1X, FLOOR_Y - 1.16,  wheelTrack / 2]} />
      <Wheel position={[rearAxle1X, FLOOR_Y - 1.16, -wheelTrack / 2]} />
      <Wheel position={[rearAxle2X, FLOOR_Y - 1.16,  wheelTrack / 2]} />
      <Wheel position={[rearAxle2X, FLOOR_Y - 1.16, -wheelTrack / 2]} />
    </group>
  )
}

function CargoFloor({ length, width }) {
  return (
    <mesh receiveShadow position={[0, FLOOR_Y - 0.005, 0]}>
      <boxGeometry args={[length, 0.01, width]} />
      <meshStandardMaterial color="#0f172a" roughness={0.9} />
    </mesh>
  )
}

function CargoScene({ items, grid }) {
  const length = grid.L * CELL
  const width = grid.W * CELL
  const height = grid.H * (CELL + CELL_GAP)

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight
        castShadow
        intensity={1.15}
        position={[6.5, 8.2, 4.2]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight intensity={0.58} position={[-5, 3.8, -4.5]} />

      <TruckFrame length={length} width={width} height={height} />
      <CargoFloor length={length} width={width} />

      {items.map((item, i) => (
        <ItemMesh key={item.id ?? i} item={item} grid={grid} />
      ))}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.7, 0]}>
        <planeGeometry args={[length + 4, width + 4]} />
        <shadowMaterial opacity={0.22} />
      </mesh>

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={4.2}
        maxDistance={22}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2}
        target={[0, height / 2, 0]}
      />
    </>
  )
}

export default function TruckCargo3D({
  items,
  itemGrid,
  selectedStopId,
  selectedStopIndex,
}) {
  const grid = itemGrid ?? null
  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items])
  const sceneKey = selectedStopId ?? `stop-${selectedStopIndex ?? 0}`

  if (!grid || safeItems.length === 0) {
    return (
      <div className="truck-cargo-canvas truck-cargo-empty">
        <p>No cargo data for this stop.</p>
      </div>
    )
  }

  return (
    <div
      className="truck-cargo-canvas volumetric-cargo-canvas"
      aria-label="Volumetric 3D truck cargo viewer"
      style={{ position: 'relative' }}
    >
      <Canvas
        key={sceneKey}
        shadows
        camera={{ position: [grid.L * CELL * 0.9, grid.H * CELL * 1.6 + 2, grid.W * CELL * 1.4], fov: 38, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <CargoScene items={safeItems} grid={grid} />
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
