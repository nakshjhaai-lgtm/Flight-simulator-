import { launch, probeWebGL } from "./_browser.mjs";
const b = await launch();
console.log("WEBGL:", JSON.stringify(await probeWebGL(b)));
await b.close();
