"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

type MessageMarkdownProps = {
  content: string;
};

export function MessageMarkdown({ content }: MessageMarkdownProps) {
  if (!content) {
    return <span className="text-muted-foreground">...</span>;
  }

  return (
    <div className="markdown-content">
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="text-lg font-semibold mt-3 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc list-outside pl-6 my-1.5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-outside pl-6 my-1.5 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="px-1 py-0.5 bg-muted border border-border/50 rounded text-xs font-mono text-foreground" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 p-3 bg-muted border border-border rounded-md overflow-x-auto text-xs text-foreground">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/30 pl-3 my-2 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
