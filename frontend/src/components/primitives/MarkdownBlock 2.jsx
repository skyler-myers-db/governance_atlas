import { markdownHtmlProps } from "../../lib/renderMarkdown";

/**
 * Renders asset description / glossary definition text with the
 * in-house markdown subset (see lib/renderMarkdown.js). Handles empty
 * input gracefully — returns the fallback node instead of an empty
 * paragraph.
 */
export function MarkdownBlock({ source, fallback = null, className = "" }) {
  const trimmed = String(source || "").trim();
  if (!trimmed) return fallback;
  return <div className={`gh-md ${className}`.trim()} {...markdownHtmlProps(trimmed)} />;
}
