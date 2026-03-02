interface BenchmarkBarProps {
  label: string
  you: number
  peer: number
  national: number
  format?: (v: number) => string
  lowerIsBetter?: boolean
}

export default function BenchmarkBar({ label, you, peer, national, format, lowerIsBetter }: BenchmarkBarProps) {
  const fmt = format || ((v: number) => v.toFixed(1))

  // Compute bar widths relative to max value
  const maxVal = Math.max(you, peer, national, 0.01)
  const youPct = (you / maxVal) * 100
  const peerPct = (peer / maxVal) * 100
  const nationalPct = (national / maxVal) * 100

  // Color: green if you're ahead, orange if behind
  const isBetter = lowerIsBetter ? you <= peer : you >= peer
  const youColor = isBetter ? 'bg-ws-green' : 'bg-ws-orange'

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>

      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ws-muted w-16 shrink-0">You</span>
          <div className="flex-1 h-3 rounded-full bg-ws-surface overflow-hidden">
            <div className={`h-full rounded-full ${youColor} transition-all`} style={{ width: `${youPct}%` }} />
          </div>
          <span className="text-xs font-semibold w-16 text-right">{fmt(you)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ws-muted w-16 shrink-0">Peers</span>
          <div className="flex-1 h-3 rounded-full bg-ws-surface overflow-hidden">
            <div className="h-full rounded-full bg-ws-blue transition-all" style={{ width: `${peerPct}%` }} />
          </div>
          <span className="text-xs font-semibold w-16 text-right">{fmt(peer)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ws-muted w-16 shrink-0">National</span>
          <div className="flex-1 h-3 rounded-full bg-ws-surface overflow-hidden">
            <div className="h-full rounded-full bg-ws-purple transition-all" style={{ width: `${nationalPct}%` }} />
          </div>
          <span className="text-xs font-semibold w-16 text-right">{fmt(national)}</span>
        </div>
      </div>
    </div>
  )
}
