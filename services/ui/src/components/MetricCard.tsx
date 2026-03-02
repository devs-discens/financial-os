interface MetricCardProps {
  label: string
  value: string
  subtitle?: string
}

export default function MetricCard({ label, value, subtitle }: MetricCardProps) {
  return (
    <div className="rounded-xl bg-white border border-ws-border p-5 shadow-sm">
      <p className="text-xs font-semibold text-ws-muted uppercase tracking-wider">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-ws-muted">{subtitle}</p>}
    </div>
  )
}
