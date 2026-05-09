import { Package2, Recycle } from "lucide-react"
import Tooltip from "./Tooltip"

const cellTypeStyles = {
  target_unload:
    "border-[#cfab2e] bg-[#cfab2e] text-zinc-950 shadow-[0_0_0_2px_rgba(207,171,46,0.9),0_0_28px_rgba(207,171,46,0.85)] animate-neon-border",
  full: "border-[#9f8032] bg-[#b5963a] text-[#221b0a]",
  empty_return: "border-[#737b84] bg-[#8b8f94] text-white",
  free: "border-2 border-dotted border-slate-600 bg-[#1c1f24] text-slate-400",
}

const cellTypeLabel = {
  target_unload: "Unload now",
  full: "Future stop load",
  empty_return: "Empty return",
  free: "Free slot",
}

function TruckCell({ slot }) {
  const isTarget = slot.type === "target_unload"
  const isFree = slot.type === "free"
  const icon =
    slot.type === "empty_return" ? (
      <Recycle className="h-4 w-4 text-white" />
    ) : (
      <Package2 className="h-4 w-4" />
    )

  return (
    <article
      className={`group relative flex h-30 min-w-28 flex-col justify-between overflow-visible rounded-md border p-3 transition-all duration-500 hover:-translate-y-1 ${cellTypeStyles[slot.type]} ${isFree ? "" : "origin-bottom skew-x-[-4deg] shadow-[inset_-12px_-12px_18px_rgba(0,0,0,0.22)]"}`}
    >
      {isTarget && (
        <p className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border border-[#cfab2e] bg-black px-2 py-0.5 text-[10px] font-bold tracking-[0.2em] text-[#ffe07d]">
          UNLOAD NOW
        </p>
      )}
      <Tooltip product={slot.product} weight={slot.weight} />
      {!isFree && (
        <div className="pointer-events-none absolute inset-x-2 top-1 h-2 rounded-full bg-white/20 blur-[1px]" />
      )}
      {!isFree && <div className="pointer-events-none absolute -bottom-3 left-3 right-3 h-3 rounded-full bg-black/40 blur-[2px]" />}

      <div className="flex items-center justify-between text-xs font-medium">
        <span className="uppercase tracking-[0.16em]">{cellTypeLabel[slot.type]}</span>
        {!isFree && icon}
      </div>

      <div>
        <p className="line-clamp-2 text-sm font-semibold">
          {slot.product ?? "Free slot"}
        </p>
        <p className="mt-1 text-xs opacity-90">{slot.weight} kg</p>
      </div>
    </article>
  )
}

export default TruckCell
