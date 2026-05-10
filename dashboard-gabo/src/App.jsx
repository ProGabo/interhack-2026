import { useEffect, useRef, useState } from "react"
import { Truck } from "lucide-react"
import HeaderKpis from "./components/HeaderKpis"
import ErgonomicAlert from "./components/ErgonomicAlert"
import TruckGrid from "./components/TruckGrid"
import SimulationControls from "./components/SimulationControls"
import { stopSnapshots, snapshotSource } from "./data/seedAdapter"

function App() {
  const [stopIndex, setStopIndex] = useState(0)
  const [isResolving, setIsResolving] = useState(false)
  const [isResolved, setIsResolved] = useState(false)
  const [kpiAnimationKey, setKpiAnimationKey] = useState(1)
  const resolveTimeoutRef = useRef(null)
  const hasStops = stopSnapshots.length > 0
  const safeStopIndex = hasStops ? stopIndex % stopSnapshots.length : 0
  const currentStop = hasStops ? stopSnapshots[safeStopIndex] : null

  useEffect(() => {
    return () => {
      if (resolveTimeoutRef.current) {
        clearTimeout(resolveTimeoutRef.current)
      }
    }
  }, [])

  const handleAutoResolve = () => {
    if (isResolving || isResolved) {
      return
    }

    setKpiAnimationKey((prev) => prev + 1)
    setIsResolving(true)
    resolveTimeoutRef.current = setTimeout(() => {
      setIsResolving(false)
      setIsResolved(true)
      resolveTimeoutRef.current = null
    }, 2500)
  }

  const handleNextStop = () => {
    if (resolveTimeoutRef.current) {
      clearTimeout(resolveTimeoutRef.current)
      resolveTimeoutRef.current = null
    }
    setKpiAnimationKey((prev) => prev + 1)
    setIsResolving(false)
    setIsResolved(false)
    setStopIndex((prevIndex) => {
      if (stopSnapshots.length === 0) return 0
      return (prevIndex + 1) % stopSnapshots.length
    })
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
            <div className="flex flex-col items-end gap-2">
              <p className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">
                Data source: {snapshotSource}
              </p>
            </div>
          </div>
        </header>

        {!currentStop ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center text-slate-300">
            No stop snapshots available.
          </section>
        ) : (
          <>
            <HeaderKpis
              data={currentStop}
              kpiAnimationKey={kpiAnimationKey}
            />
            <ErgonomicAlert
              data={currentStop}
              isResolving={isResolving}
              isResolved={isResolved}
              onAutoResolve={handleAutoResolve}
            />

            <section className="grid gap-6 lg:grid-cols-[1fr_auto]">
              <TruckGrid
                key={safeStopIndex}
                matrix={currentStop?.truck_state?.matrix ?? []}
                isResolving={isResolving}
                isResolved={isResolved}
              />
              <SimulationControls
                currentStop={currentStop?.route_progress?.current_stop ?? 0}
                totalStops={currentStop?.route_progress?.total_stops ?? 0}
                onNextStop={handleNextStop}
              />
            </section>
          </>
        )}
      </div>
    </main>
  )
}

export default App
