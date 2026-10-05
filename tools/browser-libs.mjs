// Builds tiny stub shared-objects that satisfy the Chromium binary's NSS/NSPR imports.
//
// The sandbox cannot reach the Playwright CDN or the Debian mirror, but the npm registry
// works, so Chromium comes from @sparticuz/chromium. That build links libnss3/libnspr4/
// libnssutil3, which are not installed here. We never do TLS (the harness only talks to
// http://127.0.0.1), so exporting the undefined symbols as no-ops is enough to launch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, ".chromium-libs");

const sh = (cmd, args, env) => execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });

/** @returns {{libPath: string|null, stubbed: string[]}} */
export function ensureBrowserLibs(exePath) {
  const missing = () => {
    try {
      const out = sh("ldd", ["-r", exePath], {});
      return [...out.matchAll(/undefined symbol: ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    } catch {
      return [];
    }
  };

  let syms = [...new Set(missing())].sort();
  if (syms.length === 0) return { libPath: null, stubbed: [] };

  mkdirSync(libDir, { recursive: true });
  const stamp = join(libDir, "symbols.txt");
  const prev = existsSync(stamp) ? readFileSync(stamp, "utf8").split("\n") : [];
  const so = join(libDir, "libnss3.so");
  if (existsSync(so) && prev.join("\n") === syms.join("\n")) {
    return { libPath: libDir, stubbed: syms };
  }

  // `nm -D` tells us which versioned symbol node each import wants (NSS_3.2, PR_4.0, ...).
  let versions = {};
  try {
    const out = sh("nm", ["-D", "--undefined-only", exePath], {});
    for (const line of out.split("\n")) {
      const m = line.match(/\sU\s+([A-Za-z0-9_]+)@+([A-Za-z0-9_.]+)\s*$/);
      if (m) versions[m[1]] = m[2];
    }
  } catch {
    /* versions are optional; BASE works too */
  }

  const groups = new Map();
  for (const name of syms) {
    const ver = versions[name] || "BASE";
    if (!groups.has(ver)) groups.set(ver, []);
    groups.get(ver).push(name);
  }

  let c = "", map = "";
  for (const [ver, names] of [...groups.entries()].sort()) {
    for (const n of names) {
      c += `long __stub_${n}(void){return 0;}\n__asm__(".symver __stub_${n},${n}@@${ver}");\n`;
    }
    map += `${ver} {\n  global:\n${names.map((n) => `    ${n};`).join("\n")}\n};\n`;
  }
  writeFileSync(join(libDir, "stubs.c"), c);
  writeFileSync(join(libDir, "stubs.map"), map);
  writeFileSync(stamp, syms.join("\n"));

  sh("gcc", ["-shared", "-fPIC", "-O0", "-o", so, join(libDir, "stubs.c"), `-Wl,--version-script=${join(libDir, "stubs.map")}`, "-Wl,-soname,libnss3.so"]);
  for (const n of ["libnspr4.so", "libnssutil3.so"]) {
    writeFileSync(join(libDir, n), readFileSync(so));
  }
  return { libPath: libDir, stubbed: syms };
}
