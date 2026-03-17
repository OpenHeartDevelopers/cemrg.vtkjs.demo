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
 *     └── physicalScale derived from mesh bounding box on each load so the heart
 *         appears ~40cm across in the headset regardless of raw mm coordinates.
 *
 *   VR interaction model (seated user):
 *     Camera is FIXED. The actor is the thing the user manipulates.
 *     Right trigger + move hand  ->  rotate actor (VRRotationManipulator)
 *     Right thumbstick Y-axis    ->  scale actor  (VRScaleManipulator)
 *
 *   Controls overlay (DOM):
 *     A fixed-position HTML panel showing input bindings for desktop and VR.
 *     Implemented as a DOM element (not a VTK 2D actor) because DOM elements
 *     survive XR session transitions correctly -- a VTK 2D actor would require
 *     manual recompositing into the XR framebuffer.
 *     Switches active section automatically on XR entry/exit.
 *
 *   Pulse animation:
 *     requestAnimationFrame loop oscillating actor scale at ~72 bpm / +/-4%.
 *     Paused automatically on VR entry (static model is easier to study in XR).
 */

import '@kitware/vtk.js/Rendering/Profiles/Geometry';

// Should return the vtkOpenGLRenderer constructor, not undefined
const factory = window.renderWindow?.getViews()[0]?.getViewNodeFactory?.();
console.log(factory?.createNode(window.renderer));

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
import { createControlsOverlay, setOverlayMode } from './controlsOverlay.js';
import controlPanel from './controller.html';
import { loadDataFromNumber } from './loadData.js';

// ---------------------------------------------------------------------------
// WebXR polyfill (Cardboard / legacy WebVR backward compat)
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
    background: [0.04, 0.04, 0.08],
});
const renderer = fullScreenRenderer.getRenderer();
const renderWindow = fullScreenRenderer.getRenderWindow();

// XRHelper bridges vtk.js to the WebXR device API.
// physicalScale is set after the first mesh loads (see processData).
const XRHelper = vtkWebXRRenderWindowHelper.newInstance({
    renderWindow: fullScreenRenderer.getApiSpecificRenderWindow(),
});

// ---------------------------------------------------------------------------
// Scene objects -- created once, reused across mesh switches
// ---------------------------------------------------------------------------
const mapper = vtkMapper.newInstance();
const actor = vtkActor.newInstance();
actor.setMapper(mapper);

// Specular highlight gives mesh a soft tissue / glass-like appearance
actor.getProperty().setSpecular(0.6);
actor.getProperty().setSpecularPower(30);
actor.getProperty().setDiffuse(0.8);
actor.getProperty().setAmbient(0.15);

renderer.addActor(actor);

// ---------------------------------------------------------------------------
// Lighting -- added ONCE at startup, permanent.
//
// Bug fix from original: lights were added conditionally in processData(),
// which meant they disappeared after the first mesh switch. Now extracted
// into setupLights() and called once here. clearScene() only removes actors.
// ---------------------------------------------------------------------------

/**
 * Adds a three-point lighting rig: key (front), fill (back), rim (below).
 * @param {vtkRenderer} renderer
 */
function setupLights(renderer) {
    const key = vtkLight.newInstance();
    key.setPosition(1, 1, 1);
    key.setFocalPoint(0, 0, 0);
    key.setIntensity(0.7);
    renderer.addLight(key);

    const fill = vtkLight.newInstance();
    fill.setPosition(-1, -0.5, -1);
    fill.setFocalPoint(0, 0, 0);
    fill.setIntensity(0.4);
    renderer.addLight(fill);

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
//   Cardiac meshes in mm span ~80-200 VTK units => 80-200 metres in XR.
//   Any small hand movement (0.01 m = 10 VTK units) sends the viewpoint flying.
//
// Fix:
//   physicalScale = vtk_diagonal_units / target_physical_metres
//   For a 150mm diagonal mesh at 0.40m display size: scale = 375
//   i.e. 375 VTK units map to 1 physical metre.
// ---------------------------------------------------------------------------

/**
 * Computes physicalScale so the mesh bounding-box diagonal maps to a comfortable
 * size in VR.
 * @param   {vtkActor} actor
 * @param   {number}   targetDiameterMeters  Default 0.4 m
 * @returns {number}
 */
function computePhysicalScale(actor, targetDiameterMeters = 0.40) {
    const [xMin, xMax, yMin, yMax, zMin, zMax] = actor.getBounds();
    const diagonal = Math.sqrt(
        (xMax - xMin) ** 2 +
        (yMax - yMin) ** 2 +
        (zMax - zMin) ** 2,
    );

    if (diagonal < 1e-6) {
        console.warn('[CEMRG] computePhysicalScale: degenerate bounds, using default 375');
        return 375;
    }

    return diagonal / targetDiameterMeters;
}

// ---------------------------------------------------------------------------
// Colour mapping
// ---------------------------------------------------------------------------

/**
 * Configures the mapper LUT from VTK polydata cell data.
 * Falls back to flat anatomical red when no scalars are present.
 * @param {vtkPolyData} polydata
 */
function applyColourMapping(polydata) {
    const cellData = polydata.getCellData();
    const numberOfArrays = cellData.getNumberOfArrays();

    if (numberOfArrays === 0) {
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

    // Diverging: deep red (low) -> vivid blue (high).
    // Clinically appropriate for activation time or fibrosis density maps.
    const lut = vtkColorTransferFunction.newInstance();
    lut.setRange(rangeMin, rangeMax);
    lut.addRGBPoint(rangeMin, 0.55, 0.0, 0.0);
    lut.addRGBPoint(rangeMax, 0.05, 0.05, 0.85);

    // Discrete banding: one band per integer scalar step (AHA 17-segment model).
    // For continuous fields (activation time), set setDiscretize(false).
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
 * Removes all actors WITHOUT removing lights (lights are permanent).
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
 * Loads mesh by index, configures actor/mapper, recomputes physicalScale for VR.
 * @param {number} meshNumber
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

        // Re-add actor if clearScene() removed it
        if (!renderer.getActors().includes(actor)) {
            renderer.addActor(actor);
        }

        renderer.resetCamera();
        renderWindow.render();

        // Recompute physicalScale so VR scale is always correct for this mesh.
        // Must happen before the user enters XR, not during.
        const scale = computePhysicalScale(actor);
        console.log(`[CEMRG] physicalScale for VR: ${scale.toFixed(1)} VTK units/m`);
        try {
            fullScreenRenderer.getApiSpecificRenderWindow().setPhysicalScale(scale);
        } catch (e) {
            console.warn('[CEMRG] setPhysicalScale unavailable on this vtk.js build:', e.message);
        }

        // Sync manipulators with (potentially new) actor reference
        if (rotationManipulator) rotationManipulator.setActor(actor);
        if (scaleManipulator) scaleManipulator.setActor(actor);
    });
}

// ---------------------------------------------------------------------------
// VR manipulator setup
// ---------------------------------------------------------------------------

/** @type {VRRotationManipulator|null} */
let rotationManipulator = null;
/** @type {VRScaleManipulator|null}    */
let scaleManipulator = null;

/**
 * Registers custom manipulators with the XR interactor.
 * Must be called AFTER XRHelper.startXR() resolves; the XR interactor
 * style does not exist until the session is active.
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
// Pulse animation (~72 bpm, +/-4% scale, requestAnimationFrame based)
// ---------------------------------------------------------------------------

let pulseAnimationId = null;
let pulseBaseScale = 1.0;
const PULSE_FREQUENCY = 1.2;   // Hz (72 bpm)
const PULSE_AMPLITUDE = 0.04;  // +/-4% of current scale

/** @param {DOMHighResTimeStamp} timestamp */
function animatePulse(timestamp) {
    const t = timestamp / 1000;
    const oscillation = Math.sin(2 * Math.PI * PULSE_FREQUENCY * t);
    const s = pulseBaseScale * (1.0 + PULSE_AMPLITUDE * oscillation);
    actor.setScale(s, s, s);
    renderWindow.render();
    pulseAnimationId = requestAnimationFrame(animatePulse);
}

function startPulse() {
    if (pulseAnimationId !== null) return;
    pulseBaseScale = actor.getScale()[0];
    pulseAnimationId = requestAnimationFrame(animatePulse);
}

function stopPulse() {
    if (pulseAnimationId === null) return;
    cancelAnimationFrame(pulseAnimationId);
    pulseAnimationId = null;
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
const opacitySlider = document.querySelector('.opacity');
const pulseButton = document.querySelector('.pulsebutton');

// Representation (points / wireframe / surface)
representationSel.addEventListener('change', (e) => {
    actor.getProperty().setRepresentation(Number(e.target.value));
    renderWindow.render();
});

// Opacity slider (1-10 -> 0.1-1.0)
// Bug fix: original was labelled 'resolution' but controlled setOpacity.
opacitySlider.addEventListener('input', (e) => {
    actor.getProperty().setOpacity(Number(e.target.value) / 10);
    renderWindow.render();
});

// Mesh selector
loadMeshSelector.addEventListener('change', (e) => {
    const meshNumber = Number(e.target.value);
    console.log(`[CEMRG] Switching to mesh: ${e.target.options[e.target.selectedIndex].text}`);

    const wasAnimating = pulseAnimationId !== null;
    stopPulse();
    clearScene(renderer, renderWindow);
    processData(meshNumber);
    if (wasAnimating) startPulse();
});

// Pulse toggle button
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

// VR button
//
// Bug fixes vs original:
//   1. xrSession was never assigned; exit path called .end() on null.
//      Fix: use a boolean + XRHelper.stopXR().
//   2. setupVRManipulators() was commented out. Now called post-session-start.
//   3. Overlay mode is switched so the HUD shows the correct control bindings.
//   4. Pulse is paused on XR entry.
//
// Note on reference space:
//   vtk.js HmdVR internally requests 'local-floor', which shifts the world
//   origin to the floor -- awkward for seated users (heart appears at shin height).
//   The correct space for seated is 'local'. Expose XRHelper.setReferenceSpaceType()
//   once it lands in the vtk.js public API. Tracked upstream.

let vrIsActive = false;

vrButton.addEventListener('click', async () => {
    if (!vrIsActive) {
        console.log('[CEMRG] Requesting XR session...');

        stopPulse();
        if (pulseButton) pulseButton.textContent = 'Start Pulse';

        try {
            await XRHelper.startXR(XrSessionTypes.HmdVR);
            vrIsActive = true;
            vrButton.textContent = 'Return From VR';

            setupVRManipulators();

            // Switch overlay to VR bindings
            setOverlayMode('vr');

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

        // Restore desktop bindings in overlay
        setOverlayMode('desktop');
    }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Inject the controls HUD panel (DOM overlay, bottom-right corner, collapsible)
createControlsOverlay();

// Load the first mesh
processData(0);

// ---------------------------------------------------------------------------
// Developer console access
// ---------------------------------------------------------------------------
global.actor = actor;
global.mapper = mapper;
global.renderer = renderer;
global.renderWindow = renderWindow;
global.XRHelper = XRHelper;
global.startPulse = startPulse;
global.stopPulse = stopPulse;