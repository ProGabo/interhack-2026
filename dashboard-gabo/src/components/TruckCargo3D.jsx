import { Canvas } from "@react-three/fiber"
import { Html, OrbitControls } from "@react-three/drei"

const SLOT_STYLES = {
  target_unload: {
    fill: "#facc15",
    emissive: "#f59e0b",
    emissiveIntensity: 0.45,
    transparent: false,
    opacity: 1,
    wireframe: false,
    label: "UNLOAD NOW",
  },
  full: {
    fill: "#3b82f6",
    emissive: "#1d4ed8",
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.7,
    wireframe: false,
    label: "NEXT STOP",
  },
  free: {
    fill: "#93c5fd",
    emissive: "#0f172a",
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.15,
    wireframe: true,
    label: "FREE SPOT",
  },
  empty_return: {
    fill: "#4b5563",
    emissive: "#111827",
    emissiveIntensity: 0.05,
    transparent: false,
    opacity: 1,
    wireframe: false,
    label: "EMPTY RETURN",
  },
}

const SLOT_SIZE = [1.55, 0.9, 1.05]
const SLOT_GAP = { x: 0.32, z: 0.4 }

function getSlotStyle(type) {
  return SLOT_STYLES[type] ?? SLOT_STYLES.full
}

function TruckFrame({ width, depth }) {
  const frameHeight = 1.2

  return (
    <group>
      <mesh receiveShadow position={[0, -0.62, 0]}>
        <boxGeometry args={[width + 1.15, 0.15, depth + 1.05]} />
        <meshStandardMaterial color="#111827" metalness={0.2} roughness={0.8} />
      </mesh>

      <mesh position={[0, 0.24, -(depth / 2 + 0.52)]}>
        <boxGeometry args={[width + 1.05, frameHeight, 0.08]} />
        <meshStandardMaterial color="#7f1d1d" metalness={0.25} roughness={0.55} />
      </mesh>

      <mesh position={[-(width / 2 + 0.52), 0.22, 0]}>
        <boxGeometry args={[0.08, frameHeight, depth + 0.75]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.2} roughness={0.55} />
      </mesh>

      <mesh position={[width / 2 + 0.52, 0.22, 0]}>
        <boxGeometry args={[0.08, frameHeight, depth + 0.75]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.2} roughness={0.55} />
      </mesh>
    </group>
  )
}

function SlotMesh({ slot, position }) {
  const style = getSlotStyle(slot.type)
  const label = slot.product ?? style.label

  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={SLOT_SIZE} />
        <meshStandardMaterial
          color={style.fill}
          emissive={style.emissive}
          emissiveIntensity={style.emissiveIntensity}
          metalness={0.15}
          roughness={0.45}
          transparent={style.transparent}
          opacity={style.opacity}
          wireframe={style.wireframe}
        />
      </mesh>

      <Html transform sprite distanceFactor={9.5} position={[0, SLOT_SIZE[1] / 2 + 0.28, 0]}>
        <div className="rounded-md border border-slate-600/80 bg-slate-950/88 px-2 py-1 text-center shadow-xl backdrop-blur-sm">
          <p className="max-w-36 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-200">{style.label}</p>
          <p className="max-w-36 text-[11px] font-medium text-slate-100">{label}</p>
        </div>
      </Html>
    </group>
  )
}

function TruckCargoScene({ matrix }) {
  const rowCount = matrix.length
  const colCount = matrix[0]?.length ?? 0
  const stepX = SLOT_SIZE[0] + SLOT_GAP.x
  const stepZ = SLOT_SIZE[2] + SLOT_GAP.z
  const width = Math.max(0, (colCount - 1) * stepX + SLOT_SIZE[0])
  const depth = Math.max(0, (rowCount - 1) * stepZ + SLOT_SIZE[2])
  const baseX = -((colCount - 1) * stepX) / 2
  const baseZ = -((rowCount - 1) * stepZ) / 2

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
      <directionalLight intensity={0.45} position={[-5, 3.8, -4.5]} />

      <TruckFrame width={width} depth={depth} />

      {matrix.map((row, rowIndex) =>
        row.map((slot, colIndex) => (
          <SlotMesh
            key={`slot-${rowIndex}-${colIndex}-${slot.type}-${slot.product ?? "empty"}`}
            slot={slot}
            position={[baseX + colIndex * stepX, 0, baseZ + rowIndex * stepZ]}
          />
        )),
      )}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]}>
        <planeGeometry args={[width + 3, depth + 3]} />
        <shadowMaterial opacity={0.22} />
      </mesh>

      <OrbitControls
        enablePan={false}
        minDistance={4.2}
        maxDistance={18}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2}
        target={[0, 0, 0]}
      />
    </>
  )
}

function TruckCargo3D({ matrix }) {
  return (
    <div className="h-[460px] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
      <Canvas
        shadows
        camera={{ position: [6.8, 5.8, 6.4], fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <TruckCargoScene matrix={matrix} />
      </Canvas>
    </div>
  )
}

export default TruckCargo3D
