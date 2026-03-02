import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:text-ws-text prose-p:text-ws-text/90 prose-strong:text-ws-text prose-a:text-ws-accent prose-code:text-ws-accent prose-code:bg-ws-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-ws-surface prose-pre:border prose-pre:border-ws-border prose-td:text-ws-text/90 prose-th:text-ws-text">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}
