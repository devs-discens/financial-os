import { useState } from 'react'
import type { ThinkingStep } from '../types/council'

export default function ThinkingSteps({ steps }: { steps: ThinkingStep[] }) {
  const [expanded, setExpanded] = useState(false)

  if (!steps.length) return null

  const firstTs = new Date(steps[0].ts).getTime()

  return (
    <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-ws-muted hover:text-ws-text transition-colors w-full text-left"
      >
        <span className="text-xs">{expanded ? '▼' : '▶'}</span>
        Thinking Steps ({steps.length})
      </button>
      {expanded && (
        <div className="mt-3 ml-2 border-l border-ws-border pl-4 space-y-2">
          {steps.map((step, i) => {
            const delta = ((new Date(step.ts).getTime() - firstTs) / 1000).toFixed(1)
            return (
              <div key={i} className="relative">
                <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ws-accent" />
                <div className="flex items-baseline gap-3">
                  <span className="text-xs text-ws-muted/60 w-12 shrink-0 text-right">+{delta}s</span>
                  <span className="text-xs font-mono text-ws-accent font-semibold">{step.action}</span>
                </div>
                <p className="ml-15 text-xs text-ws-muted mt-0.5 pl-15" style={{ paddingLeft: '3.75rem' }}>
                  {step.detail}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
