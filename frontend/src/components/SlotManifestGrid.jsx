export default function SlotManifestGrid({ manifest }) {
  const layeredSlots = manifest?.layeredSlots ?? []
  const fallbackSlots = manifest?.slots ?? []
  const slots = (layeredSlots.length > 0 ? layeredSlots : fallbackSlots.map((slot) => ({
    ...slot,
    slotId: slot.slotId ?? `R${Number(slot?.row ?? 0) + 1}`,
    depth: slot.depth ?? 'N/A',
    layers: Array.isArray(slot?.layers) ? slot.layers : [slot],
    access: slot.access ?? 'Center lane access',
  }))).map((slot) => {
    const layers = Array.isArray(slot?.layers) ? slot.layers : []
    const occupiedLayers = layers.filter((layer) => layer.status !== 'empty')
    const currentTop = [...layers].reverse().find((layer) => layer.status !== 'empty') ?? null
    const layerSummary = layers
      .map((layer) => {
        if (layer.status === 'active') return `L${layer.layerIndex + 1}:Stop ${layer.upcomingSequence}`
        if (layer.status === 'return_assigned') return `L${layer.layerIndex + 1}:Return`
        return `L${layer.layerIndex + 1}:Empty`
      })
      .join(' | ')
    return {
      key: slot.key,
      coordinate: `${slot.slotId} (${slot.depth})`,
      assignment: currentTop?.assignment ?? 'Reserved empty slot',
      access: slot.access,
      status: currentTop?.status ?? 'empty',
      layerSummary,
      occupancySummary: `${occupiedLayers.length}/${layers.length} layers used`,
    }
  })

  return (
    <section className="slot-manifest-card" aria-label="Tetris slot-based loading manifest">
      <header className="slot-manifest-header">
        <p className="slot-manifest-kicker">Tetris Slot-Based Loading Manifest</p>
        <h4>Exact Physical Slot Matrix</h4>
      </header>
      <div className="slot-manifest-grid">
        <div className="slot-manifest-grid-head">Slot</div>
        <div className="slot-manifest-grid-head">Assignment</div>
        <div className="slot-manifest-grid-head">Curtain Access</div>
        <div className="slot-manifest-grid-head">Layer State</div>
        {slots.map((slot) => (
          <div className={`slot-row slot-row-${slot.status}`} key={slot.key}>
            <p className="slot-coordinate">{slot.coordinate}</p>
            <p className="slot-assignment">{slot.assignment}</p>
            <p className="slot-access">{slot.access}</p>
            <p className="slot-assignment">{slot.occupancySummary} | {slot.layerSummary}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
