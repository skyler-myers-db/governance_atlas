import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

describe("renderMarkdown", () => {
  it("returns empty string for blank input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   ")).toBe("");
  });

  it("wraps paragraph text in <p>", () => {
    expect(renderMarkdown("hello")).toContain("<p>hello</p>");
  });

  it("renders ** bold **", () => {
    expect(renderMarkdown("hello **world**")).toContain("<strong>world</strong>");
  });

  it("renders *italic*", () => {
    expect(renderMarkdown("hello *world*")).toContain("<em>world</em>");
  });

  it("renders `inline code`", () => {
    expect(renderMarkdown("run `npm test`")).toContain('<code class="gh-md-code">npm test</code>');
  });

  it("renders headings", () => {
    expect(renderMarkdown("# Title\npara")).toContain('<h1 class="gh-md-h">Title</h1>');
    expect(renderMarkdown("## Sub\n")).toContain('<h2 class="gh-md-h">Sub</h2>');
  });

  it("renders unordered lists", () => {
    const out = renderMarkdown("- one\n- two\n- three");
    expect(out).toContain('<ul class="gh-md-list">');
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<li>three</li>");
    expect(out).toContain("</ul>");
  });

  it("renders blockquotes", () => {
    const out = renderMarkdown("> quoted\n> text");
    expect(out).toContain("blockquote");
    expect(out).toContain("quoted");
  });

  it("escapes raw HTML input", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("only accepts safe link schemes", () => {
    const safe = renderMarkdown("[site](https://example.com)");
    expect(safe).toContain('href="https://example.com"');
    const evil = renderMarkdown("[bad](javascript:alert(1))");
    // Unsafe scheme gets rendered as plain text — no anchor tag emitted.
    expect(evil).not.toContain("<a ");
    expect(evil).not.toContain('href="javascript:');
  });

  it("renders mailto links", () => {
    expect(renderMarkdown("[email](mailto:a@b.com)")).toContain('href="mailto:a@b.com"');
  });

  it("separates paragraphs on blank lines", () => {
    const out = renderMarkdown("one\n\ntwo");
    expect((out.match(/<p>/g) || []).length).toBe(2);
  });
});
