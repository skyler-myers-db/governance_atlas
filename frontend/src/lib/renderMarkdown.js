/**
 * Tiny in-house markdown renderer for asset descriptions + glossary
 * definitions. Covers the subset the UI actually needs so we don't
 * pull in react-markdown (~100kB compressed) for two paragraph-level
 * fields.
 *
 * Supported syntax:
 *   # / ## / ### headings
 *   **bold**, *italic*, `inline code`
 *   [link text](https://example.com) — only http(s) + mailto
 *   - / * list items (one level; nesting renders flat)
 *   > blockquote (one level)
 *   Paragraphs (blank-line separated)
 *
 * Deliberately NOT supported: raw HTML, tables, images, footnotes,
 * reference-style links. Inputs that look like HTML are escaped.
 * Any URL that isn't http(s): or mailto: is rendered as plain text
 * so we can't be tricked into emitting javascript: hrefs.
 */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text) {
  let out = escapeHtml(text);
  // Bold must run before italic so **text** doesn't get half-consumed.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, '<code class="gh-md-code">$1</code>');
  // Links — only accept safe schemes. The match already quotes the URL
  // because it came through escapeHtml, so the serialized href is safe.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, rawHref) => {
    const href = rawHref.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return `[${label}](${rawHref})`;
    return `<a href="${href}" rel="noreferrer" target="_blank">${label}</a>`;
  });
  return out;
}

export function renderMarkdown(source) {
  const text = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const lines = text.split("\n");
  const blocks = [];
  let buffer = [];
  let inList = false;
  let inQuote = false;

  const flushParagraph = () => {
    if (!buffer.length) return;
    blocks.push(`<p>${renderInline(buffer.join(" "))}</p>`);
    buffer = [];
  };

  const closeList = () => {
    if (!inList) return;
    blocks.push("</ul>");
    inList = false;
  };

  const closeQuote = () => {
    if (!inQuote) return;
    blocks.push("</blockquote>");
    inQuote = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeQuote();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      closeQuote();
      const level = heading[1].length;
      blocks.push(`<h${level} class="gh-md-h">${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const listMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      closeQuote();
      if (!inList) {
        blocks.push('<ul class="gh-md-list">');
        inList = true;
      }
      blocks.push(`<li>${renderInline(listMatch[1])}</li>`);
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      if (!inQuote) {
        blocks.push('<blockquote class="gh-md-quote">');
        inQuote = true;
      }
      blocks.push(`<p>${renderInline(quoteMatch[1])}</p>`);
      continue;
    }

    if (inList || inQuote) {
      closeList();
      closeQuote();
    }
    buffer.push(line.trim());
  }

  flushParagraph();
  closeList();
  closeQuote();

  return blocks.join("\n");
}

/** React-safe dangerouslySetInnerHTML helper. */
export function markdownHtmlProps(source) {
  return { dangerouslySetInnerHTML: { __html: renderMarkdown(source) } };
}
