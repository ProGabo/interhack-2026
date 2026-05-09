import { useEffect, useState } from "react"
import { Gauge, Info, MapPinned, Package, UserRound } from "lucide-react"

const cardStyles =
  "h-full min-h-[148px] rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg transition-transform duration-300 hover:-translate-y-0.5"

function useCountUp(targetValue, animationKey, decimals = 0, durationMs = 900) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    let frameId
    const startTime = performance.now()

    const animate = (now) => {
      const progress = Math.min((now - startTime) / durationMs, 1)
      setDisplayValue(targetValue * progress)
      if (progress < 1) {
        frameId = requestAnimationFrame(animate)
      }
    }

    frameId = requestAnimationFrame(animate)

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [animationKey, targetValue, durationMs])

  return displayValue.toFixed(decimals)
}

function HeaderKpis({ data, optimizedFriction: optimizedFrictionOverride, kpiAnimationKey = 0 }) {
  const baseCards = [
    {
      title: "Route Progress",
      value: `${data.route_progress.current_stop}/${data.route_progress.total_stops}`,
      subtitle: "Current stop",
      icon: MapPinned,
      accent: "text-amber-300",
    },
    {
      title: "Current Customer",
      value: data.stop_details.client_name,
      subtitle: data.stop_details.time_window,
      icon: UserRound,
      accent: "text-red-300",
    },
    {
      title: "Occupancy",
      value: null,
      subtitle: `${data.kpis.total_weight_kg} kg`,
      icon: Package,
      accent: "text-sky-300",
    },
    {
      title: "Friction Score",
      value: `${data.kpis.friction_score_10}/10`,
      subtitle: "Warehouse + driver friction",
      icon: Gauge,
      accent: "text-amber-300",
      hidden: true,
    }
  ]
  const optimizedFriction = optimizedFrictionOverride ?? Math.max(1, data.kpis.friction_score_10 - 5)
  const animatedOccupancy = useCountUp(data.kpis.occupancy_percent, kpiAnimationKey, 0)

  return (
    <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      {baseCards
        .filter((item) => !item.hidden)
        .map(({ title, value, subtitle, icon: Icon, accent }) => (
        <article
          key={title}
          className={cardStyles}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</p>
            <Icon className={`h-4 w-4 ${accent}`} />
          </div>
          <p className="line-clamp-2 text-lg font-semibold tracking-tight text-slate-100">
            {title === "Occupancy" && `${animatedOccupancy}%`}
            {title !== "Occupancy" && value}
          </p>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        </article>
      ))}

      <article className="h-full min-h-[148px] rounded-xl border border-red-500/50 bg-gradient-to-br from-zinc-950 via-slate-900 to-zinc-950 p-4 shadow-lg shadow-red-900/20 transition-transform duration-300 hover:-translate-y-0.5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Friction Impact</p>
          <Gauge className="h-4 w-4 text-amber-300" />
        </div>
        <p className="text-sm font-semibold text-slate-100">
          Original Friction: <span className="text-red-400">{data.kpis.friction_score_10}/10</span>
          <span className="mx-1 text-slate-500">→</span>
          Smart Truck Optimization: <span className="text-emerald-400">{optimizedFriction}/10</span>
        </p>
        <p className="mt-1 text-sm text-gray-400">
          We pre-sequence pallets by stop access, reducing blocking moves and giving direct side-curtain reach at unloading time.
        </p>
        <p className="mt-2 text-xs font-medium text-emerald-300">Direct-access sequencing reduces blocking moves at this stop.</p>
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-2.5">
          <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            Why We Win
          </p>
          <p className="text-[11px] leading-relaxed text-slate-300">
            Friction Optimization measures how many pallets need to be moved to reach the target. A score
            of 8 means the load is blocked; a 3 means direct access. Our algorithm orders the load so the
            pallet for the current stop stays on the outside of the truck.
          </p>
        </div>
      </article>
    </section>
  )
}

export default HeaderKpis
