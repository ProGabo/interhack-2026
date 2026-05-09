import { AlertTriangle } from "lucide-react"

function ErgonomicAlert({ data, isResolving, isResolved, onAutoResolve }) {
  if (!data.kpis.ergonomic_alert) {
    return null
  }

  const bannerClasses = isResolved
    ? "rounded-xl border border-emerald-500/60 bg-emerald-950/60 p-4 shadow-lg shadow-emerald-900/20 transition-colors duration-500"
    : "rounded-xl border border-red-500/60 bg-red-950/60 p-4 shadow-lg shadow-red-900/20 transition-colors duration-500"

  const titleClasses = isResolved
    ? "text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300"
    : "text-xs font-semibold uppercase tracking-[0.22em] text-red-300"

  return (
    <section className={bannerClasses}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${isResolved ? "text-emerald-300" : "text-red-300"}`} />
        <div className="flex-1">
          <p className={titleClasses}>{isResolved ? "AI Resolution Complete" : "Ergonomic Alert"}</p>
          <p className={`mt-1 text-sm ${isResolved ? "text-emerald-100" : "text-red-100"}`}>
            {isResolved ? "✅ Conflict resolved: 3 rehandles prevented" : data.kpis.alert_message}
          </p>
          <p className={`mt-1 text-xs ${isResolved ? "text-emerald-200/80" : "text-red-200/80"}`}>
            {isResolving ? "AI optimizing pallet order and clearing side-curtain access..." : data.stop_details.action_summary}
          </p>
          <button
            type="button"
            onClick={onAutoResolve}
            disabled={isResolving || isResolved}
            className="mt-3 inline-flex items-center rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.5)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isResolving ? "AI Resolving..." : isResolved ? "Resolved with AI" : "✨ Auto-Resolve with AI"}
          </button>
        </div>
      </div>
    </section>
  )
}

export default ErgonomicAlert
