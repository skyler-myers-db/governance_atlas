/**
 * Phase 2 polish — Lineage PNG export.
 *
 * The ReactFlow graph is rendered into a mix of HTML (the node cards)
 * and SVG (edges + background). Browsers can only serialize SVG
 * directly, so we take the hybrid approach: walk the viewport, copy
 * computed styles inline onto the HTML subtree, wrap the whole thing
 * as an <svg> + <foreignObject>, then rasterize via <canvas>.
 *
 * No npm dep. Runs entirely in the browser, uses only built-in
 * DOM APIs. Returns a Promise that resolves with the PNG blob so
 * callers can further process (e.g. copy-to-clipboard) if they want,
 * but the default behavior is "download a file and resolve".
 */

function inlineComputedStyles(root) {
  if (!root) return root;
  const clone = root.cloneNode(true);
  const rootElements = root.querySelectorAll("*");
  const cloneElements = clone.querySelectorAll("*");
  const inline = (src, dst) => {
    const style = window.getComputedStyle(src);
    // Only inline the properties that survive the serialization.
    // Everything else gets dropped to keep the payload small.
    let css = "";
    for (let i = 0; i < style.length; i += 1) {
      const prop = style.item(i);
      const value = style.getPropertyValue(prop);
      if (value) {
        css += `${prop}:${value};`;
      }
    }
    dst.setAttribute("style", css);
  };
  inline(root, clone);
  for (let i = 0; i < rootElements.length; i += 1) {
    inline(rootElements[i], cloneElements[i]);
  }
  return clone;
}

function nodeToSvg(node) {
  const rect = node.getBoundingClientRect();
  const width = Math.max(Math.ceil(rect.width), 320);
  const height = Math.max(Math.ceil(rect.height), 240);
  const clone = inlineComputedStyles(node);
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#f7f9fc"/>` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div>` +
    `</foreignObject>` +
    `</svg>`;
  return { svg, width, height };
}

function svgToPngBlob(svg, width, height) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f7f9fc";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) {
            reject(new Error("canvas toBlob returned null"));
            return;
          }
          resolve(pngBlob);
        }, "image/png");
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    image.src = url;
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportLineagePng(node, fqn = "lineage") {
  if (!node || typeof window === "undefined") {
    throw new Error("Lineage viewport not available for export.");
  }
  const { svg, width, height } = nodeToSvg(node);
  const png = await svgToPngBlob(svg, width, height);
  const safeFqn = String(fqn || "lineage").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  download(png, `governance-hub-lineage-${safeFqn}.png`);
  return png;
}
