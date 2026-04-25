import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const colorsCss = readFileSync(join(here, "colors.css"), "utf8");

function tokenValue(name) {
  const match = colorsCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match?.[1]?.trim() || "";
}

describe("Governance Atlas design tokens", () => {
  it("uses Entrada dark shell tokens", () => {
    expect(tokenValue("--ga-bright-blue")).toBe("#66c5ff");
    expect(tokenValue("--ga-bg")).toBe("var(--ga-navy-980)");
    expect(tokenValue("--gh-accent")).toBe("var(--ga-bright-blue)");
  });

  it("defines compatibility aliases consumed by existing shell CSS", () => {
    ["--gh-bg", "--gh-surface", "--gh-border", "--gh-text", "--gh-ink", "--gh-line"].forEach((token) => {
      expect(tokenValue(token)).not.toBe("");
    });
  });
});
