import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import PRODUCTS from '../data/products'

const CELL     = 0.34
const PALLET_W = 1.0
const SPACING  = PALLET_W
const PLAT_H   = 0.06

const BRAND_COLOR = { brand1: '#3b82f6', brand2: '#22c55e', brand3: '#f59e0b' }
const BRAND_LABEL = { brand1: 'Brand 1', brand2: 'Brand 2', brand3: 'Brand 3' }

function countUnits(palletsData, filterFn) {
  return palletsData.filter(filterFn).reduce(
    (sum, p) => sum + (p.products?.reduce((s, pr) => s + pr.quantity, 0) ?? 0), 0
  )
}

/* ── Product cube ── */
function ProductCube({ productId, quantity, x, baseY, hovered, onEnter, onLeave }) {
  const info = PRODUCTS[productId]
  if (!info) return null
  const h = info.height_cells * CELL
  const color = BRAND_COLOR[info.brand] ?? '#888'

  return (
    <mesh
      position={[x, baseY + h / 2, 0]}
      onPointerEnter={(e) => { e.stopPropagation(); onEnter() }}
      onPointerLeave={onLeave}
    >
      <boxGeometry args={[CELL * 0.82, h, CELL * 0.82]} />
      <meshStandardMaterial
        color={hovered ? '#fff' : color}
        roughness={0.25}
        metalness={0.15}
        emissive={color}
        emissiveIntensity={hovered ? 0.5 : 0.1}
      />
      {hovered && (
        <Html distanceFactor={20} center>
          <div style={{
            background:'rgba(8,10,16,0.97)',
            border:'1px solid rgba(196,18,48,0.4)',
            borderRadius:'3px',
            padding:'2px 7px',
            fontSize:'10px',
            color:'#fff',
            whiteSpace:'nowrap',
            fontFamily:'Montserrat,sans-serif',
            pointerEvents:'none',
          }}>
            {productId} · qty {quantity}
          </div>
        </Html>
      )}
    </mesh>
  )
}

/* ── Pallet: always rendered, products removed when delivered ── */
function Pallet({ row, col, products, delivered }) {
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const x = col * SPACING
  const z = row * SPACING
  const hasProducts = !delivered && products.length > 0

  return (
    <group position={[x, 0, z]}>
      {/* Platform */}
      <mesh position={[0, PLAT_H / 2, 0]}>
        <boxGeometry args={[PALLET_W, PLAT_H, PALLET_W]} />
        <meshStandardMaterial
          color="#3a5080"
          roughness={0.5}
          metalness={0.4}
          emissive="#1a2a50"
          emissiveIntensity={0.25}
        />
      </mesh>
      {/* Top face highlight */}
      <mesh position={[0, PLAT_H + 0.003, 0]}>
        <boxGeometry args={[PALLET_W - 0.02, 0.005, PALLET_W - 0.02]} />
        <meshStandardMaterial
          color="#4e6898"
          roughness={0.35}
          metalness={0.55}
        />
      </mesh>

      {/* Products */}
      {hasProducts && products.map((p, i) => {
        const n = products.length
        const xOff = (i - (n - 1) / 2) * (CELL * 1.15)
        return (
          <ProductCube
            key={i}
            productId={p.product_id}
            quantity={p.quantity}
            x={xOff}
            baseY={PLAT_H + 0.015}
            hovered={hoveredIdx === i}
            onEnter={() => setHoveredIdx(i)}
            onLeave={() => setHoveredIdx(null)}
          />
        )
      })}
    </group>
  )
}

/* ── Floor with subtle separators ── */
function Floor({ rows, cols }) {
  const totalW = cols * PALLET_W
  const totalD = rows * PALLET_W
  const cx = (totalW - PALLET_W) / 2
  const cz = (totalD - PALLET_W) / 2

  return (
    <group>
      <mesh position={[cx, -0.04, cz]}>
        <boxGeometry args={[totalW + 0.5, 0.06, totalD + 0.5]} />
        <meshStandardMaterial color="#0b0d13" roughness={0.95} />
      </mesh>
      {Array.from({ length: cols - 1 }, (_, i) => (
        <mesh key={`v${i}`} position={[(i + 1) * SPACING - 0.5, 0.001, cz]}>
          <boxGeometry args={[0.015, 0.008, totalD + 0.2]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.06} />
        </mesh>
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <mesh key={`h${i}`} position={[cx, 0.001, (i + 1) * SPACING - 0.5]}>
          <boxGeometry args={[totalW + 0.2, 0.008, 0.015]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.06} />
        </mesh>
      ))}
    </group>
  )
}

/* ── Main export ── */
export default function TruckView({ layout, pallets, deliveries, deliveryStatus, truckId, onClose }) {
  // Infer grid dimensions from pallets data if layout is missing from Firestore
  const maxRow = pallets?.length ? Math.max(...pallets.map(p => p.row)) : 1
  const maxCol = pallets?.length ? Math.max(...pallets.map(p => p.col)) : 2
  const rows = layout?.rows ?? maxRow + 1
  const cols = layout?.cols ?? maxCol + 1

  // Build lookup from original pallet data
  const palletMap = {}
  pallets?.forEach(p => { palletMap[`${p.row},${p.col}`] = p })

  // Always render the full grid — every position, even if no data
  const grid = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid.push({
        row: r,
        col: c,
        products: palletMap[`${r},${c}`]?.products ?? [],
      })
    }
  }

  // Which pallets have been unloaded
  const deliveredSet = new Set()
  deliveries?.forEach((d, i) => {
    if (deliveryStatus?.[i] === 'delivered') {
      d.pallet_positions?.forEach(p => deliveredSet.add(`${p.row},${p.col}`))
    }
  })

  const cx = (cols * PALLET_W - PALLET_W) / 2
  const cz = (rows * PALLET_W - PALLET_W) / 2

  const totalUnits     = countUnits(pallets ?? [], () => true)
  const deliveredUnits = countUnits(pallets ?? [], p => deliveredSet.has(`${p.row},${p.col}`))
  const remaining      = totalUnits - deliveredUnits
  const pct            = totalUnits > 0 ? Math.round((deliveredUnits / totalUnits) * 100) : 0

  return (
    <div className="truck-modal-overlay" onClick={onClose}>
      <div className="truck-modal" onClick={e => e.stopPropagation()}>

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
            camera={{ position: [cx + cols * 0.5, 2.4 + rows * 0.35, cz + rows + 2], fov: 44 }}
            gl={{ antialias: true, alpha: false }}
            style={{ background: '#080a10' }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[3, 6, 3]} intensity={0.7} />
            <pointLight position={[cx, 3.5, cz]} intensity={0.55} color="#ddeeff" />

            <Floor rows={rows} cols={cols} />

            {grid.map((cell, i) => (
              <Pallet
                key={i}
                row={cell.row}
                col={cell.col}
                products={cell.products}
                delivered={deliveredSet.has(`${cell.row},${cell.col}`)}
              />
            ))}

            <OrbitControls
              target={[cx, 0.3, cz]}
              enablePan={false}
              minDistance={2}
              maxDistance={11}
              maxPolarAngle={Math.PI / 1.9}
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
            <span className="truck-stat-val">{deliveredUnits} / {totalUnits}</span>
            <span className="truck-stat-label">units delivered</span>
          </div>
          <div className="truck-brands">
            {Object.entries(BRAND_COLOR).map(([b, c]) => (
              <span key={b} className="truck-legend-item">
                <span className="truck-legend-dot" style={{ background: c }} />
                {BRAND_LABEL[b]}
              </span>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
