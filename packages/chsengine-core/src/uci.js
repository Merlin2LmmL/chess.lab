function toInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function parseBestmoveLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "bestmove") return null;
  const bestmove = parts[1] && parts[1] !== "(none)" ? parts[1] : null;
  const ponderIndex = parts.indexOf("ponder");
  const ponder = ponderIndex >= 0 && parts[ponderIndex + 1] ? parts[ponderIndex + 1] : null;
  return { bestmove, ponder };
}

export function parseInfoLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "info") return null;

  const out = { pv: [] };
  for (let i = 1; i < parts.length; i += 1) {
    const tok = parts[i];
    if (tok === "depth") out.depth = toInt(parts[++i]);
    else if (tok === "seldepth") out.seldepth = toInt(parts[++i]);
    else if (tok === "nodes") out.nodes = toInt(parts[++i]);
    else if (tok === "nps") out.nps = toInt(parts[++i]);
    else if (tok === "time") out.time = toInt(parts[++i]);
    else if (tok === "multipv") out.multipv = toInt(parts[++i]);
    else if (tok === "score") {
      const type = parts[++i];
      const value = toInt(parts[++i]);
      if ((type === "cp" || type === "mate") && value != null) {
        out.score = { type, value };
      }
    } else if (tok === "pv") {
      out.pv = parts.slice(i + 1);
      break;
    }
  }

  return out;
}

export class UciClient {
  /** @param {Worker} worker */
  constructor(worker) {
    this.worker = worker;
    this.lineHandlers = new Set();

    worker.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      for (const handler of this.lineHandlers) handler(ev.data);
    });
  }

  onLine(handler) {
    this.lineHandlers.add(handler);
    return () => this.lineHandlers.delete(handler);
  }

  send(command) {
    this.worker.postMessage(command);
  }

  waitFor(predicate, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const off = this.onLine((line) => {
        if (!predicate(line)) return;
        clearTimeout(timeoutId);
        off();
        resolve(line);
      });

      const timeoutId = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for UCI response after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  async uci() {
    this.send("uci");
    await this.waitFor((line) => line === "uciok");
  }

  async isReady() {
    this.send("isready");
    await this.waitFor((line) => line === "readyok");
  }

  newGame() {
    this.send("ucinewgame");
  }

  setOption(name, value) {
    const hasValue = value !== undefined && value !== null;
    this.send(`setoption name ${name}${hasValue ? ` value ${value}` : ""}`);
  }

  setPosition({ fen, moves = [] } = {}) {
    const positionPart = fen ? `fen ${fen}` : "startpos";
    const movesPart = moves.length ? ` moves ${moves.join(" ")}` : "";
    this.send(`position ${positionPart}${movesPart}`);
  }

  async go(params = {}, onInfo) {
    const tokens = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === false || value == null) continue;
      tokens.push(key);
      if (value !== true) tokens.push(String(value));
    }

    return new Promise((resolve) => {
      const off = this.onLine((line) => {
        if (line.startsWith("info ") && onInfo) {
          const parsed = parseInfoLine(line);
          if (parsed) onInfo(parsed);
          return;
        }

        if (!line.startsWith("bestmove")) return;
        off();
        resolve(parseBestmoveLine(line) || { bestmove: null, ponder: null });
      });

      this.send(`go${tokens.length ? ` ${tokens.join(" ")}` : ""}`);
    });
  }

  stop() {
    this.send("stop");
  }

  quit() {
    this.send("quit");
  }
}
