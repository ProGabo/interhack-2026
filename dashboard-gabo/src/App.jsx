import { useMemo, useState } from "react"
import { Truck } from "lucide-react"
import HeaderKpis from "./components/HeaderKpis"
import ErgonomicAlert from "./components/ErgonomicAlert"
import TruckGrid from "./components/TruckGrid"
import SimulationControls from "./components/SimulationControls"
import { stopSnapshots } from "./data/stops"

function App() {
  const [stopIndex, setStopIndex] = useState(0)
  const currentStop = stopSnapshots[stopIndex]
  const optimizedFriction = useMemo(() => (stopIndex === 0 ? 3 : 4), [stopIndex])

  const handleNextStop = () => {
    setStopIndex((prevIndex) => (prevIndex + 1) % stopSnapshots.length)
  }

  return (
    <main className="overflow-x-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-950 px-3 py-3 text-slate-100 sm:px-4 sm:py-4">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
                <Truck className="h-6 w-6 text-amber-300" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Damm Smart Truck</p>
                <h1 className="text-lg font-semibold tracking-tight text-slate-50 sm:text-2xl">
                  Digital Twin Dashboard
                </h1>
              </div>
            </div>
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-200">
              Current Friction: {currentStop.kpis.friction_score_10}/10 - Optimized Friction: {optimizedFriction}/10
            </p>
          </div>
        </header>

        <HeaderKpis data={currentStop} />
        <ErgonomicAlert data={currentStop} />

        <section className="grid gap-6 lg:grid-cols-[1fr_auto]">
          <TruckGrid key={stopIndex} matrix={currentStop.truck_state.matrix} />
          <SimulationControls
            currentStop={currentStop.route_progress.current_stop}
            totalStops={currentStop.route_progress.total_stops}
            onNextStop={handleNextStop}
          />
        </section>
      </div>
    </main>
  )
}

export default App
