import { useState, useEffect } from 'react'

interface LoadingSpinnerProps {
  messages?: string[]
  showElapsed?: boolean
}

export default function LoadingSpinner({ messages, showElapsed }: LoadingSpinnerProps) {
  const [msgIndex, setMsgIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!messages?.length) return
    const id = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 3000)
    return () => clearInterval(id)
  }, [messages])

  useEffect(() => {
    if (!showElapsed) return
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [showElapsed])

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-ws-border border-t-ws-accent" />
      {messages?.length ? (
        <p className="mt-4 text-sm text-ws-muted animate-pulse">{messages[msgIndex]}</p>
      ) : null}
      {showElapsed && <p className="mt-2 text-xs text-ws-muted/60">{elapsed}s</p>}
    </div>
  )
}
