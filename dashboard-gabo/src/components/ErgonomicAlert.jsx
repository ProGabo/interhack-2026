import { AlertTriangle } from "lucide-react"

function ErgonomicAlert({ data }) {
  if (!data.kpis.ergonomic_alert) {
    return null
  }

  return (
    <section className="rounded-xl border border-red-500/60 bg-red-950/60 p-4 shadow-lg shadow-red-900/20">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-300">Ergonomic Alert</p>
          <p className="mt-1 text-sm text-red-100">{data.kpis.alert_message}</p>
          <p className="mt-1 text-xs text-red-200/80">{data.stop_details.action_summary}</p>
        </div>
      </div>
    </section>
  )
}

export default ErgonomicAlert
