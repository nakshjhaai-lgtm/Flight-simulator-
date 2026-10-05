// Shared browser bootstrap for the headless verification tools.
import { chromium } from "playwright";
import sparticuz from "@sparticuz/chromium";
import { ensureBrowserLibs } from "./browser-libs.mjs";

export const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu-sandbox",
  "--disable-dev-shm-usage",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-background-timer-throttling",
];

export async function launch() {
  const executablePath = await sparticuz.executablePath();
  const { libPath, stubbed } = ensureBrowserLibs(executablePath);
  const env = { ...process.env };
  if (libPath) env.LD_LIBRARY_PATH = libPath + (env.LD_LIBRARY_PATH ? ":" + env.LD_LIBRARY_PATH : "");
  const browser = await chromium.launch({ executablePath, args: BROWSER_ARGS, env });
  browser.__stubbed = stubbed;
  return browser;
}

/** Does this browser give us a working WebGL2 context? */
export async function probeWebGL(browser) {
  const page = await browser.newPage();
  await page.setContent("<canvas id=c width=64 height=64></canvas>");
  const info = await page.evaluate(() => {
    const c = document.getElementById("c");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { ok: false };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      ok: true,
      version: gl.getParameter(gl.VERSION),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  await page.close();
  return info;
}
