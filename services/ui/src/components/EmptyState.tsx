interface EmptyStateProps {
  message: string
  detail?: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ message, detail, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 text-4xl text-ws-muted/40">---</div>
      <p className="text-lg font-semibold text-ws-muted">{message}</p>
      {detail && <p className="mt-1 text-sm text-ws-muted/70">{detail}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg bg-ws-accent px-4 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
