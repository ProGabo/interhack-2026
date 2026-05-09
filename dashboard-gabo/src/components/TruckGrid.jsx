import { Star } from "lucide-react"
import TruckCargo3D from "./TruckCargo3D"

function TruckGrid({ matrix, isResolving, isResolved }) {
  return (
    <section className="grid-enter relative rounded-2xl border border-slate-800 bg-slate-950/65 p-3 shadow-2xl sm:p-4">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Truck Side Curtain View</p>
          <h2 className="text-lg font-semibold text-slate-100">Damm Digital Twin</h2>
        </div>
        <p className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
          {matrix.length} rows x {matrix[0]?.length ?? 0} slots
        </p>
      </header>

      <div className="rounded-2xl border border-zinc-700/80 bg-[#1a1a1a] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:p-4">
        <div className="flex items-stretch gap-3">
          <aside className="relative hidden w-40 shrink-0 rounded-xl border border-zinc-700 bg-gradient-to-b from-zinc-900 to-black p-3 md:block">
            <div className="h-full rounded-lg border border-zinc-700 bg-zinc-900 p-2">
              <div className="h-12 rounded-md border border-sky-300/30 bg-gradient-to-b from-sky-200/35 to-sky-700/25" />
              <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-950/90 px-2 py-1">
                <p className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-white">
                  <Star className="h-3.5 w-3.5 fill-current text-yellow-500" />
                  Estrella Damm
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="h-3 w-6 rounded-full bg-yellow-200 shadow-[0_0_10px_rgba(253,224,71,0.8)]" />
                <div className="h-6 w-8 rounded-md border border-zinc-700 bg-zinc-800" />
              </div>
              <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">Cabin module</p>
            </div>
            <div className="absolute bottom-5 left-0 h-12 w-5 rounded-r-full bg-zinc-800" />
            <div className="absolute bottom-5 right-0 h-12 w-5 rounded-l-full bg-zinc-800" />
          </aside>

          <div className="relative flex-1 rounded-xl border border-slate-700 bg-zinc-900/90 p-3 sm:p-4">
            <div className="mb-4 overflow-hidden rounded-xl border border-red-400/60 bg-gradient-to-r from-red-900 via-red-700 to-red-900 px-4 py-2 shadow-[inset_0_-8px_18px_rgba(0,0,0,0.45)]">
              <div className="h-2 w-full rounded-full bg-red-500/80 shadow-[0_2px_10px_rgba(239,68,68,0.45)]" />
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-red-100/90">
                Rolled side curtain open
              </p>
            </div>

            <TruckCargo3D matrix={matrix} isResolving={isResolving} isResolved={isResolved} />
          </div>
        </div>

        <div className="mt-3 hidden items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/90 px-8 py-2 md:flex">
          <div className="h-2 w-18 rounded-full bg-zinc-700" />
          <div className="h-14 w-14 rounded-full border-4 border-zinc-900 bg-gradient-to-b from-zinc-500 to-zinc-800 shadow-[inset_0_0_0_8px_rgba(0,0,0,0.35)]" />
          <div className="h-14 w-14 rounded-full border-4 border-zinc-900 bg-gradient-to-b from-zinc-500 to-zinc-800 shadow-[inset_0_0_0_8px_rgba(0,0,0,0.35)]" />
          <div className="h-2 w-18 rounded-full bg-zinc-700" />
        </div>
      </div>
    </section>
  )
}

export default TruckGrid
