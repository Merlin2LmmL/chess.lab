import JSZip from "jszip";
import { validateManifest, ManifestError } from "./manifest.js";

const MIME_BY_EXT = {
  js: "text/javascript",
  wasm: "application/wasm",
  json: "application/json",
  onnx: "application/octet-stream",
  data: "application/octet-stream",
  bin: "application/octet-stream",
};

function mimeFor(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

/**
 * Read and validate just the manifest from a package, without booting a Worker.
 * Useful for library listings / previews.
 * @param {File|Blob} file
 */
export async function readManifest(file) {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw new ManifestError('no "manifest.json" found at the root of the zip');
  }
  let parsed;
  try {
    parsed = JSON.parse(await manifestEntry.async("string"));
  } catch (e) {
    throw new ManifestError(`manifest.json is not valid JSON (${e.message})`);
  }
  return validateManifest(parsed, names);
}

/**
 * @typedef {Object} LoadedEngine
 * @property {import("./manifest.js").ChsEngineManifest} manifest
 * @property {Worker} worker
 * @property {Map<string,string>} fileUrls - filename -> object URL, for every file in the zip
 * @property {() => void} dispose - terminates the worker and revokes all object URLs
 */

/**
 * Unzip a chsengine package and boot its Worker per the v1 runtime contract.
 * @param {File|Blob} file
 * @returns {Promise<LoadedEngine>}
 */
export async function loadEnginePackage(file) {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const manifest = await readManifest(file);

  /** @type {Map<string,string>} */
  const fileUrls = new Map();
  for (const name of names) {
    const buf = await zip.files[name].async("arraybuffer");
    const blob = new Blob([buf], { type: mimeFor(name) });
    fileUrls.set(name, URL.createObjectURL(blob));
  }

  const entryUrl = fileUrls.get(manifest.entry);
  if (!entryUrl) {
    // validateManifest already checked this against the zip listing, but the
    // fetch loop above is the actual source of truth, so re-check defensively.
    throw new ManifestError(`entry file "${manifest.entry}" could not be read from the zip`);
  }

  let workerUrl = entryUrl;
  if (manifest.wasmStrategy === "hash-fragment") {
    const assetUrl = fileUrls.get(manifest.wasmAsset);
    if (!assetUrl) throw new ManifestError(`wasmAsset "${manifest.wasmAsset}" could not be read from the zip`);
    workerUrl = `${entryUrl}#${assetUrl}`;
  } else if (manifest.wasmStrategy === "locateFile-module") {
    /** @type {Record<string,string>} */
    const assetMap = {};
    for (const a of manifest.assets) {
      const u = fileUrls.get(a);
      if (!u) throw new ManifestError(`asset "${a}" could not be read from the zip`);
      assetMap[a] = u;
    }
    workerUrl = `${entryUrl}#${encodeURIComponent(JSON.stringify(assetMap))}`;
  }

  const worker = new Worker(workerUrl, { name: manifest.name });

  const dispose = () => {
    try {
      worker.terminate();
    } catch {
      /* already dead */
    }
    for (const url of fileUrls.values()) URL.revokeObjectURL(url);
  };

  return { manifest, worker, fileUrls, dispose };
}

export { ManifestError } from "./manifest.js";
