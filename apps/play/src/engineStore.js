import { get, set, del, createStore } from "idb-keyval";
import { readManifest } from "@chess-lab/chsengine-core";

const store = createStore("chsengine-play", "library");
const INDEX_KEY = "__index__";

async function readIndex() {
  return (await get(INDEX_KEY, store)) || [];
}

async function writeIndex(ids) {
  await set(INDEX_KEY, ids, store);
}

/** @returns {Promise<Array<{id:string, manifest: any, addedAt: number}>>} */
export async function listEngines() {
  const ids = await readIndex();
  const records = [];
  for (const id of ids) {
    const record = await get(`meta:${id}`, store);
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Validate + persist an uploaded .chsengine.zip.
 * @param {File} file
 */
export async function addEngine(file) {
  const manifest = await readManifest(file); // throws on invalid packages
  const id = crypto.randomUUID();
  const record = { id, manifest, addedAt: Date.now(), sourceName: file.name };
  await set(`meta:${id}`, record, store);
  await set(`blob:${id}`, file, store);
  const ids = await readIndex();
  ids.push(id);
  await writeIndex(ids);
  return record;
}

/** @returns {Promise<Blob|undefined>} */
export async function getEngineBlob(id) {
  return get(`blob:${id}`, store);
}

export async function removeEngine(id) {
  await del(`meta:${id}`, store);
  await del(`blob:${id}`, store);
  const ids = await readIndex();
  await writeIndex(ids.filter((x) => x !== id));
}
