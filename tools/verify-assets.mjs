#!/usr/bin/env node
/**
 * Verifies that the aircraft assets in src/assets/models are loadable glTF.
 *
 * The copies committed to this repo were round-tripped through a text encoding: every byte
 * >= 0x80 became the UTF-8 replacement character (EF BF BD). The magic word survives, so the
 * file still *looks* like a .glb, but the chunk lengths and the binary buffer are destroyed
 * and GLTFLoader rejects it. This tool checks each asset and says so plainly.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../src/assets/models/", import.meta.url).pathname;
let bad = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith(".glb"))) {
  const b = readFileSync(join(dir, f));
  const magic = b.slice(0, 4).toString("latin1");
  const declared = b.length >= 12 ? b.readUInt32LE(8) : -1;
  const chunkLen = b.length >= 16 ? b.readUInt32LE(12) : -1;
  const chunkType = b.length >= 20 ? b.slice(16, 20).toString("latin1") : "";
  // the signature of the encoding damage
  const mangled = b.slice(0, 32).includes(Buffer.from([0xef, 0xbf, 0xbd]));
  const ok = magic === "glTF" && declared === b.length && chunkType === "JSON" && chunkLen + 20 <= b.length;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "BAD "} ${f.padEnd(14)} ${String(b.length).padStart(8)} B  magic=${JSON.stringify(magic)} declaredLength=${declared} chunk0=${JSON.stringify(chunkType)}/${chunkLen}${mangled ? "  [contains EF BF BD replacement bytes]" : ""}`,
  );
}
console.log(bad ? `\n${bad} model file(s) cannot be parsed by GLTFLoader.` : "\nAll model files parse.");
process.exit(bad ? 1 : 0);
