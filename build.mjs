// Builds the single self-contained page that gets published as the Claude artifact.
// src/index.html + src/styles.css + src/app.js  ->  dist/money-tracker.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const read = f => readFileSync(new URL(`./src/${f}`, import.meta.url), "utf8");
let html = read("index.html");
const link = '<link rel="stylesheet" href="styles.css">';
const script = '<script src="app.js"></script>';
if (!html.includes(link) || !html.includes(script)) {
  console.error("build: src/index.html must contain the styles.css link and the app.js script tag");
  process.exit(1);
}
// function replacers so "$" in the code is never treated as a pattern
html = html.replace(link, () => `<style>\n${read("styles.css")}</style>`);
html = html.replace(script, () => `<script>\n${read("app.js")}</script>`);

mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("./dist/money-tracker.html", import.meta.url), html);
console.log(`build: dist/money-tracker.html (${(html.length / 1024).toFixed(1)} kB)`);
