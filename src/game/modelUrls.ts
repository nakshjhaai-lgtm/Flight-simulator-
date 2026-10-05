/**
 * Aircraft model URLs.
 *
 * The .glb files committed under src/assets/models are byte-corrupt (every byte >= 0x80 was
 * replaced by the UTF-8 replacement character — see tools/verify-assets.mjs), so bundling them
 * only shipped ~11 MB of unparseable base64 inside the single-file build. They are therefore
 * not imported here; the engine flies the procedural airframes instead.
 *
 * To restore real models later: re-add the `?url` imports, put them back in MODEL_URLS, and the
 * loader in engine.ts will prefer them over the procedural stand-ins automatically.
 */
export const MODEL_URLS: Record<string, string | undefined> = {
  pa28: undefined,
  ask21: undefined,
  atr42: undefined,
  citation: undefined,
  a320: undefined,
  beluga: undefined,
};
