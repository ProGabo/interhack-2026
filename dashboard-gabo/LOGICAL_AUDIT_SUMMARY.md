# Logical Audit - `dashboard-gabo`

## Scope
- Audited core logic in `src/App.jsx`, `src/data/stops.js`, and main UI/state-related components.
- Focused on: truck state transitions, lateral accessibility, AI auto-resolve, and end-to-end data flow.

## 1) Truck State & Transitions (Source of Truth)
- **Current source of truth** is `currentStop = stopSnapshots[stopIndex]` in `src/App.jsx`.
- State changes between stops are handled by incrementing `stopIndex` in `handleNextStop`.
- There is **no computed transition engine** that applies delivery/pickup operations to a live truck model.
- Delivery (`target_unload`) and empty pickup (`empty_return`) behavior is currently **pre-modeled in static snapshots** inside `src/data/stops.js`.

### Audit Conclusion
- Robust for visual storytelling.
- Not robust yet as operational logic, because the truck state is switched by snapshot, not computed from actions.

## 2) Lateral Access Invariants (Blocked Unload Rule)
- There is **no runtime validator** (e.g. `isLateralAccessible(...)`) that checks whether a target pallet is physically blocked by another pallet.
- Blocking semantics are currently represented by:
  - snapshot labels (`target_unload`, `full`, `empty_return`, `free`),
  - predefined alerts (`kpis.ergonomic_alert`, `kpis.alert_message`).
- The UI displays the concept clearly, but there is no algorithm enforcing unload feasibility.

### Audit Conclusion
- The invariant is currently **communicated**, not **enforced** by logic.

## 3) KPI Simplification
- The current KPI layer is now focused on route progress, customer context, occupancy, and total weight.
- KPI values are either loaded from snapshots or estimated from cargo occupancy and weight when using shared mock data.

### Audit Conclusion
- KPI logic is lightweight and explainable for demo flow.

## 4) AI "Auto-Resolve" Logic
- "Auto-resolve" in `src/App.jsx` is a timed UX transition (`setTimeout(2500)`), not an optimizer.
- In `src/components/TruckCargo3D.jsx`, move coordinates are hardcoded:
  - source slot fixed at `{ row: 0, col: 3 }`,
  - target slot fixed at `{ row: 1, col: 3 }`.
- The move is therefore:
  - **not random**, and
  - **not heuristic-driven** (no search over free slots, no stop-priority, no distance/weight balancing).

### Audit Conclusion
- Strong visual demo effect, but current AI behavior is scripted rather than decision-based.

## 5) Data Flow (Dataset -> 3D Canvas -> KPI Cards)
- `src/main.jsx` mounts `App`.
- `App` selects one route snapshot via `stopIndex`.
- `currentStop` is passed into:
  - `HeaderKpis` for KPI display,
  - `ErgonomicAlert` for warning/resolution messaging,
  - `TruckGrid` with `currentStop.truck_state.matrix`.
- `TruckGrid` passes `matrix` into `TruckCargo3D`.
- `TruckCargo3D` renders slots by `type` and animates a scripted relocation during resolve flow.

### Audit Conclusion
- Data flow is clean and easy to explain for pitch.
- Computational logic is minimal and mostly precomputed/static.

## Mocked or Simplified Logic to Flag Before Demo
- **Static truck transitions**: no live update engine for unload + empty return pickup.
- **No lateral accessibility algorithm**: blocker detection is not computed.
- **Auto-resolve is scripted**: no real free-slot selection heuristic.
- **KPIs are mostly snapshot values**: limited recomputation after state changes.

## Quick, High-Impact Improvements (Pitch-Safe)
- Add a small `engine` utility that computes:
  - unload-access feasibility,
  - number of blocking moves (re-handles),
  - handling time impact from computed blockers.
- Replace hardcoded auto-resolve target with a heuristic:
  - choose free slot minimizing travel + preserving upcoming-stop accessibility.
- Recompute at least one KPI after resolve:
  - estimated handling time saved.
- Keep existing UI; inject computed results to preserve current visual polish.

## Final Assessment for Pitch
- The dashboard is currently **excellent for storytelling and UX**, but **partially mocked** in core decision logic.
- For final-pitch robustness, implement at least one real accessibility + rehandle computation path and connect it to the auto-resolve output.
