function Tooltip({ product, weight }) {
  const productLabel = product ?? "Free slot"
  const weightLabel = weight ? `${weight} kg` : "0 kg"

  return (
    <div className="pointer-events-none absolute -top-2 left-1/2 z-20 w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-left text-xs opacity-0 shadow-xl transition duration-200 group-hover:opacity-100">
      <p className="font-semibold text-slate-200">{productLabel}</p>
      <p className="mt-1 text-slate-400">Weight: {weightLabel}</p>
    </div>
  )
}

export default Tooltip
