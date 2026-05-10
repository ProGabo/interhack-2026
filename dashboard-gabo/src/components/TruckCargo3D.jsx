import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { Canvas, useFrame } from "@react-three/fiber"
import { Html, OrbitControls } from "@react-three/drei"

const SLOT_STYLES = {
  target_unload: {
    fill: "#facc15",
    border: "#facc15",
    emissive: "#f59e0b",
    emissiveIntensity: 0.45,
    transparent: false,
    opacity: 1,
    wireframe: false,
    label: "UNLOAD NOW",
  },
  full: {
    fill: "#3b82f6",
    border: "#60a5fa",
    emissive: "#1d4ed8",
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.7,
    wireframe: false,
    label: "NEXT STOP",
  },
  free: {
    fill: "#93c5fd",
    border: "#7dd3fc",
    emissive: "#0f172a",
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.15,
    wireframe: true,
    label: "FREE SPOT",
  },
  empty_return: {
    fill: "#4b5563",
    border: "#9ca3af",
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

function buildFallbackMatrix() {
  return Array.from({ length: 2 }, (_, row) =>
    Array.from({ length: 4 }, (_, col) => ({
      id: `fallback-${row}-${col}`,
      row,
      col,
      type: "free",
      product: null,
      weight: 0,
    })),
  )
}

function normalizeMatrixInput(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return buildFallbackMatrix()
  }

  const colCount = Math.max(
    1,
    matrix.reduce((maxCols, row) => Math.max(maxCols, Array.isArray(row) ? row.length : 0), 0),
  )

  if (colCount === 0) {
    return buildFallbackMatrix()
  }

  return matrix.map((row, rowIndex) =>
    Array.from({ length: colCount }, (_, colIndex) => {
      const slot = Array.isArray(row) ? row[colIndex] : null
      return {
        id: slot?.id ?? `slot-${rowIndex}-${colIndex}`,
        row: rowIndex,
        col: colIndex,
        type: slot?.type ?? "free",
        product: slot?.product ?? null,
        weight: Number(slot?.weight ?? 0) || 0,
      }
    }),
  )
}

function Wheel({ position, radius = 0.34, wheelWidth = 0.24 }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, wheelWidth, 28]} />
        <meshStandardMaterial color="#111111" metalness={0.08} roughness={0.85} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[radius * 0.52, radius * 0.52, wheelWidth + 0.02, 24]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.45} roughness={0.35} />
      </mesh>
    </group>
  )
}

function TruckFrame({ width, depth }) {
  const frameHeight = 1.2
  const cabWidth = THREE.MathUtils.clamp(depth * 0.8, 2, 3.3)
  const cabFrontX = -(width / 2 + 1.45)
  const cargoDeckLength = width + 1.15
  const cargoDeckHalfLength = cargoDeckLength / 2
  const cabBodyLength = 1.62
  const cabFrontOverhang = Math.max(0, Math.abs(cabFrontX) + cabBodyLength / 2 - cargoDeckHalfLength)
  const chassisLength = cargoDeckLength + cabFrontOverhang
  const chassisCenterX = -cabFrontOverhang / 2
  const wheelTrack = depth + 1
  const frontAxleX = cabFrontX + 0.15
  const rearAxle1X = width * 0.14
  const rearAxle2X = width * 0.36

  return (
    <group>
      <mesh receiveShadow position={[0, -0.62, 0]}>
        <boxGeometry args={[width + 1.15, 0.15, depth + 1.05]} />
        <meshStandardMaterial color="#111827" metalness={0.2} roughness={0.8} />
      </mesh>

      <mesh receiveShadow position={[chassisCenterX, -0.88, 0]}>
        <boxGeometry args={[chassisLength, 0.22, depth + 1.05]} />
        <meshStandardMaterial color="#1f2937" metalness={0.35} roughness={0.45} />
      </mesh>

      <mesh position={[0, 0.24, -(depth / 2 + 0.52)]}>
        <boxGeometry args={[width + 1.05, frameHeight, 0.08]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.2} roughness={0.55} />
      </mesh>

      <mesh position={[0, 0.24, depth / 2 + 0.52]}>
        <boxGeometry args={[width + 1.05, frameHeight, 0.08]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.2} roughness={0.55} />
      </mesh>

      <group position={[cabFrontX, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
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

        <mesh castShadow receiveShadow position={[-0.52, -0.36, -0.01]}>
          <boxGeometry args={[0.06, 0.14, cabWidth * 0.72]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.28} roughness={0.42} />
        </mesh>
      </group>

      <Wheel position={[frontAxleX, -1.16, wheelTrack / 2]} />
      <Wheel position={[frontAxleX, -1.16, -wheelTrack / 2]} />
      <Wheel position={[rearAxle1X, -1.16, wheelTrack / 2]} />
      <Wheel position={[rearAxle1X, -1.16, -wheelTrack / 2]} />
      <Wheel position={[rearAxle2X, -1.16, wheelTrack / 2]} />
      <Wheel position={[rearAxle2X, -1.16, -wheelTrack / 2]} />
    </group>
  )
}

function SlotMesh({ slot, position, groupRef, hidden = false }) {
  const [isHovered, setIsHovered] = useState(false)
  const style = getSlotStyle(slot.type)
  const productText = slot.product ?? "Free slot"
  const showFullText = slot.type === "target_unload" || slot.type === "empty_return"
  const tooltipBorder = { borderColor: style.border }

  if (hidden) {
    return null
  }

  return (
    <group ref={groupRef} position={position}>
      <mesh
        castShadow
        receiveShadow
        onPointerOver={() => setIsHovered(true)}
        onPointerOut={() => setIsHovered(false)}
      >
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

      <Html
        transform
        sprite
        occlude
        distanceFactor={9.5}
        position={[0, SLOT_SIZE[1] / 2 + 0.28, 0]}
        zIndexRange={[20, 0]}
      >
        <div className="pointer-events-none flex flex-col items-center text-center">
          {showFullText ? (
            <div
              className="max-w-44 rounded-md border bg-slate-900/95 px-3 py-1.5 text-xs leading-tight text-white opacity-100 shadow-[0_8px_20px_rgba(2,6,23,0.45)]"
              style={tooltipBorder}
            >
              <p className="font-semibold uppercase tracking-[0.12em] text-white">{style.label}</p>
              <p className="mt-0.5 text-[11px] font-medium text-white">{productText}</p>
            </div>
          ) : isHovered ? (
            <div
              className="max-w-40 rounded-md border bg-slate-900/95 px-3 py-1.5 text-xs leading-tight text-white opacity-100 shadow-[0_8px_20px_rgba(2,6,23,0.45)]"
              style={tooltipBorder}
            >
              <p className="font-semibold uppercase tracking-[0.12em] text-white">{style.label}</p>
              <p className="mt-0.5 text-[11px] font-medium text-white">{productText}</p>
            </div>
          ) : (
            <div
              className="h-2.5 w-2.5 rounded-full border border-slate-100/50 shadow-[0_0_4px_rgba(15,23,42,0.45)]"
              style={{ backgroundColor: style.fill }}
            />
          )}
          <div className="mt-1.5 h-4 w-px bg-slate-100/55" />
        </div>
      </Html>
    </group>
  )
}

function TruckCargoScene({ matrix, isResolving, isResolved }) {
  const rowCount = matrix.length
  const colCount = matrix[0]?.length ?? 0
  const stepX = SLOT_SIZE[0] + SLOT_GAP.x
  const stepZ = SLOT_SIZE[2] + SLOT_GAP.z
  const width = Math.max(0, (colCount - 1) * stepX + SLOT_SIZE[0])
  const depth = Math.max(0, (rowCount - 1) * stepZ + SLOT_SIZE[2])
  const baseX = -((colCount - 1) * stepX) / 2
  const baseZ = -((rowCount - 1) * stepZ) / 2
  const movingSlotRef = useRef(null)
  const animationPhaseRef = useRef("idle")
  const hasTriggeredRef = useRef(false)
  const isAnimatingRef = useRef(false)

  const sourceKey = useMemo(() => ({ row: 0, col: 3 }), [])
  const targetKey = useMemo(() => ({ row: 1, col: 3 }), [])
  const sourceSlot = matrix[sourceKey.row]?.[sourceKey.col]
  const targetSlot = matrix[targetKey.row]?.[targetKey.col]
  const canAnimate =
    Boolean(sourceSlot) &&
    Boolean(targetSlot) &&
    sourceSlot.type === "full" &&
    targetSlot.type === "free"

  const sourcePosition = useMemo(
    () => [baseX + sourceKey.col * stepX, 0, baseZ + sourceKey.row * stepZ],
    [baseX, baseZ, sourceKey.col, sourceKey.row, stepX, stepZ],
  )
  const targetPosition = useMemo(
    () => [baseX + targetKey.col * stepX, 0, baseZ + targetKey.row * stepZ],
    [baseX, baseZ, targetKey.col, targetKey.row, stepX, stepZ],
  )

  useEffect(() => {
    hasTriggeredRef.current = false
    isAnimatingRef.current = false
    animationPhaseRef.current = "idle"
    if (movingSlotRef.current) {
      movingSlotRef.current.position.set(sourcePosition[0], sourcePosition[1], sourcePosition[2])
    }
  }, [matrix, sourcePosition])

  useEffect(() => {
    if (!canAnimate) {
      return
    }

    if (isResolving && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true
      isAnimatingRef.current = true
      animationPhaseRef.current = "lift"
      if (movingSlotRef.current) {
        movingSlotRef.current.position.set(sourcePosition[0], sourcePosition[1], sourcePosition[2])
      }
      return
    }

    if (!isResolving && !isResolved) {
      hasTriggeredRef.current = false
      isAnimatingRef.current = false
      animationPhaseRef.current = "idle"
      if (movingSlotRef.current) {
        movingSlotRef.current.position.set(sourcePosition[0], sourcePosition[1], sourcePosition[2])
      }
      return
    }

    if (isResolved && !isAnimatingRef.current && movingSlotRef.current) {
      movingSlotRef.current.position.set(targetPosition[0], 0, targetPosition[2])
      animationPhaseRef.current = "complete"
    }
  }, [canAnimate, isResolving, isResolved, sourcePosition, targetPosition])

  useFrame((_, delta) => {
    if (!canAnimate || !isAnimatingRef.current || !movingSlotRef.current) {
      return
    }

    const movingPosition = movingSlotRef.current.position
    const smoothing = Math.min(1, delta * 5)

    if (animationPhaseRef.current === "lift") {
      movingPosition.x = THREE.MathUtils.lerp(movingPosition.x, sourcePosition[0], smoothing)
      movingPosition.z = THREE.MathUtils.lerp(movingPosition.z, sourcePosition[2], smoothing)
      movingPosition.y = THREE.MathUtils.lerp(movingPosition.y, 2, smoothing)

      if (Math.abs(movingPosition.y - 2) < 0.03) {
        animationPhaseRef.current = "translate"
      }
      return
    }

    if (animationPhaseRef.current === "translate") {
      movingPosition.x = THREE.MathUtils.lerp(movingPosition.x, targetPosition[0], smoothing)
      movingPosition.z = THREE.MathUtils.lerp(movingPosition.z, targetPosition[2], smoothing)
      movingPosition.y = THREE.MathUtils.lerp(movingPosition.y, 2, smoothing)

      if (Math.abs(movingPosition.x - targetPosition[0]) < 0.03 && Math.abs(movingPosition.z - targetPosition[2]) < 0.03) {
        animationPhaseRef.current = "lower"
      }
      return
    }

    if (animationPhaseRef.current === "lower") {
      movingPosition.x = THREE.MathUtils.lerp(movingPosition.x, targetPosition[0], smoothing)
      movingPosition.z = THREE.MathUtils.lerp(movingPosition.z, targetPosition[2], smoothing)
      movingPosition.y = THREE.MathUtils.lerp(movingPosition.y, 0, smoothing)

      if (Math.abs(movingPosition.y) < 0.03) {
        movingPosition.set(targetPosition[0], 0, targetPosition[2])
        animationPhaseRef.current = "complete"
        isAnimatingRef.current = false
      }
    }
  })

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

      <TruckFrame width={width} depth={depth} />

      {matrix.map((row, rowIndex) =>
        row.map((slot, colIndex) => (
          <SlotMesh
            key={`slot-${rowIndex}-${colIndex}-${slot.type}-${slot.product ?? "empty"}`}
            slot={slot}
            position={[baseX + colIndex * stepX, 0, baseZ + rowIndex * stepZ]}
            hidden={
              canAnimate &&
              ((isResolving || isResolved) && rowIndex === sourceKey.row && colIndex === sourceKey.col
                ? true
                : isResolved && rowIndex === targetKey.row && colIndex === targetKey.col)
            }
          />
        )),
      )}

      {canAnimate && (isResolving || isResolved) && (
        <SlotMesh
          slot={sourceSlot}
          position={sourcePosition}
          groupRef={movingSlotRef}
        />
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

function TruckCargo3D({ matrix, isResolving, isResolved }) {
  const safeMatrix = useMemo(() => normalizeMatrixInput(matrix), [matrix])

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
      <Canvas
        shadows
        camera={{ position: [6.4, 5.8, 6.9], fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <TruckCargoScene matrix={safeMatrix} isResolving={isResolving} isResolved={isResolved} />
      </Canvas>
    </div>
  )
}

export default TruckCargo3D
