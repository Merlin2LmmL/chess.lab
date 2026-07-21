import { loadEnginePackage, UciClient } from "@chess-lab/chsengine-core";
import { buildAlgoEntryJs, DEFAULT_EVALUATE_SOURCE } from "./algobuilder.js";
import { buildNnEntryJs, ONNX_RUNTIME_CDN_NOTE } from "./nnbuilder.js";
import { buildLocateFileModuleWrapper } from "./converter.js";
import { buildManifest, buildZip, downloadBlob, sanitizeFilename, fetchStaticAsset } from "./packager.js";

const els = {
  tabBtns: [...document.querySelectorAll(".tab-btn")],
  tabPanes: {
    algo: document.getElementById("tab-algo"),
    nn: document.getElementById("tab-nn"),
    convert: document.getElementById("tab-convert"),
  },
  subtabBtns: [...document.querySelectorAll(".subtab-btn")],
  subtabPanes: {
    hash: document.getElementById("subtab-hash"),
    locate: document.getElementById("subtab-locate"),
    jsuci: document.getElementById("subtab-jsuci"),
  },

  algoDepth: document.getElementById("algo-depth"),
  algoMovetime: document.getElementById("algo-movetime"),
  algoDepthFacts: document.getElementById("algo-depth-facts"),
  algoEvaluate: document.getElementById("algo-evaluate"),

  nnContractHint: document.getElementById("nn-contract-hint"),
  nnModelFile: document.getElementById("nn-model-file"),
  nnDepth: document.getElementById("nn-depth"),

  hashJsFile: document.getElementById("hash-js-file"),
  hashWasmFile: document.getElementById("hash-wasm-file"),
  locateJsFile: document.getElementById("locate-js-file"),
  locateWasmFile: document.getElementById("locate-wasm-file"),
  locateFactory: document.getElementById("locate-factory"),
  jsuciJsFile: document.getElementById("jsuci-js-file"),

  metaName: document.getElementById("meta-name"),
  metaVersion: document.getElementById("meta-version"),
  metaAuthor: document.getElementById("meta-author"),
  metaLicense: document.getElementById("meta-license"),
  metaDescription: document.getElementById("meta-description"),

  btnBuildTest: document.getElementById("btn-build-test"),
  btnBuildDownload: document.getElementById("btn-build-download"),
  buildStatus: document.getElementById("build-status"),

  testEngineId: document.getElementById("test-engine-id"),
  consoleLog: document.getElementById("console-log"),
  consoleInput: document.getElementById("console-input"),
  btnQuickUci: document.getElementById("btn-quick-uci"),
  btnQuickIsready: document.getElementById("btn-quick-isready"),
  btnQuickStartpos: document.getElementById("btn-quick-startpos"),
  btnQuickGo: document.getElementById("btn-quick-go"),
  btnQuickStop: document.getElementById("btn-quick-stop"),
};

els.algoEvaluate.value = DEFAULT_EVALUATE_SOURCE;
els.nnContractHint.textContent = ONNX_RUNTIME_CDN_NOTE;

let activeTab = "algo";
let activeSubtab = "hash";
const bundledChessLibPath = `${import.meta.env.BASE_URL}vendor/chess.iife.js`;

els.tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    els.tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(els.tabPanes).forEach(([key, pane]) => pane.classList.toggle("active", key === activeTab));
  });
});

els.subtabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeSubtab = btn.dataset.subtab;
    els.subtabBtns.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(els.subtabPanes).forEach(([key, pane]) => pane.classList.toggle("active", key === activeSubtab));
  });
});

// ---------- algo depth/movetime fact panel ----------
//
// Replaces vague "fast / slow" labels with computed numbers. Depth is a
// ceiling on iterative deepening, not a fixed target -- the real throttle
// is the movetime budget, so we show both together and explain how they
// interact instead of implying depth alone determines speed.

const AVG_BRANCHING_FACTOR = 33; // typical legal moves/position across a game
const ASSUMED_NODES_PER_SEC_LOW = 50000; // conservative Worker + chess.js throughput
const ASSUMED_NODES_PER_SEC_HIGH = 300000; // optimistic, quiet position, well-pruned

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function updateAlgoDepthFacts() {
  const depth = clampInt(els.algoDepth.value, 1, 10, 4);
  const movetime = clampInt(els.algoMovetime.value, 50, 15000, 4000);

  const worstCaseNodes = Math.pow(AVG_BRANCHING_FACTOR, depth);
  const bestCaseNodes = Math.pow(Math.sqrt(AVG_BRANCHING_FACTOR), depth);

  const estSecondsLow = worstCaseNodes / ASSUMED_NODES_PER_SEC_HIGH;
  const estSecondsHigh = worstCaseNodes / ASSUMED_NODES_PER_SEC_LOW;
  const likelyTimeboxed = estSecondsLow * 1000 > movetime;

  els.algoDepthFacts.innerHTML = `
    <strong>What this actually means:</strong><br/>
    Depth ${depth} is a <em>ceiling</em, not a target: iterative deepening searches
    1, 2, 3... up to ${depth}, and stops early -- returning the last fully-completed
    depth's move -- if the ${movetime}ms budget runs out first.<br/>
    Node count at depth ${depth}, assuming ~${AVG_BRANCHING_FACTOR} legal moves/position:
    <ul>
      <li>Best case (strong alpha-beta pruning): ~${bestCaseNodes.toLocaleString(undefined, { maximumFractionDigits: 0 })} nodes</li>
      <li>Worst case (wide-open/tactical, little pruning): ~${worstCaseNodes.toLocaleString()} nodes</li>
    </ul>
    At an assumed ${ASSUMED_NODES_PER_SEC_LOW.toLocaleString()}-${ASSUMED_NODES_PER_SEC_HIGH.toLocaleString()} nodes/sec
    for this Worker + chess.js setup, reaching depth ${depth} in the worst case would take
    roughly ${estSecondsLow.toFixed(2)}s-${estSecondsHigh.toFixed(2)}s.
    ${likelyTimeboxed
      ? `<strong>With a ${movetime}ms budget, complex positions will likely be cut off before finishing depth ${depth}</strong> -- the engine will fall back to whatever depth it did complete.`
      : `With a ${movetime}ms budget, depth ${depth} should usually complete even in complex positions.`}
  `;
}

els.algoDepth.addEventListener("input", updateAlgoDepthFacts);
els.algoMovetime.addEventListener("input", updateAlgoDepthFacts);
updateAlgoDepthFacts();

function metaFields() {
  return {
    name: els.metaName.value.trim() || "My Engine",
    version: els.metaVersion.value.trim() || "1.0.0",
    author: els.metaAuthor.value.trim(),
    license: els.metaLicense.value.trim(),
    description: els.metaDescription.value.trim(),
  };
}

async function readFile(inputEl) {
  const file = inputEl.files[0];
  if (!file) return null;
  return { name: file.name, buffer: await file.arrayBuffer() };
}

/**
 * Assembles {manifest, files} for whichever tab/subtab is currently active.
 * Throws a plain Error with a user-facing message if required inputs are missing.
 */
async function buildCurrentPackage() {
  const meta = metaFields();

  if (activeTab === "algo") {
    const depth = clampInt(els.algoDepth.value, 1, 10, 4);
    const movetime = clampInt(els.algoMovetime.value, 50, 15000, 4000);
    const evaluateSource = els.algoEvaluate.value.trim();
    if (!evaluateSource.includes("function evaluate")) {
      throw new Error('your code must define a function named "evaluate", e.g. function evaluate(chess) { ... }');
    }
    const entry = buildAlgoEntryJs({
      name: meta.name,
      author: meta.author,
      evaluateSource,
      defaultDepth: depth,
      defaultMovetime: movetime,
    });
    const chesslib = await fetchStaticAsset(bundledChessLibPath);
    const manifest = buildManifest({
      ...meta,
      kind: "js-algo",
      entry: "entry.js",
      wasmStrategy: "locateFile-module",
      assets: ["chesslib.js"],
    });
    return {
      manifest,
      files: [
        { name: "entry.js", content: entry },
        { name: "chesslib.js", content: chesslib },
      ],
    };
  }

  if (activeTab === "nn") {
    const model = await readFile(els.nnModelFile);
    if (!model) throw new Error("choose an .onnx model file first");
    const depth = parseInt(els.nnDepth.value, 10);
    const entry = buildNnEntryJs({ name: meta.name, author: meta.author, defaultDepth: depth });
    const chesslib = await fetchStaticAsset(bundledChessLibPath);
    const manifest = buildManifest({
      ...meta,
      kind: "nn-onnx",
      entry: "entry.js",
      wasmStrategy: "locateFile-module",
      assets: ["chesslib.js", "model.onnx"],
    });
    return {
      manifest,
      files: [
        { name: "entry.js", content: entry },
        { name: "chesslib.js", content: chesslib },
        { name: "model.onnx", content: model.buffer },
      ],
    };
  }

  // activeTab === "convert"
  if (activeSubtab === "hash") {
    const js = await readFile(els.hashJsFile);
    const wasm = await readFile(els.hashWasmFile);
    if (!js || !wasm) throw new Error("choose both the vendor .js and .wasm files");
    const manifest = buildManifest({
      ...meta,
      kind: "wasm-uci",
      entry: js.name,
      wasmStrategy: "hash-fragment",
      wasmAsset: wasm.name,
      assets: [],
    });
    return {
      manifest,
      files: [
        { name: js.name, content: js.buffer },
        { name: wasm.name, content: wasm.buffer },
      ],
    };
  }

  if (activeSubtab === "locate") {
    const glue = await readFile(els.locateJsFile);
    const wasm = await readFile(els.locateWasmFile);
    const factoryName = els.locateFactory.value.trim();
    if (!glue || !wasm) throw new Error("choose both the Emscripten glue .js and .wasm files");
    if (!factoryName) throw new Error("enter the factory function name (e.g. Stockfish)");
    const entry = buildLocateFileModuleWrapper({ glueFilename: glue.name, factoryName });
    const manifest = buildManifest({
      ...meta,
      kind: "wasm-uci",
      entry: "entry.js",
      wasmStrategy: "locateFile-module",
      assets: [glue.name, wasm.name],
    });
    return {
      manifest,
      files: [
        { name: "entry.js", content: entry },
        { name: glue.name, content: glue.buffer },
        { name: wasm.name, content: wasm.buffer },
      ],
    };
  }

  // activeSubtab === "jsuci"
  const engineFile = await readFile(els.jsuciJsFile);
  if (!engineFile) throw new Error("choose your engine's .js file");
  const manifest = buildManifest({
    ...meta,
    kind: "js-uci",
    entry: engineFile.name,
    wasmStrategy: "none",
    assets: [],
  });
  return { manifest, files: [{ name: engineFile.name, content: engineFile.buffer }] };
}

// ---------- test console ----------

let testSession = null;

function consoleLog(line) {
  els.consoleLog.textContent += line + "\n";
  els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
}

function disposeTestSession() {
  if (!testSession) return;
  try {
    testSession.uci.quit();
  } catch {
    /* ignore */
  }
  testSession.loaded.dispose();
  testSession = null;
}

async function loadIntoTester(blob) {
  disposeTestSession();
  els.consoleLog.textContent = "";
  els.testEngineId.textContent = "Loading package into a Worker...";
  const loaded = await loadEnginePackage(blob);
  const uci = new UciClient(loaded.worker);
  uci.onLine((line) => consoleLog("< " + line));
  loaded.worker.onerror = (ev) => consoleLog("! worker error: " + ev.message);
  testSession = { loaded, uci };

  els.testEngineId.textContent = `${loaded.manifest.name} (${loaded.manifest.kind}) -- handshaking...`;
  consoleLog("> uci");
  await uci.uci();
  consoleLog("> isready");
  await uci.isReady();
  els.testEngineId.textContent = `${loaded.manifest.name} v${loaded.manifest.version} (${loaded.manifest.kind}) -- ready`;
}

function sendToTester(cmd) {
  if (!testSession) {
    consoleLog("! build & load a package into the tester first");
    return;
  }
  consoleLog("> " + cmd);
  testSession.uci.send(cmd);
}

els.btnQuickUci.addEventListener("click", () => sendToTester("uci"));
els.btnQuickIsready.addEventListener("click", () => sendToTester("isready"));
els.btnQuickStartpos.addEventListener("click", () => sendToTester("position startpos"));
els.btnQuickGo.addEventListener("click", () => sendToTester("go movetime 1000"));
els.btnQuickStop.addEventListener("click", () => sendToTester("stop"));
els.consoleInput.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  const cmd = els.consoleInput.value.trim();
  if (!cmd) return;
  sendToTester(cmd);
  els.consoleInput.value = "";
});

// ---------- build actions ----------

els.btnBuildTest.addEventListener("click", async () => {
  els.buildStatus.textContent = "Building...";
  try {
    const { manifest, files } = await buildCurrentPackage();
    const blob = await buildZip(manifest, files);
    await loadIntoTester(blob);
    els.buildStatus.textContent = "Built and loaded into the tester below.";
  } catch (err) {
    els.buildStatus.textContent = "Error: " + err.message;
  }
});

els.btnBuildDownload.addEventListener("click", async () => {
  els.buildStatus.textContent = "Building...";
  try {
    const { manifest, files } = await buildCurrentPackage();
    const blob = await buildZip(manifest, files);
    downloadBlob(blob, `${sanitizeFilename(manifest.name)}.chsengine.zip`);
    els.buildStatus.textContent = `Downloaded ${sanitizeFilename(manifest.name)}.chsengine.zip`;
  } catch (err) {
    els.buildStatus.textContent = "Error: " + err.message;
  }
});
