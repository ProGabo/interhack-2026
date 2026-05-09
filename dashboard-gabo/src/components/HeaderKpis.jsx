import { useEffect, useState } from "react"
import { MapPinned, Package, UserRound } from "lucide-react"

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

function HeaderKpis({ data, kpiAnimationKey = 0 }) {
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
  ]
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

    </section>
  )
}

export default HeaderKpis
