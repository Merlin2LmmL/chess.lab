const PIECE_TYPE_TO_ASSET = {
  p: "P",
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECES_BASE_URL = `${import.meta.env.BASE_URL}pieces/`;

/**
 * A dependency-free click-to-move chess board. Legality comes entirely from
 * the chess.js instance handed in; this class only renders it and turns
 * clicks into chess.js move() calls. Promotions auto-queen.
 */
export class ChessBoardUI {
  /**
   * @param {HTMLElement} host
   * @param {{ getChess: () => import("chess.js").Chess, onUserMove: (move: any) => void, canMove: () => boolean }} opts
   */
  constructor(host, opts) {
    this.host = host;
    this.opts = opts;
    this.flipped = false;
    this.selected = null;
    this.legalTargets = [];
    this.lastMove = null;
    /** @type {Map<string,{color:string,opacity:number}>} */
    this.heat = new Map();
    this._buildDom();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "board";
    this.squareEls = new Map();
    this.host.innerHTML = "";
    this.host.appendChild(this.el);
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    this.render();
  }

  setLastMove(from, to) {
    this.lastMove = from && to ? { from, to } : null;
  }

  /** @param {Map<string,{color:string,opacity:number}>} heat */
  setHeatmap(heat) {
    this.heat = heat || new Map();
    this.render();
  }

  clearSelection() {
    this.selected = null;
    this.legalTargets = [];
  }

  render() {
    const chess = this.opts.getChess();

    this.el.innerHTML = "";
    this.squareEls.clear();

    // We build the grid purely from visual position (row/col on screen) and
    // derive the actual chess square (e.g. "e4") from that, rather than
    // reversing separate rank/file arrays and indexing into chess.board().
    // That indirection is what let rank-reversal and file-reversal drift out
    // of sync (causing pieces to land on the wrong file). Using chess.get()
    // with an explicit square name is unambiguous: whatever square we ask
    // for is exactly the piece that's there, regardless of orientation.
    for (let visualRow = 0; visualRow < 8; visualRow++) {
      // visualRow 0 is the top of the screen.
      const rankNumber = this.flipped ? visualRow + 1 : 8 - visualRow;
      for (let visualCol = 0; visualCol < 8; visualCol++) {
        // visualCol 0 is the left of the screen.
        const file = this.flipped ? FILES[7 - visualCol] : FILES[visualCol];
        const square = `${file}${rankNumber}`;
        const piece = chess.get(square);

        // Square color is an intrinsic property of the square itself (a1 is
        // always dark, h1 is always light) - it must NOT depend on flipped
        // or on iteration order, only on the square's own file/rank.
        const isLight = (FILES.indexOf(file) + rankNumber) % 2 === 1;

        const sq = document.createElement("div");
        sq.className = `sq ${isLight ? "light" : "dark"}`;
        sq.dataset.square = square;

        if (this.selected === square) sq.classList.add("selected");
        if (this.legalTargets.includes(square)) sq.classList.add("legal-target");
        if (this.lastMove && (this.lastMove.from === square || this.lastMove.to === square)) {
          sq.classList.add("last-move");
        }

        const heatEntry = this.heat.get(square);
        const heatDiv = document.createElement("div");
        heatDiv.className = "heat";
        if (heatEntry) {
          heatDiv.style.setProperty("--heat-color", heatEntry.color);
          heatDiv.style.setProperty("--heat-opacity", String(heatEntry.opacity));
        }
        sq.appendChild(heatDiv);

        if (piece) {
          const img = document.createElement("img");
          img.className = "piece";
          img.src = `${PIECES_BASE_URL}${piece.color}${PIECE_TYPE_TO_ASSET[piece.type]}.svg`;
          img.alt = `${piece.color === "w" ? "White" : "Black"} ${piece.type}`;
          img.draggable = false;
          sq.appendChild(img);
        }

        if (visualCol === 7) {
          const coord = document.createElement("span");
          coord.className = "coord";
          coord.textContent = String(rankNumber);
          sq.appendChild(coord);
        }

        sq.addEventListener("click", () => this._onSquareClick(square));
        this.el.appendChild(sq);
        this.squareEls.set(square, sq);
      }
    }
  }

  _onSquareClick(square) {
    if (!this.opts.canMove()) return;
    const chess = this.opts.getChess();

    if (this.selected === square) {
      this.clearSelection();
      this.render();
      return;
    }

    if (this.selected && this.legalTargets.includes(square)) {
      const moveInput = { from: this.selected, to: square, promotion: "q" };
      const move = chess.move(moveInput);
      this.clearSelection();
      if (move) {
        this.setLastMove(move.from, move.to);
        this.opts.onUserMove(move);
      }
      this.render();
      return;
    }

    const piece = chess.get(square);
    if (piece && piece.color === chess.turn()) {
      this.selected = square;
      this.legalTargets = chess.moves({ square, verbose: true }).map((m) => m.to);
      this.render();
      return;
    }

    this.clearSelection();
    this.render();
  }
}
