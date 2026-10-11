import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

function MessageHeading({ children }: { children?: ReactNode }) {
  return <h3 className="pt-1 font-display text-base font-semibold text-text">{children}</h3>;
}

const components: Components = {
  // Chat is already a level-two section. Generated headings stay inside it.
  h1: MessageHeading,
  h2: MessageHeading,
  h3: MessageHeading,
  h4: MessageHeading,
  h5: MessageHeading,
  h6: MessageHeading,
  p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-1.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1 [&>p+p]:mt-2 [&>ul]:mt-2 [&>ol]:mt-2">{children}</li>,
  blockquote: ({ children }) => <blockquote className="space-y-2 border-l-2 border-cobalt/50 pl-3 text-muted">{children}</blockquote>,
  a: ({ children, href, title }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer" className="text-cobalt underline decoration-cobalt/50 underline-offset-2 hover:decoration-cobalt focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt">
      {children}
    </a>
  ),
  code: ({ children, className }) => (
    <code className={`rounded bg-raised px-1 py-0.5 font-mono text-[0.85em] ${className || ''}`}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-ink p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] [&>code]:block [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-line" />,
};

export default function MessageContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-3 break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown skipHtml components={components}>{content}</ReactMarkdown>
    </div>
  );
}
