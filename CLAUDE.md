# cemrg.vtkjs.demo

Cardiac VR visualization demo using vtk.js 30.x and WebXR. Renders heart meshes
(.vtk) with support for desktop mouse interaction and immersive VR headsets.

## Commands

```bash
npm run build   # Webpack production bundle → dist/
npm run dev     # Serve dist/ on http://localhost:8080 (requires prior build)
```

No watch mode or dev server with HMR. Edit → build → refresh.

## Architecture

`src/index.js` is the orchestrator: sets up the VTK renderer, wires UI events,
manages XR session lifecycle, and calls into the other modules.

| File | Role |
|---|---|
| `src/loadData.js` | Fetches `.vtk` files at runtime via HTTP (not bundled) |
| `src/MyVRManipulator.js` | Custom VR rotation (trigger+move) and scale (thumbstick) |
| `src/controlsOverlay.js` | DOM HUD panel; survives XR transitions; no VTK 2D actors |
| `src/controller.html` | UI control panel, injected via vtk.js `addController()` |
| `src/generateData.js` | Dev utility generating a cone; unused in production flow |
| `src/index_original.js` | Legacy reference; not imported anywhere |
| `data/*.vtk` | Mesh files copied to `dist/data/` at build time by CopyWebpackPlugin |

## vtk.js 30.x Macro Pattern

New vtk.js classes follow this factory pattern (see `MyVRManipulator.js`):

```js
function vtkClassName(publicAPI, model) { /* attach methods */ }
function extend(publicAPI, model, initialValues) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  macro.obj(publicAPI, model);
  BaseClass.extend(publicAPI, model, initialValues); // chain base
  vtkClassName(publicAPI, model);
}
export const newInstance = macro.newInstance(extend, 'ClassName');
```

Do not use ES6 class syntax for vtk.js objects.

## Domain Terminology

- **AFib** – Atrial fibrillation (mesh index 1, `afib.vtk`)
- **HR** – Heart failure / heart remodelling (mesh index 2, `hr.vtk`)
- **Activation time** – Scalar cell data representing electrical wavefront timing
- **Fibrosis** – Scalar cell data representing scar tissue density
- **Physical scale** – VTK XR property that maps scene units (mm) to metres in VR

## Known Gotchas

- Mesh coordinates are in mm. `computePhysicalScale()` in `index.js` converts
  bounding box size to an appropriate VR physical scale so the heart appears
  ~40 cm in headset. This must be recomputed after every mesh switch.
- Lights must be added once at startup via `setupLights()`. Adding them inside
  `processData()` causes them to be lost on the first mesh switch (this was the
  original bug).
- VR manipulators must be registered after the XR session starts, not before.
  Wire them in the `enterXR` callback, not at module load time.
- `dist/` is wiped on every build (`output.clean: true`). Do not place manual
  files there.
- `data/` files are served via HTTP; the browser fetches them at runtime.
  Running `dist/index.html` from the filesystem (file://) will fail CORS.
- `window.actor`, `window.mapper`, `window.renderer` etc. are exposed as a
  deliberate developer API for in-browser debugging.
