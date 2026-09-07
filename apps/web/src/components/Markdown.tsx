import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function Markdown({ text }: { text: string }) {
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="markdown-image">{alt || "[image]"}</span>,
    pre: ({ children }) => <pre className="code">{children}</pre>,
    table: ({ children }) => <div className="prose-table" tabIndex={0}><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>
}
