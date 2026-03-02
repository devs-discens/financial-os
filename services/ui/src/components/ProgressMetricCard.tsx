interface ProgressMetricCardProps {
  label: string
  value: string
  subtitle?: string
  nationalValue?: string
  peerValue?: string
}

export default function ProgressMetricCard({ label, value, subtitle, nationalValue, peerValue }: ProgressMetricCardProps) {
  return (
    <div className="rounded-xl bg-white border border-ws-border p-5 shadow-sm">
      <p className="text-xs font-semibold text-ws-muted uppercase tracking-wider">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-ws-muted">{subtitle}</p>}

      {(nationalValue || peerValue) && (
        <div className="mt-3 pt-3 border-t border-ws-border space-y-1.5">
          {peerValue && (
            <div className="flex justify-between text-xs">
              <span className="text-ws-muted">Peers</span>
              <span className="text-ws-blue font-semibold">{peerValue}</span>
            </div>
          )}
          {nationalValue && (
            <div className="flex justify-between text-xs">
              <span className="text-ws-muted">National</span>
              <span className="text-ws-purple font-semibold">{nationalValue}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
