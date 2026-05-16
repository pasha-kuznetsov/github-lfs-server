/**
 * Renders ./wrangler.jsonc from ./wrangler.template.jsonc using Handlebars.
 * Context JSON is read from ./vars.json (run from repository root).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Handlebars from "handlebars";

const cwd = process.cwd();
const varsPath = resolve(cwd, "vars.json");
const templatePath = resolve(cwd, "wrangler.template.jsonc");
const outPath = resolve(cwd, "wrangler.jsonc");

let vars = JSON.parse(readFileSync(varsPath, "utf8"));
const template = readFileSync(templatePath, "utf8");
const render = Handlebars.compile(template, {
  strict: true,
  noEscape: true,
});
writeFileSync(outPath, render(vars), "utf8");
console.log(`Wrote ${outPath}`);
