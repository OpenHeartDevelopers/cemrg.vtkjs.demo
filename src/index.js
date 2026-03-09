/**
 * index.js  --  CEMRG VR Heart Demo
 *
 * Architecture overview:
 *
 *   renderWindow  (vtkFullScreenRenderWindow)
 *     └── renderer  (vtkRenderer)
 *           ├── actor   (vtkActor)  <-- the heart mesh, the only thing that moves
 *           └── lights  (3x vtkLight, added once at startup, never removed)
 *
 *   XRHelper  (vtkWebXRRenderWindowHelper)
 *     └── started with physicalScale derived from mesh bounding box
 *           so the heart appears at a comfortable ~40cm size in VR regardless
 *           of the raw VTK coordinate values (meshes are in millimetres).
 *
 *   VR interaction model (seated user):
 *     Camera is FIXED.  The actor is the thing the user manipulates.
 *     Right trigger + move  ->  rotate actor (VRRotationManipulator)
 *     Right thumbstick      ->  scale actor  (VRScaleManipulator)
 *
 *   Pulse animation:
 *     requestAnimationFrame loop that oscillates actor scale at ~72 bpm.
 *     Toggled on/off by a button. Paused automatically when entering VR
 *     (a static model is easier to interrogate in XR).
 */

// --- vtk.js core imports ---
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkWebXRRenderWindowHelper from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';
import vtkResourceLoader from '@kitware/vtk.js/IO/Core/ResourceLoader';

import { XrSessionTypes } from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper/Constants';

// DataAccessHelpers must be imported so vtk.js knows how to resolve URLs
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HtmlDataAccessHelper';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HttpDataAccessHelper';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/JSZipDataAccessHelper';

// --- local modules ---
import { VRRotationManipulator, VRScaleManipulator } from './MyVRManipulator.js';
import controlPanel from './controller.html';
import { loadDataFromNumber } from './loadData.js';

// ---------------------------------------------------------------------------
// WebXR polyfill (Cardboard / legacy WebVR backward compatibility)
// Only loaded if the browser has no native XR support.
// ---------------------------------------------------------------------------
if (navigator.xr === undefined) {
    vtkResourceLoader
        .loadScript(
            'https://cdn.jsdelivr.net/npm/webxr-polyfill@latest/build/webxr-polyfill.js',
        )
        .then(() => {
            // eslint-disable-next-line no-new, no-undef
            new WebXRPolyfill();
        });
}

// ---------------------------------------------------------------------------
// Renderer setup
// ---------------------------------------------------------------------------
const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
    background: [0.04, 0.04, 0.08], // Near-black with a very slight blue tint
});
const renderer = fullScreenRenderer.getRenderer();
const renderWindow = fullScreenRenderer.getRenderWindow();

// XRHelper is the bridge between vtk.js and the WebXR device API.
// physicalScale is configured after the first mesh loads (see processData).
const XRHelper = vtkWebXRRenderWindowHelper.newInstance({
    renderWindow: fullScreenRenderer.getApiSpecificRenderWindow(),
});

// ---------------------------------------------------------------------------
// Scene objects -- created once, reused across mesh switches
// ---------------------------------------------------------------------------
const mapper = vtkMapper.newInstance();
const actor = vtkActor.newInstance();
actor.setMapper(mapper);

// Specular highlight gives the mesh a soft tissue / glass-like look
actor.getProperty().setSpecular(0.6);
actor.getProperty().setSpecularPower(30);
actor.getProperty().setDiffuse(0.8);
actor.getProperty().setAmbient(0.15);

renderer.addActor(actor);

// ---------------------------------------------------------------------------
// Lighting  --  added ONCE at startup and left in the renderer permanently.
//
// Bug fix: the original code added lights only on the first processData() call
// and skipped them on subsequent calls. Since clearScene() removed actors but
// not lights, the second mesh load had no lights at all.
//
// Fix: extract into setupLights(), call once, never remove.
// ---------------------------------------------------------------------------

/**
 * Adds a three-point lighting rig to the renderer.
 * Key light (front), fill light (opposite), rim light (below).
 * @param {vtkRenderer} renderer
 */
function setupLights(renderer) {
    // Key light: primary illumination from front-upper-right
    const key = vtkLight.newInstance();
    key.setPosition(1, 1, 1);
    key.setFocalPoint(0, 0, 0);
    key.setIntensity(0.7);
    renderer.addLight(key);

    // Fill light: softer counter-illumination from behind-lower-left
    const fill = vtkLight.newInstance();
    fill.setPosition(-1, -0.5, -1);
    fill.setFocalPoint(0, 0, 0);
    fill.setIntensity(0.4);
    renderer.addLight(fill);

    // Rim / back light: separates the mesh from the background
    const rim = vtkLight.newInstance();
    rim.setPosition(0, -1.5, -1);
    rim.setFocalPoint(0, 0, 0);
    rim.setIntensity(0.6);
    renderer.addLight(rim);
}

setupLights(renderer);

// ---------------------------------------------------------------------------
// physicalScale helper
//
// Root cause of VR controls flying off:
//   WebXR operates in SI metres. vtk.js maps 1 VTK unit = 1 XR metre by default.
//   Cardiac meshes in millimetres span ~80-200 VTK units => 80-200 METRES in XR.
//   Any small hand movement (0.01 m = 10 VTK units) sends the viewpoint flying.
//
// Fix:
//   physicalScale tells the XR runtime how many VTK units equal one physical metre.
//   We derive it from the mesh bounding box so the heart always appears at
//   a comfortable viewing size (~40 cm diagonal) regardless of mesh scale.
//
//   physicalScale = vtk_diagonal_units / target_physical_metres
//
//   For a 150 mm diagonal mesh targeting 0.40 m appearance:
//     physicalScale = 150 / 0.40 = 375
//   i.e. 375 VTK units (375 mm) map to 1 physical metre.
// ---------------------------------------------------------------------------

/**
 * Computes a physicalScale value so the mesh bounding-box diagonal maps to
 * a comfortable viewing size in VR.
 *
 * @param   {vtkActor} actor
 * @param   {number}   targetDiameterMeters  Desired apparent size in XR (default 0.4 m)
 * @returns {number}   physicalScale to pass to the XR render window
 */
function computePhysicalScale(actor, targetDiameterMeters = 0.40) {
    const [xMin, xMax, yMin, yMax, zMin, zMax] = actor.getBounds();
    const diagonal = Math.sqrt(
        (xMax - xMin) ** 2 +
        (yMax - yMin) ** 2 +
        (zMax - zMin) ** 2,
    );

    if (diagonal < 1e-6) {
        // Degenerate bounds; fall back to a safe default for mm meshes
        console.warn('computePhysicalScale: degenerate bounds, using default scale 375');
        return 375;
    }

    return diagonal / targetDiameterMeters;
}

// ---------------------------------------------------------------------------
// Colour mapping
//
// Applies a LUT to cell-data scalars when present.
// Falls back to a flat red-toned surface for meshes without scalars.
// ---------------------------------------------------------------------------

/**
 * Configures the mapper colour mapping from VTK polydata cell data.
 * @param {vtkPolyData} polydata
 */
function applyColourMapping(polydata) {
    const cellData = polydata.getCellData();
    const numberOfArrays = cellData.getNumberOfArrays();

    if (numberOfArrays === 0) {
        // No scalar data: render as a flat anatomical red
        actor.getProperty().setColor(0.72, 0.12, 0.12);
        mapper.setScalarVisibility(false);
        return;
    }

    const arrayName = cellData.getArrayName(0);
    cellData.setActiveScalars(arrayName);

    const scalars = cellData.getScalars(arrayName);
    if (!scalars) {
        actor.getProperty().setColor(0.72, 0.12, 0.12);
        mapper.setScalarVisibility(false);
        return;
    }

    const [rangeMin, rangeMax] = scalars.getRange();

    // Diverging colour map: deep red (low) -> vivid blue (high).
    // Clinically meaningful for activation time or fibrosis density maps.
    const lut = vtkColorTransferFunction.newInstance();
    lut.setRange(rangeMin, rangeMax);
    lut.addRGBPoint(rangeMin, 0.55, 0.0, 0.0);
    lut.addRGBPoint(rangeMax, 0.05, 0.05, 0.85);

    // Discrete banding: one colour band per integer scalar step.
    // This is appropriate for labelled region maps (e.g. 17-segment AHA model).
    // For continuous scalar fields (activation time), set setDiscretize(false).
    lut.setDiscretize(true);
    lut.setNumberOfValues(Math.max(2, Math.round(rangeMax - rangeMin + 1)));

    mapper.setLookupTable(lut);
    mapper.setScalarRange(rangeMin, rangeMax);
    mapper.setScalarVisibility(true);
}

// ---------------------------------------------------------------------------
// Scene management
// ---------------------------------------------------------------------------

/**
 * Removes all actors from the renderer WITHOUT removing lights.
 * Lights are persistent (added once in setupLights).
 * @param {vtkRenderer}     renderer
 * @param {vtkRenderWindow} renderWindow
 */
function clearScene(renderer, renderWindow) {
    renderer.getActors().forEach((a) => renderer.removeActor(a));
    renderWindow.render();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Loads mesh by number, configures the actor and mapper, resets camera.
 * physicalScale is (re)computed each time in case mesh size changes significantly.
 *
 * @param {number}  meshNumber
 */
function processData(meshNumber) {
    console.log(`[CEMRG] Loading mesh index ${meshNumber}`);

    loadDataFromNumber(meshNumber).then((polydata) => {
        if (!polydata) {
            console.error('[CEMRG] loadDataFromNumber returned null');
            return;
        }

        mapper.setInputData(polydata);
        applyColourMapping(polydata);

        // Re-add actor (it may have been removed by clearScene)
        if (!renderer.getActors().includes(actor)) {
            renderer.addActor(actor);
        }

        renderer.resetCamera();
        renderWindow.render();

        // Recompute physicalScale so VR scale is always appropriate for this mesh.
        // This must happen BEFORE the user enters XR, not during.
        const scale = computePhysicalScale(actor);
        console.log(`[CEMRG] physicalScale for VR: ${scale.toFixed(1)} VTK units/m`);
        try {
            // getApiSpecificRenderWindow() returns the WebGL/WebXR render window.
            // setPhysicalScale is available on vtkOpenGLRenderWindow in vtk.js >= 28.
            fullScreenRenderer.getApiSpecificRenderWindow().setPhysicalScale(scale);
        } catch (e) {
            console.warn('[CEMRG] setPhysicalScale unavailable on this vtk.js build:', e.message);
        }

        // Update the VR manipulators with the (possibly new) actor reference
        if (rotationManipulator) rotationManipulator.setActor(actor);
        if (scaleManipulator) scaleManipulator.setActor(actor);
    });
}

// ---------------------------------------------------------------------------
// VR manipulator setup
//
// Called once when the VR session starts (not before, because the interactor
// style is only available in XR mode).
// ---------------------------------------------------------------------------

/** @type {VRRotationManipulator|null} */
let rotationManipulator = null;
/** @type {VRScaleManipulator|null}    */
let scaleManipulator = null;

/**
 * Registers the custom manipulators with the XR interactor.
 * Must be called AFTER XRHelper.startXR() resolves, because the XR
 * interactor style is not instantiated until the session begins.
 */
function setupVRManipulators() {
    const interactor = renderWindow.getInteractor();

    if (!interactor) {
        console.error('[CEMRG] setupVRManipulators: no interactor available');
        return;
    }

    rotationManipulator = VRRotationManipulator.newInstance();
    rotationManipulator.setActor(actor);
    interactor.addVRManipulator(rotationManipulator);

    scaleManipulator = VRScaleManipulator.newInstance();
    scaleManipulator.setActor(actor);
    interactor.addVRManipulator(scaleManipulator);

    console.log('[CEMRG] VR manipulators registered');
}

// ---------------------------------------------------------------------------
// Pulse animation
//
// A sinusoidal scale oscillation at ~72 bpm (1.2 Hz) with ±4% amplitude.
// Purely cosmetic: it makes the heart look alive in the demo.
// Automatically paused when entering VR (a throbbing model is harder to study).
// ---------------------------------------------------------------------------

let pulseAnimationId = null;  // requestAnimationFrame handle
let pulseBaseScale = 1.0;   // scale at the time animation started
const PULSE_FREQUENCY = 1.2;   // Hz (72 bpm)
const PULSE_AMPLITUDE = 0.04;  // ±4% of actor scale

/**
 * Runs one animation frame for the heartbeat pulse.
 * @param {DOMHighResTimeStamp} timestamp
 */
function animatePulse(timestamp) {
    const t = timestamp / 1000; // seconds
    const oscillation = Math.sin(2 * Math.PI * PULSE_FREQUENCY * t);
    const s = pulseBaseScale * (1.0 + PULSE_AMPLITUDE * oscillation);
    actor.setScale(s, s, s);
    renderWindow.render();
    pulseAnimationId = requestAnimationFrame(animatePulse);
}

/**
 * Starts the pulse animation.
 */
function startPulse() {
    if (pulseAnimationId !== null) return; // already running
    pulseBaseScale = actor.getScale()[0];
    pulseAnimationId = requestAnimationFrame(animatePulse);
}

/**
 * Stops the pulse animation and restores actor scale.
 */
function stopPulse() {
    if (pulseAnimationId === null) return;
    cancelAnimationFrame(pulseAnimationId);
    pulseAnimationId = null;
    // Restore to the pre-animation base scale
    actor.setScale(pulseBaseScale, pulseBaseScale, pulseBaseScale);
    renderWindow.render();
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
fullScreenRenderer.addController(controlPanel);

const vrButton = document.querySelector('.vrbutton');
const loadMeshSelector = document.querySelector('.meshes');
const representationSel = document.querySelector('.representations');
const opacitySlider = document.querySelector('.opacity');   // was '.resolution'
const pulseButton = document.querySelector('.pulsebutton');

// --- Representation (points / wireframe / surface) ---
representationSel.addEventListener('change', (e) => {
    actor.getProperty().setRepresentation(Number(e.target.value));
    renderWindow.render();
});

// --- Opacity ---
// Bug fix: original slider was labelled 'resolution' and connected to setOpacity.
// The label is now corrected in controller.html to 'opacity'.
opacitySlider.addEventListener('input', (e) => {
    // Slider range 1-10; map to opacity 0.1-1.0
    actor.getProperty().setOpacity(Number(e.target.value) / 10);
    renderWindow.render();
});

// --- Mesh selector ---
loadMeshSelector.addEventListener('change', (e) => {
    const meshNumber = Number(e.target.value);
    const meshName = e.target.options[e.target.selectedIndex].text;
    console.log(`[CEMRG] Switching to mesh: ${meshName}`);

    // Stop pulse during load to avoid scale state corruption
    const wasAnimating = pulseAnimationId !== null;
    stopPulse();

    clearScene(renderer, renderWindow);
    processData(meshNumber);

    if (wasAnimating) startPulse();
});

// --- Pulse animation toggle ---
if (pulseButton) {
    pulseButton.addEventListener('click', () => {
        if (pulseAnimationId !== null) {
            stopPulse();
            pulseButton.textContent = 'Start Pulse';
        } else {
            startPulse();
            pulseButton.textContent = 'Stop Pulse';
        }
    });
}

// --- VR button ---
//
// Bug fixes vs original:
//   1. xrSession was declared but never assigned, so xrSession.end() threw on exit.
//      Fix: XRHelper.startXR() does not return the session directly in all vtk.js
//      versions. We track VR state with a boolean instead and call XRHelper.stopXR().
//   2. setupVRManipulators() was commented out. Now called after session starts.
//   3. Pulse is paused on XR entry (static model easier to examine).
//
// Note on reference space:
//   vtk.js vtkWebXRRenderWindowHelper internally requests a 'local-floor' reference
//   space for HmdVR sessions. For a SEATED user, 'local' is more appropriate (it does
//   not shift the origin to the floor, avoiding a vertical offset when the user is
//   in a chair). If your vtk.js build exposes setReferenceSpaceType() on the helper,
//   call: XRHelper.setReferenceSpaceType('local');
//   As of vtk.js 30.x this must be patched in the XR render window. Tracked upstream.

let vrIsActive = false;

vrButton.addEventListener('click', async () => {
    if (!vrIsActive) {
        console.log('[CEMRG] Requesting XR session...');

        // Pause pulse before entering XR
        stopPulse();
        if (pulseButton) pulseButton.textContent = 'Start Pulse';

        try {
            await XRHelper.startXR(XrSessionTypes.HmdVR);
            vrIsActive = true;
            vrButton.textContent = 'Return From VR';

            // Manipulators must be registered after the session is active
            setupVRManipulators();

        } catch (err) {
            console.error('[CEMRG] Failed to start XR session:', err);
            alert(
                'Could not start VR session.\n' +
                'Ensure you are using a WebXR-capable browser and your headset is connected.',
            );
        }

    } else {
        console.log('[CEMRG] Ending XR session...');
        try {
            await XRHelper.stopXR();
        } catch (err) {
            console.warn('[CEMRG] stopXR error (session may have already ended):', err);
        }
        vrIsActive = false;
        vrButton.textContent = 'Send To VR';
    }
});

// ---------------------------------------------------------------------------
// Initial load
// ---------------------------------------------------------------------------
processData(0);

// ---------------------------------------------------------------------------
// Developer console access
// Retaining these so the browser console can be used for live debugging.
// ---------------------------------------------------------------------------
global.actor = actor;
global.mapper = mapper;
global.renderer = renderer;
global.renderWindow = renderWindow;
global.XRHelper = XRHelper;
global.startPulse = startPulse;
global.stopPulse = stopPulse;