import { Chess } from "chess.js";
import { loadEnginePackage } from "@chess-lab/chsengine-core";
import { UciClient } from "@chess-lab/chsengine-core";
import { ChessBoardUI } from "./board.js";
import { listEngines, addEngine, getEngineBlob, removeEngine } from "./engineStore.js";

const THINK_TIME_MS = 1200; // fixed engine move time; simple and predictable for a local test rig

const els = {
  importInput: document.getElementById("import-input"),
  engineList: document.getElementById("engine-list"),
  seatWhiteValue: document.getElementById("seat-white-value"),
  seatBlackValue: document.getElementById("seat-black-value"),
  boardHost: document.getElementById("board-host"),
  btnNewGame: document.getElementById("btn-new-game"),
  btnFlip: document.getElementById("btn-flip"),
  btnSwapSides: document.getElementById("btn-swap-sides"),
  statusText: document.getElementById("status-text"),
  evalBarFill: document.getElementById("eval-bar-fill"),
  evalBarLabel: document.getElementById("eval-bar-label"),
  analysisEngineSelect: document.getElementById("analysis-engine-select"),
  btnAnalyzeToggle: document.getElementById("btn-analyze-toggle"),
  arDepth: document.getElementById("ar-depth"),
  arScore: document.getElementById("ar-score"),
  arNodes: document.getElementById("ar-nodes"),
  arNps: document.getElementById("ar-nps"),
  candidateList: document.getElementById("candidate-list"),
  pvLine: document.getElementById("pv-line"),
  engineLog: document.getElementById("engine-log"),
  moveList: document.getElementById("move-list"),
  btnNavStart: document.getElementById("btn-nav-start"),
  btnNavBack: document.getElementById("btn-nav-back"),
  btnNavForward: document.getElementById("btn-nav-forward"),
  btnNavEnd: document.getElementById("btn-nav-end"),
  btnExportPgn: document.getElementById("btn-export-pgn"),
};

/** @type {{records: Array<any>}} */
const library = { records: [] };

/** seats.w / seats.b hold either null (human) or an engine record id */
const seats = { w: null, b: null };

/** live Worker/UCI sessions, keyed by a role: "seat:w", "seat:b", "analysis" */
const sessions = new Map();

const game = new Chess();
let moveInFlight = false; // guards against overlapping engine goes / double clicks
let analysisActive = false;

// Ply index (0 = start position, N = position after N half-moves) currently
// shown on the board. Equal to totalPly() whenever we're looking at the
// live/current position; smaller while browsing move history.
let viewIndex = 0;

const board = new ChessBoardUI(els.boardHost, {
  getChess: () => getDisplayChess(),
  canMove: () => !moveInFlight && isHumanTurn() && viewIndex >= totalPly(),
  onUserMove: onUserMove,
});

function isHumanTurn() {
  return seats[game.turn()] === null;
}

function log(line) {
  els.engineLog.textContent += line + "\n";
  els.engineLog.scrollTop = els.engineLog.scrollHeight;
}

// ---------- move navigation ----------

function totalPly() {
  return game.history().length;
}

/**
 * Returns the Chess instance the board should render. When browsing history
 * (viewIndex < totalPly()) this is a disposable scratch instance replayed
 * from the start; it is never mutated by the board (canMove() is false
 * whenever we're not at the live position, so board.js never calls .move()
 * on it).
 */
function getDisplayChess() {
  if (viewIndex >= totalPly()) return game;
  const scratch = new Chess();
  const verbose = game.history({ verbose: true });
  for (let i = 0; i < viewIndex; i++) {
    const m = verbose[i];
    scratch.move({ from: m.from, to: m.to, promotion: m.promotion });
  }
  return scratch;
}

function goToPly(ply) {
  const clamped = Math.max(0, Math.min(totalPly(), ply));
  if (clamped === viewIndex) return;
  viewIndex = clamped;
  syncBoardToViewIndex();
}

function goToStart() {
  goToPly(0);
}

function goBack() {
  goToPly(viewIndex - 1);
}

function goForward() {
  goToPly(viewIndex + 1);
}

function goToEnd() {
  goToPly(totalPly());
}

function syncBoardToViewIndex() {
  board.clearSelection();

  const verbose = game.history({ verbose: true });
  if (viewIndex > 0) {
    const m = verbose[viewIndex - 1];
    board.setLastMove(m.from, m.to);
  } else {
    board.setLastMove(null, null);
  }

  const atLive = viewIndex >= totalPly();
  if (atLive) {
    // Restore the live analysis heatmap, if any, now that we're back.
    if (analysisActive && multipvInfos.size > 0) renderAnalysis();
  } else {
    board.setHeatmap(new Map());
  }

  board.render();
  renderMoveList();

  if (atLive) {
    els.statusText.textContent = game.game_over() ? gameOverText() : `${game.turn() === "w" ? "White" : "Black"} to move.`;
  } else {
    els.statusText.textContent = `Viewing move ${viewIndex} of ${totalPly()}.`;
  }
}

function renderMoveList() {
  const verbose = game.history({ verbose: true });
  els.moveList.innerHTML = "";

  if (verbose.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "No moves yet.";
    els.moveList.appendChild(p);
  } else {
    for (let i = 0; i < verbose.length; i += 2) {
      const moveNumber = i / 2 + 1;
      const row = document.createElement("div");
      row.className = "move-row";

      const num = document.createElement("span");
      num.className = "move-number";
      num.textContent = `${moveNumber}.`;
      row.appendChild(num);

      row.appendChild(makeMoveSpan(verbose[i].san, i + 1));

      if (verbose[i + 1]) {
        row.appendChild(makeMoveSpan(verbose[i + 1].san, i + 2));
      }

      els.moveList.appendChild(row);
    }
  }

  const activeEl = els.moveList.querySelector(".move-san.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  else els.moveList.scrollTop = 0;

  updateNavButtonsState();
}

function makeMoveSpan(san, ply) {
  const span = document.createElement("span");
  span.className = "move-san";
  span.textContent = san;
  span.dataset.ply = String(ply);
  if (ply === viewIndex) span.classList.add("active");
  span.addEventListener("click", () => goToPly(ply));
  return span;
}

function updateNavButtonsState() {
  const atStart = viewIndex === 0;
  const atEnd = viewIndex >= totalPly();
  els.btnNavStart.disabled = atStart;
  els.btnNavBack.disabled = atStart;
  els.btnNavForward.disabled = atEnd;
  els.btnNavEnd.disabled = atEnd;
  els.btnExportPgn.disabled = totalPly() === 0;
}

function exportPgn() {
  if (totalPly() === 0) return;

  const whiteLabel = seats.w ? engineDisplayName(library.records.find((r) => r.id === seats.w)) : "Human";
  const blackLabel = seats.b ? engineDisplayName(library.records.find((r) => r.id === seats.b)) : "Human";
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");

  game.header("Event", "chsengine game", "Date", today, "White", whiteLabel || "Human", "Black", blackLabel || "Human", "Result", pgnResult());

  const pgn = game.pgn();
  const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `chsengine-game-${stamp}.pgn`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pgnResult() {
  if (!game.game_over()) return "*";
  if (game.in_checkmate()) return game.turn() === "w" ? "0-1" : "1-0";
  if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition() || game.insufficient_material()) return "1/2-1/2";
  return "*";
}

// ---------- engine sessions ----------

async function createSession(engineId, role) {
  const existing = sessions.get(role);
  if (existing) {
    existing.uci.quit();
    existing.loaded.dispose();
    sessions.delete(role);
  }
  const blob = await getEngineBlob(engineId);
  if (!blob) throw new Error("engine package missing from storage");
  const loaded = await loadEnginePackage(blob);
  const uci = new UciClient(loaded.worker);
  uci.onLine((line) => log(`[${role}] ${line}`));
  loaded.worker.onerror = (ev) => log(`[${role}] worker error: ${ev.message}`);
  await uci.uci();
  await uci.isReady();
  uci.newGame();
  const session = { engineId, loaded, uci, manifest: loaded.manifest };
  sessions.set(role, session);
  return session;
}

function disposeSession(role) {
  const s = sessions.get(role);
  if (!s) return;
  try {
    s.uci.quit();
  } catch {
    /* ignore */
  }
  s.loaded.dispose();
  sessions.delete(role);
}

function historyUci() {
  return game.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
}

// ---------- game flow ----------

async function maybeTriggerEngineMove() {
  if (game.game_over()) {
    els.statusText.textContent = gameOverText();
    return;
  }
  const turn = game.turn();
  const engineId = seats[turn];
  if (!engineId) return; // human to move

  moveInFlight = true;
  els.statusText.textContent = `${turn === "w" ? "White" : "Black"} (engine) is thinking...`;
  try {
    const session = sessions.get(`seat:${turn}`);
    if (!session) throw new Error("engine session not ready");
    session.uci.setPosition({ moves: historyUci() });
    const result = await session.uci.go({ movetime: THINK_TIME_MS });
    if (!result.bestmove) {
      els.statusText.textContent = "Engine returned no move (bestmove none).";
      moveInFlight = false;
      return;
    }
    const from = result.bestmove.slice(0, 2);
    const to = result.bestmove.slice(2, 4);
    const promotion = result.bestmove.slice(4, 5) || undefined;
    const move = game.move({ from, to, promotion });
    if (!move) {
      els.statusText.textContent = `Engine proposed illegal move "${result.bestmove}" -- stopping.`;
      moveInFlight = false;
      return;
    }
    viewIndex = totalPly();
    board.setLastMove(move.from, move.to);
    board.render();
    renderMoveList();
  } catch (err) {
    els.statusText.textContent = `Engine error: ${err.message}`;
  } finally {
    moveInFlight = false;
  }
  if (game.game_over()) {
    els.statusText.textContent = gameOverText();
  } else {
    els.statusText.textContent = `${game.turn() === "w" ? "White" : "Black"} to move.`;
    restartAnalysisIfActive();
    maybeTriggerEngineMove();
  }
}

function gameOverText() {
  if (game.in_checkmate()) return `Checkmate. ${game.turn() === "w" ? "Black" : "White"} wins.`;
  if (game.in_stalemate()) return "Draw by stalemate.";
  if (game.in_threefold_repetition()) return "Draw by threefold repetition.";
  if (game.insufficient_material()) return "Draw by insufficient material.";
  if (game.in_draw()) return "Draw (50-move rule).";
  return "Game over.";
}

function onUserMove(_move) {
  viewIndex = totalPly();
  renderMoveList();

  if (game.game_over()) {
    els.statusText.textContent = gameOverText();
    return;
  }
  els.statusText.textContent = `${game.turn() === "w" ? "White" : "Black"} to move.`;
  restartAnalysisIfActive();
  maybeTriggerEngineMove();
}

async function newGame() {
  disposeSession("analysis");
  analysisActive = false;
  els.btnAnalyzeToggle.textContent = "Start analysis";
  els.btnAnalyzeToggle.classList.remove("active");
  clearAnalysisReadout();

  game.reset();
  viewIndex = 0;
  board.clearSelection();
  board.setLastMove(null, null);
  board.setHeatmap(new Map());
  board.render();
  renderMoveList();
  updateEvalBar(0, "cp");
  els.statusText.textContent = "White to move.";

  await refreshSeatSessions();
  maybeTriggerEngineMove();
}

async function refreshSeatSessions() {
  for (const color of ["w", "b"]) {
    const role = `seat:${color}`;
    const engineId = seats[color];
    if (!engineId) {
      disposeSession(role);
      continue;
    }
    const current = sessions.get(role);
    if (!current || current.engineId !== engineId) {
      els.statusText.textContent = `Loading ${color === "w" ? "White" : "Black"} engine...`;
      await createSession(engineId, role);
    }
  }
}

// ---------- analysis (kibitzer) ----------

function clearAnalysisReadout() {
  els.arDepth.textContent = "-";
  els.arScore.textContent = "-";
  els.arNodes.textContent = "-";
  els.arNps.textContent = "-";
  els.pvLine.textContent = "-";
  els.candidateList.innerHTML = "";
  board.setHeatmap(new Map());
}

async function startAnalysis() {
  const engineId = els.analysisEngineSelect.value;
  if (!engineId) return;
  els.btnAnalyzeToggle.disabled = true;
  els.statusText.textContent = "Loading analysis engine...";
  const session = await createSession(engineId, "analysis");
  session.uci.setOption("MultiPV", 3);
  analysisActive = true;
  els.btnAnalyzeToggle.disabled = false;
  els.btnAnalyzeToggle.textContent = "Stop analysis";
  els.btnAnalyzeToggle.classList.add("active");
  els.statusText.textContent = `${game.turn() === "w" ? "White" : "Black"} to move.`;
  clearAnalysisReadout();
  multipvInfos = new Map();
  runAnalysisSearch();
}

/** @type {Map<number, any>} latest info per multipv slot */
let multipvInfos = new Map();

let analysisRestartTimer = null;
let analysisSearchToken = 0;

function runAnalysisSearch() {
  const session = sessions.get("analysis");
  if (!session || !analysisActive) return;

  const token = ++analysisSearchToken;
  multipvInfos = new Map();
  session.uci.setPosition({ moves: historyUci() });

  session.uci
    .go({ infinite: true }, (info) => {
      // ignore stale callbacks from older searches
      if (token !== analysisSearchToken) return;
      if (info.score) multipvInfos.set(info.multipv || 1, info);
      renderAnalysis();
    })
    .catch(() => {});
}

function restartAnalysisIfActive() {
  const session = sessions.get("analysis");
  if (!analysisActive || !session) return;

  session.uci.stop();

  if (analysisRestartTimer) clearTimeout(analysisRestartTimer);
  analysisRestartTimer = setTimeout(() => {
    runAnalysisSearch();
  }, 120); // was 30; give engine time to settle
}

function stopAnalysis() {
  const session = sessions.get("analysis");
  if (session) session.uci.stop();
  disposeSession("analysis");
  analysisActive = false;
  els.btnAnalyzeToggle.textContent = "Start analysis";
  els.btnAnalyzeToggle.classList.remove("active");
  clearAnalysisReadout();
}

function scoreToCpWhitePerspective(score) {
  if (!score) return null;
  const magnitude = score.type === "mate" ? Math.sign(score.value) * (100000 - Math.abs(score.value)) : score.value;
  return game.turn() === "w" ? magnitude : -magnitude;
}

function formatScore(score) {
  if (!score) return "-";
  if (score.type === "mate") return `#${score.value}`;
  const pawns = (score.value / 100).toFixed(2);
  return score.value > 0 ? `+${pawns}` : pawns;
}

function updateEvalBar(cpWhitePerspective) {
  const clamped = Math.max(-1000, Math.min(1000, cpWhitePerspective));
  const pct = 50 + (clamped / 1000) * 50;
  els.evalBarFill.style.height = `${pct}%`;
  els.evalBarLabel.textContent = (cpWhitePerspective / 100).toFixed(1);
}

function renderAnalysis() {
  const sorted = [...multipvInfos.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return;
  const top = sorted[0][1];

  els.arDepth.textContent = String(top.depth ?? "-");
  els.arScore.textContent = formatScore(top.score);
  els.arNodes.textContent = top.nodes != null ? top.nodes.toLocaleString() : "-";
  els.arNps.textContent = top.nps != null ? top.nps.toLocaleString() : "-";
  els.pvLine.textContent = top.pv.length ? sanPvFromUci(top.pv) : "-";

  const cpWhite = scoreToCpWhitePerspective(top.score);
  if (cpWhite != null) updateEvalBar(cpWhite);

  els.candidateList.innerHTML = "";
  const heat = new Map();
  const maxAbs = Math.max(1, ...sorted.map(([, info]) => Math.abs(info.score ? info.score.value : 0)));
  sorted.forEach(([multipv, info]) => {
    const row = document.createElement("div");
    row.className = "candidate-row";
    const moveSpan = document.createElement("span");
    moveSpan.textContent = `${multipv}. ${info.pv[0] || "?"}`;
    const scoreSpan = document.createElement("span");
    scoreSpan.className = "cscore";
    scoreSpan.textContent = formatScore(info.score);
    row.append(moveSpan, scoreSpan);
    els.candidateList.appendChild(row);

    if (info.pv[0] && info.score) {
      const to = info.pv[0].slice(2, 4);
      const rank = multipv - 1;
      const intensity = Math.min(1, Math.abs(info.score.value) / maxAbs) * (1 - rank * 0.25);
      heat.set(to, { color: "var(--gold)", opacity: Math.max(0.12, intensity * 0.6) });
    }
  });
  board.setHeatmap(heat);
}

function sanPvFromUci(uciMoves) {
  // Replay on a scratch board just to render a readable SAN line; never mutates game state.
  const scratch = new Chess(game.fen());
  const sanParts = [];
  for (const u of uciMoves.slice(0, 8)) {
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promotion = u.slice(4, 5) || undefined;
    const move = scratch.move({ from, to, promotion });
    if (!move) break;
    sanParts.push(move.san);
  }
  return sanParts.join(" ");
}

// ---------- library UI ----------

function engineDisplayName(record) {
  if (!record) return "";
  return `${record.manifest.name} v${record.manifest.version}`;
}

function renderLibrary() {
  els.engineList.innerHTML = "";
  els.analysisEngineSelect.innerHTML = '<option value="">— none —</option>';

  if (library.records.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "No engines imported yet.";
    els.engineList.appendChild(p);
  }

  for (const record of library.records) {
    const card = document.createElement("div");
    card.className = "engine-card";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = engineDisplayName(record);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${record.manifest.kind} · ${record.manifest.author || "unknown author"}`;

    const row = document.createElement("div");
    row.className = "row";

    const whiteBtn = document.createElement("button");
    whiteBtn.textContent = seats.w === record.id ? "\u2713 White" : "Play White";
    whiteBtn.onclick = () => assignSeat("w", seats.w === record.id ? null : record.id);

    const blackBtn = document.createElement("button");
    blackBtn.textContent = seats.b === record.id ? "\u2713 Black" : "Play Black";
    blackBtn.onclick = () => assignSeat("b", seats.b === record.id ? null : record.id);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.className = "danger";
    removeBtn.onclick = () => onRemoveEngine(record.id);

    row.append(whiteBtn, blackBtn, removeBtn);
    card.append(name, meta, row);
    els.engineList.appendChild(card);

    const opt = document.createElement("option");
    opt.value = record.id;
    opt.textContent = engineDisplayName(record);
    els.analysisEngineSelect.appendChild(opt);
  }

  els.btnAnalyzeToggle.disabled = library.records.length === 0;
}

async function assignSeat(color, engineIdOrNull) {
  seats[color] = engineIdOrNull;
  const record = engineIdOrNull ? library.records.find((r) => r.id === engineIdOrNull) : null;
  const label = record ? engineDisplayName(record) : "Human";
  (color === "w" ? els.seatWhiteValue : els.seatBlackValue).textContent = label;
  renderLibrary();
  await refreshSeatSessions();
  maybeTriggerEngineMove();
}

async function onRemoveEngine(id) {
  if (seats.w === id) await assignSeat("w", null);
  if (seats.b === id) await assignSeat("b", null);
  await removeEngine(id);
  library.records = await listEngines();
  renderLibrary();
}

async function refreshLibrary() {
  library.records = await listEngines();
  renderLibrary();
}

// ---------- wiring ----------

els.importInput.addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    els.statusText.textContent = `Importing ${file.name}...`;
    await addEngine(file);
    await refreshLibrary();
    els.statusText.textContent = `Imported ${file.name}.`;
  } catch (err) {
    els.statusText.textContent = `Import failed: ${err.message}`;
  }
});

els.btnNewGame.addEventListener("click", () => newGame());
els.btnFlip.addEventListener("click", () => board.setFlipped(!board.flipped));
els.btnSwapSides.addEventListener("click", async () => {
  const w = seats.w;
  const b = seats.b;
  seats.w = b;
  seats.b = w;
  const wRecord = seats.w ? library.records.find((r) => r.id === seats.w) : null;
  const bRecord = seats.b ? library.records.find((r) => r.id === seats.b) : null;
  els.seatWhiteValue.textContent = wRecord ? engineDisplayName(wRecord) : "Human";
  els.seatBlackValue.textContent = bRecord ? engineDisplayName(bRecord) : "Human";
  renderLibrary();
  await refreshSeatSessions();
  maybeTriggerEngineMove();
});

els.btnAnalyzeToggle.addEventListener("click", () => {
  if (analysisActive) stopAnalysis();
  else startAnalysis();
});

els.btnNavStart.addEventListener("click", goToStart);
els.btnNavBack.addEventListener("click", goBack);
els.btnNavForward.addEventListener("click", goForward);
els.btnNavEnd.addEventListener("click", goToEnd);
els.btnExportPgn.addEventListener("click", exportPgn);

document.addEventListener("keydown", (ev) => {
  // Ignore when the user is typing into a form control.
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (ev.key === "ArrowLeft") goBack();
  else if (ev.key === "ArrowRight") goForward();
  else if (ev.key === "ArrowUp") goToStart();
  else if (ev.key === "ArrowDown") goToEnd();
});

board.render();
renderMoveList();
refreshLibrary();
