// manifest.json validation for the chsengine v1 format.
// Kept deliberately strict: a bad manifest should fail at import time with a
// specific error, not three layers deep inside a Worker that never responds.

export const ENGINE_KINDS = ["wasm-uci", "js-uci", "js-algo", "nn-onnx"];
export const WASM_STRATEGIES = ["none", "hash-fragment", "locateFile-module"];

/**
 * @typedef {Object} ChsEngineManifest
 * @property {"chsengine"} format
 * @property {number} formatVersion
 * @property {string} name
 * @property {string} version
 * @property {string} [author]
 * @property {string} [description]
 * @property {string} [license]
 * @property {"wasm-uci"|"js-uci"|"js-algo"|"nn-onnx"} kind
 * @property {string} entry
 * @property {"none"|"hash-fragment"|"locateFile-module"} wasmStrategy
 * @property {string|null} wasmAsset
 * @property {string[]} assets
 */

class ManifestError extends Error {
  constructor(message) {
    super(`Invalid manifest.json: ${message}`);
    this.name = "ManifestError";
  }
}

/**
 * Validate a parsed manifest object against the chsengine v1 spec.
 * Throws ManifestError with a specific message on the first problem found.
 * @param {any} m
 * @param {string[]} filesInZip - basenames present in the archive, for cross-checking entry/assets
 * @returns {ChsEngineManifest}
 */
export function validateManifest(m, filesInZip) {
  if (typeof m !== "object" || m === null) {
    throw new ManifestError("root value must be a JSON object");
  }
  if (m.format !== "chsengine") {
    throw new ManifestError(`"format" must be "chsengine", got ${JSON.stringify(m.format)}`);
  }
  if (m.formatVersion !== 1) {
    throw new ManifestError(`"formatVersion" must be 1, got ${JSON.stringify(m.formatVersion)} (this tool only understands v1)`);
  }
  for (const field of ["name", "version"]) {
    if (typeof m[field] !== "string" || m[field].trim() === "") {
      throw new ManifestError(`"${field}" must be a non-empty string`);
    }
  }
  if (!ENGINE_KINDS.includes(m.kind)) {
    throw new ManifestError(`"kind" must be one of ${ENGINE_KINDS.join(", ")}, got ${JSON.stringify(m.kind)}`);
  }
  if (typeof m.entry !== "string" || m.entry.trim() === "") {
    throw new ManifestError(`"entry" must be a non-empty filename`);
  }
  if (filesInZip && !filesInZip.includes(m.entry)) {
    throw new ManifestError(`"entry" points to "${m.entry}", which is not in the zip`);
  }
  const wasmStrategy = m.wasmStrategy ?? "none";
  if (!WASM_STRATEGIES.includes(wasmStrategy)) {
    throw new ManifestError(`"wasmStrategy" must be one of ${WASM_STRATEGIES.join(", ")}, got ${JSON.stringify(wasmStrategy)}`);
  }
  if (wasmStrategy === "hash-fragment") {
    if (typeof m.wasmAsset !== "string" || m.wasmAsset.trim() === "") {
      throw new ManifestError(`wasmStrategy "hash-fragment" requires a "wasmAsset" filename`);
    }
    if (filesInZip && !filesInZip.includes(m.wasmAsset)) {
      throw new ManifestError(`"wasmAsset" points to "${m.wasmAsset}", which is not in the zip`);
    }
  }
  const assets = Array.isArray(m.assets) ? m.assets : [];
  if (filesInZip) {
    for (const a of assets) {
      if (!filesInZip.includes(a)) {
        throw new ManifestError(`"assets" lists "${a}", which is not in the zip`);
      }
    }
  }
  if (wasmStrategy === "locateFile-module" && assets.length === 0) {
    throw new ManifestError(`wasmStrategy "locateFile-module" requires at least one entry in "assets"`);
  }

  return {
    format: "chsengine",
    formatVersion: 1,
    name: m.name,
    version: m.version,
    author: typeof m.author === "string" ? m.author : "",
    description: typeof m.description === "string" ? m.description : "",
    license: typeof m.license === "string" ? m.license : "",
    kind: m.kind,
    entry: m.entry,
    wasmStrategy,
    wasmAsset: wasmStrategy === "hash-fragment" ? m.wasmAsset : null,
    assets,
  };
}

export { ManifestError };
