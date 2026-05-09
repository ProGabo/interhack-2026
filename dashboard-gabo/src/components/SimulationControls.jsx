import { ArrowRight, Package } from "lucide-react"

function SimulationControls({ currentStop, totalStops, onNextStop }) {
  return (
    <aside className="flex h-fit flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl lg:w-72">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Simulation</p>
        <h3 className="mt-1 text-lg font-semibold text-slate-100">Stop-by-stop preview</h3>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
        <p className="text-sm text-slate-300">
          You are viewing <span className="font-semibold text-amber-300">stop {currentStop}</span> of {totalStops}
          .
        </p>
      </div>

      <button
        type="button"
        onClick={onNextStop}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/70 bg-gradient-to-r from-red-700 to-red-600 px-4 py-3 text-sm font-semibold text-red-100 transition duration-300 hover:scale-[1.02] hover:from-red-600 hover:to-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300/60"
      >
        Next Stop
        <ArrowRight className="h-4 w-4" />
      </button>

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p className="inline-flex items-center gap-2 font-semibold">
          <Package className="h-4 w-4" />
          Friction benefit
        </p>
        <p className="mt-1 text-xs text-amber-200/90">
          Visual sequencing reduces rehandling and keeps side-curtain access clear for faster unloading.
        </p>
      </div>
    </aside>
  )
}

export default SimulationControls
