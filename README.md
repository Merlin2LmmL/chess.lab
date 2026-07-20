# chess-lab

A monorepo for building, importing, and playing custom chess engines directly in the browser. chess-lab is split into two independent web applications that share a common engine format and a common loader library:

- **play**: import `.chsengine.zip` packages, play them against each other or against yourself, and run live analysis (evaluation bar, candidate moves, principal variation, heatmaps) while a game is in progress.
- **builder**: create new engines from scratch (either purely algorithmic evaluation functions or ONNX neural network models), or convert an existing engine build (official WASM builds, raw Emscripten output, or hand-written JS engines) into the chsengine package format. Includes a built in test console for sending raw UCI commands to a package before downloading it.

Both apps run entirely client side. There is no backend server: engines are loaded as zip files, unpacked in the browser, and executed inside a Web Worker using a plain text UCI protocol over `postMessage`.

## Repository structure

```
chess-lab/
├── package.json                    root workspace configuration and scripts
├── packages/
│   └── chsengine-core/              shared library: manifest validation, package loading, UCI client
│       ├── package.json
│       └── src/
│           ├── manifest.js          validates manifest.json against the chsengine v1 spec
│           ├── loader.js            unzips a package and boots its Worker
│           ├── uci.js               UciClient: async wrapper around the UCI-over-postMessage contract
│           └── index.js             public exports
└── apps/
    ├── play/                        play and analyze imported engines
    │   ├── package.json
    │   ├── vite.config.js
    │   ├── index.html
    │   └── src/
    │       ├── main.js               game flow, engine sessions, analysis (kibitzer) logic
    │       ├── board.js              dependency free click to move chess board renderer
    │       ├── engineStore.js        IndexedDB backed engine library (list, add, remove)
    │       └── style.css
    └── builder/                     create and convert engine packages
        ├── package.json
        ├── vite.config.js
        ├── index.html
        ├── public/
        │   └── vendor/
        │       └── chess.iife.js    bundled chess.js, attached to self.ChessLib for use inside Workers
        └── src/
            ├── main.js               tab and form wiring, build and download, test console
            ├── algobuilder.js        generates entry.js for algorithmic (js-algo) engines
            ├── nnbuilder.js          generates entry.js for neural network (nn-onnx) engines
            ├── converter.js          wraps existing Emscripten MODULARIZE builds
            ├── packager.js           manifest construction, zip packaging, downloads
            └── style.css
```

## The chsengine package format

An engine is distributed as a single `.chsengine.zip` file containing a `manifest.json` at its root plus whatever entry script and assets the engine needs. The manifest is validated strictly on import so a malformed package fails immediately with a specific error message rather than failing silently inside a Worker.

Supported manifest fields:

| Field | Type | Notes |
|---|---|---|
| `format` | string | must be `"chsengine"` |
| `formatVersion` | number | must be `1` |
| `name` | string | required |
| `version` | string | required |
| `author` | string | optional |
| `description` | string | optional |
| `license` | string | optional |
| `kind` | string | one of `wasm-uci`, `js-uci`, `js-algo`, `nn-onnx` |
| `entry` | string | filename of the Worker entry script, must exist in the zip |
| `wasmStrategy` | string | one of `none`, `hash-fragment`, `locateFile-module` |
| `wasmAsset` | string or null | required filename when `wasmStrategy` is `hash-fragment` |
| `assets` | string array | additional files referenced by the entry script |

Every engine runs inside its own Web Worker and communicates using plain UCI text lines, one command or response per `postMessage` call, with no additional envelope or framing.

## Prerequisites

- Node.js (v18 or later recommended)
- npm
- A modern browser with Web Worker support

## Installing dependencies

From the repository root:

```
npm install
```

This installs dependencies for the root workspace and both apps in a single pass, since chess-lab uses npm workspaces.

## Running locally

Start the play app:

```
npm run dev:play
```

The play app will be available at `http://localhost:5173`.

Start the builder app in a separate terminal:

```
npm run dev:builder
```

The builder app will be available at `http://localhost:5174`.

Both apps can run at the same time, on their own ports, without conflicting.

## Building for production

```
npm run build:play
npm run build:builder
```

Each command produces a static `dist/` folder inside the corresponding app directory (`apps/play/dist` and `apps/builder/dist`), ready to be hosted on any static file server.

## Deploying both apps to GitHub Pages

This repository is now configured to publish both web apps from a single GitHub Pages site via the workflow at `.github/workflows/deploy-pages.yml`.

### What is already configured

- `apps/play` builds with base path `/chess.lab/play/`
- `apps/builder` builds with base path `/chess.lab/builder/`
- The workflow builds both apps, combines them into one Pages artifact, and deploys:
  - `https://<user>.github.io/chess.lab/play/`
  - `https://<user>.github.io/chess.lab/builder/`

### Remaining GitHub settings steps

1. In repository **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow manually from the Actions tab).
3. After the workflow completes, open the root site URL to see links to both apps.
