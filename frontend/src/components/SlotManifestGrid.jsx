export default function SlotManifestGrid({ manifest }) {
  const slots = manifest?.slots ?? []

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
        {slots.map((slot) => (
          <div className={`slot-row slot-row-${slot.status}`} key={slot.key}>
            <p className="slot-coordinate">{slot.coordinate}</p>
            <p className="slot-assignment">{slot.assignment}</p>
            <p className="slot-access">{slot.access}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
