import JSZip from "jszip";

export function buildManifest(fields) {
  return {
    format: "chsengine",
    formatVersion: 1,
    name: fields.name,
    version: fields.version || "1.0.0",
    author: fields.author || "",
    description: fields.description || "",
    license: fields.license || "",
    kind: fields.kind,
    entry: fields.entry,
    wasmStrategy: fields.wasmStrategy || "none",
    wasmAsset: fields.wasmAsset || null,
    assets: fields.assets || [],
  };
}

export async function buildZip(manifest, files) {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  for (const f of files) zip.file(f.name, f.content);
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function sanitizeFilename(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "engine"
  );
}

export async function fetchStaticAsset(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`could not load bundled asset "${path}" (${res.status})`);
  return res.arrayBuffer();
}
