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

## Deploying to GitHub Pages

GitHub Pages serves static files, which is exactly what each app builds down to. Since this repository contains two separate apps, you deploy them independently, each to its own Pages site or its own subpath.

1. In each app's `vite.config.js`, set the `base` option to match the path the app will be served from. For a project site (the common case, served at `https://your-username.github.io/chess-lab/`), add:

   ```js
   export default defineConfig({
     base: "/chess-lab/",
     // ...rest of the existing config
   });
   ```

   Adjust the path if your repository name differs, or if you are deploying the builder app to its own repository or subpath.

2. Build the app you want to publish:

   ```
   npm run build:play
   ```

3. Push the contents of `apps/play/dist` to a `gh-pages` branch. The simplest way is with the `gh-pages` package:

   ```
   npm install -D gh-pages -w apps/play
   npx gh-pages -d apps/play/dist
   ```

4. In your GitHub repository settings, under Pages, set the source to the `gh-pages` branch.

5. Repeat steps 1 through 4 for the builder app if you want it published as well, adjusting the `base` path and target branch or repository as needed so the two apps do not overwrite each other.

Once published, GitHub will serve the site at `https://your-username.github.io/chess-lab/` (or the equivalent path you configured), and it will update automatically each time you repeat the build and deploy steps.
