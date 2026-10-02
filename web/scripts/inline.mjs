// Inlines the built JS and CSS into dist/index.html so the preview is one file.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
let html = readFileSync(new URL("index.html", dist), "utf8");
const assets = readdirSync(new URL("assets/", dist));
for (const file of assets) {
  const body = readFileSync(new URL(`assets/${file}`, dist), "utf8");
  if (file.endsWith(".css")) {
    html = html.replace(new RegExp(`<link[^>]*${file.replace(".", "\\.")}[^>]*>`), () => `<style>${body}</style>`);
  } else if (file.endsWith(".js")) {
    html = html.replace(new RegExp(`<script[^>]*${file.replace(".", "\\.")}[^>]*></script>`), "");
    html = html.replace("</body>", () => `<script type="module">${body.replace(/<\/script/g, "<\\/script")}</script></body>`);
  }
}
writeFileSync(new URL("index.single.html", dist), html);
console.log("wrote dist/index.single.html", (html.length / 1024).toFixed(0) + " KB");
