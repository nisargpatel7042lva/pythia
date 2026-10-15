// Copies the eERC circuit artifacts from packages/eerc-core into frontend/public/circuits so the
// browser can fetch them. The copy is gitignored; eerc-core stays the single source of truth.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../packages/eerc-core/circuits");
const dest = path.resolve(here, "../public/circuits");
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`circuits copied: ${path.relative(process.cwd(), dest)}`);
