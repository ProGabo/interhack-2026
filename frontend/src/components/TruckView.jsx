import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges, Html } from '@react-three/drei'
import PRODUCTS from '../data/products'

// One pallet zone is 1.0 × 1.0; cube grid is rows·3 × cols·3 cells, plus
// optional vertical layers. Sizes tuned for the (cols·3) × (rows·3) sweep
// the optimizer produces.
const PALLET_W = 1.0
const SLOT     = PALLET_W / 3.2
const CUBE     = SLOT * 0.86
const PALLET_H = 0.04
const SHELL_H  = 1.25

// Distinct, dark-bg-friendly palette indexed by stop number.
const STOP_COLORS = [
  '#5B8DEF', '#39C19A', '#E0A346', '#D85F8C',
  '#9F7AEA', '#F25F5F', '#48BB78', '#38B2AC',
  '#ED8936', '#A0AEC0',
]

const stopColor = (idx) => STOP_COLORS[(Math.max(0, idx - 1)) % STOP_COLORS.length]

/* ── Legacy fallback: derive cubes from `pallets` + `deliveries` when the
   route doc was seeded by the old script (no optimizer output). ── */
function deriveCubesFromLegacy(pallets, deliveries) {
  if (!pallets) return null
  const stopByPallet = {}
  deliveries?.forEach((d, i) => {
    if (i === 0) return // depot
    d.pallet_positions?.forEach((p) => { stopByPallet[`${p.row},${p.col}`] = i })
  })
  const cubes = []
  pallets.forEach((pal) => {
    const stopIndex = stopByPallet[`${pal.row},${pal.col}`] ?? 0
    const units = []
    pal.products?.forEach((p) => {
      for (let i = 0; i < p.quantity; i++) units.push(p.product_id)
    })
    units.slice(0, 9).forEach((pid, i) => {
      cubes.push({
        x: pal.col * 3 + (i % 3),
        y: pal.row * 3 + Math.floor(i / 3),
        z: 0,
        stop_index: stopIndex,
        product_id: pid,
      })
    })
  })
  return cubes
}

function CubeMesh({ cube, dim, faded, hovered, onEnter, onLeave }) {
  const color = stopColor(cube.stop_index)
  const xWorld = (cube.x - (dim.L - 1) / 2) * SLOT
  const zWorld = (cube.y - (dim.W - 1) / 2) * SLOT
  const yWorld = PALLET_H + CUBE / 2 + cube.z * (CUBE + 0.005)

  return (
    <mesh
      position={[xWorld, yWorld, zWorld]}
      castShadow
      onPointerEnter={(e) => { e.stopPropagation(); onEnter() }}
      onPointerLeave={onLeave}
    >
      <boxGeometry args={[CUBE, CUBE, CUBE]} />
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.08}
        transparent={faded}
        opacity={faded ? 0.18 : 1}
      />
      <Edges scale={1.001} threshold={15} color="#ffffff" />
      {hovered && (
        <Html distanceFactor={18} center>
          <div style={{
            background: 'rgba(8,10,16,0.97)',
            border: `1px solid ${color}`,
            borderRadius: 3,
            padding: '3px 8px',
            fontSize: 10,
            color: '#fff',
            whiteSpace: 'nowrap',
            fontFamily: 'Montserrat,sans-serif',
            pointerEvents: 'none',
          }}>
            Stop {cube.stop_index}
            {cube.product_id ? ` · ${cube.product_id}` : ''}
          </div>
        </Html>
      )}
    </mesh>
  )
}

function PalletSlab({ row, col, rows, cols }) {
  const x = (col - (cols - 1) / 2) * PALLET_W
  const z = (row - (rows - 1) / 2) * PALLET_W
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, PALLET_H / 2, 0]} receiveShadow>
        <boxGeometry args={[PALLET_W * 0.94, PALLET_H, PALLET_W * 0.94]} />
        <meshStandardMaterial color="#1B2230" roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh position={[0, PALLET_H + 0.0015, 0]}>
        <boxGeometry args={[PALLET_W * 0.94, 0.003, PALLET_W * 0.94]} />
        <meshStandardMaterial color="#2C3447" roughness={0.5} />
      </mesh>
    </group>
  )
}

function TruckShell({ rows, cols }) {
  const w = cols * PALLET_W + 0.18
  const d = rows * PALLET_W + 0.18
  return (
    <mesh position={[0, SHELL_H / 2, 0]}>
      <boxGeometry args={[w, SHELL_H, d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      <Edges scale={1.0} color="#39456A" />
    </mesh>
  )
}

function Floor({ rows, cols }) {
  const w = cols * PALLET_W + 1.6
  const d = rows * PALLET_W + 1.6
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color="#0A0D14" roughness={1} />
    </mesh>
  )
}

export default function TruckView({
  layout, cubes, cubeGrid, pallets, deliveries, deliveryStatus,
  points, truckId, onClose,
}) {
  const [hoverIdx, setHoverIdx] = useState(null)

  const rows = layout?.rows ?? 2
  const cols = layout?.cols ?? 3

  // Prefer real optimizer output; fall back to deriving from legacy data.
  const resolvedCubes = useMemo(
    () => cubes ?? deriveCubesFromLegacy(pallets, deliveries) ?? [],
    [cubes, pallets, deliveries]
  )
  const dim = cubeGrid ?? { L: cols * 3, W: rows * 3, H: 1 }

  // Stops present in the truck (ignore depot at index 0).
  const stopIndices = useMemo(() => {
    const set = new Set(resolvedCubes.map((c) => c.stop_index))
    set.delete(0)
    return [...set].sort((a, b) => a - b)
  }, [resolvedCubes])

  const totalCubes = resolvedCubes.length
  const deliveredCubes = resolvedCubes.filter(
    (c) => deliveryStatus?.[c.stop_index] === 'delivered'
  ).length
  const remaining = totalCubes - deliveredCubes
  const pct = totalCubes ? Math.round((deliveredCubes / totalCubes) * 100) : 0

  const span = Math.max(rows, cols)
  const camDist = span * 1.7

  // Pallet slabs for visual structure under the cubes.
  const slabs = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) slabs.push({ row: r, col: c })

  return (
    <div className="truck-modal-overlay" onClick={onClose}>
      <div className="truck-modal" onClick={(e) => e.stopPropagation()}>

        <div className="truck-modal-header">
          <div className="truck-modal-title">
            <span style={{ color: 'var(--red)', marginRight: 8 }}>★</span>
            Truck {truckId}
            <span className="truck-grid-badge">{rows}×{cols}</span>
          </div>
          <button className="truck-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="truck-modal-canvas">
          <Canvas
            shadows
            camera={{ position: [camDist, camDist * 0.8, camDist], fov: 32 }}
            gl={{ antialias: true, alpha: false }}
            style={{ background: '#0A0D14' }}
          >
            <ambientLight intensity={0.55} />
            <directionalLight
              position={[3, 6, 4]}
              intensity={0.85}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
            />
            <directionalLight position={[-4, 3, -2]} intensity={0.25} />

            <Floor rows={rows} cols={cols} />
            <TruckShell rows={rows} cols={cols} />
            {slabs.map((s, i) => (
              <PalletSlab key={i} row={s.row} col={s.col} rows={rows} cols={cols} />
            ))}

            {resolvedCubes.map((cube, i) => (
              <CubeMesh
                key={i}
                cube={cube}
                dim={dim}
                faded={deliveryStatus?.[cube.stop_index] === 'delivered'}
                hovered={hoverIdx === i}
                onEnter={() => setHoverIdx(i)}
                onLeave={() => setHoverIdx(null)}
              />
            ))}

            <OrbitControls
              target={[0, 0.25, 0]}
              enablePan={false}
              minDistance={2.5}
              maxDistance={camDist * 2.4}
              maxPolarAngle={Math.PI / 2.05}
            />
          </Canvas>
        </div>

        <div className="truck-footer">
          <div className="truck-stat">
            <span className="truck-stat-val">{remaining}</span>
            <span className="truck-stat-label">remaining</span>
          </div>
          <div className="truck-progress-wrap">
            <div className="truck-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="truck-stat right">
            <span className="truck-stat-val">{deliveredCubes} / {totalCubes}</span>
            <span className="truck-stat-label">boxes delivered</span>
          </div>
          <div className="truck-brands">
            {stopIndices.map((idx) => {
              const addr = points?.[idx]?.address
              const label = addr ? addr.split(',')[0] : `Stop ${idx}`
              return (
                <span key={idx} className="truck-legend-item" title={addr}>
                  <span className="truck-legend-dot" style={{ background: stopColor(idx) }} />
                  {label}
                </span>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
