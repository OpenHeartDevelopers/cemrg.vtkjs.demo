/**
 * MyVRManipulator.js
 *
 * Two VR manipulators following the vtk.js 30.x macro factory pattern.
 *
 * The pattern:
 *   1. Write a function myThing(publicAPI, model) that attaches methods.
 *   2. Write an extend(publicAPI, model, initialValues) that chains:
 *        - Object.assign for defaults
 *        - the base compositeVRExtend() to register device/input getters
 *        - your own myThing() to attach overridden methods
 *   3. Export newInstance = newInstance(extend, 'ClassName')
 *
 * Why not vtkCompositeVRManipulator.extend({...methods...})?
 *   In vtk.js 30.x, extend(publicAPI, model, initialValues) is a plain
 *   builder function, NOT an inheritance helper. Passing method definitions
 *   as the first argument sends them into Object.assign(model, ...) which
 *   receives undefined and throws immediately.
 *
 * Seated-user interaction model:
 *   Camera is FIXED. The actor is the only thing that moves.
 *
 *   VRRotationManipulator  Right Controller + Trigger held + move hand
 *                          Horizontal delta -> Y-axis rotation (yaw)
 *                          Vertical delta   -> X-axis rotation (pitch)
 *
 *   VRScaleManipulator     Right Controller + Thumbstick Y-axis
 *                          Push forward -> scale up
 *                          Pull back    -> scale down
 */

// macro.js is the stable public entry point -- do NOT use macros2.js whose exports
// are minified single letters (m=macro object, n=newInstance, etc.).
// Device and Input must come from their own Constants file, not CompositeVRManipulator.

import { n as newInstance, o as obj } from '@kitware/vtk.js/macros2.js';

import { extend as compositeVRExtend } from '@kitware/vtk.js/Interaction/Manipulators/CompositeVRManipulator.js';
import { Device, Input } from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor/Constants.js';

// ---------------------------------------------------------------------------
// VRRotationManipulator
// ---------------------------------------------------------------------------

/**
 * Attaches rotation behaviour to the publicAPI.
 * Rotates the target actor around its bounding-box centroid.
 *
 * Why centroid?
 * Cardiac meshes are not centred at (0,0,0). Rotating around the world
 * origin produces an orbital swing. Centroid keeps the model in place.
 *
 * @param {object} publicAPI
 * @param {object} model
 */
function vtkVRRotationManipulator(publicAPI, model) {
    model.classHierarchy.push('vtkVRRotationManipulator');

    /** Flush delta accumulator on button press/release to avoid a position spike. */
    publicAPI.onButton3D = () => {
        model.previousPosition = null;
    };

    /**
     * Called every frame while the trigger is held and the controller moves.
     * @param {object} interactorStyle
     * @param {object} _renderer   - unused (actor reference held on model)
     * @param {object} _state      - unused
     * @param {object} eventData   - { position: number[], device: Device }
     */
    publicAPI.onMove3D = (interactorStyle, _renderer, _state, eventData) => {
        const { position, device } = eventData;

        if (device !== model.device) return;
        if (!model.targetActor) return;

        // Seed the tracker on the first frame; no movement to apply yet.
        if (!model.previousPosition) {
            model.previousPosition = [...position];
            return;
        }

        // Controller displacement in XR metres
        const delta = [
            position[0] - model.previousPosition[0],
            position[1] - model.previousPosition[1],
        ];
        model.previousPosition = [...position];

        // 150 deg/m: empirically comfortable at arm's rest distance.
        const DEG_PER_METRE = 150.0;
        const deltaYaw = delta[0] * DEG_PER_METRE;
        const deltaPitch = delta[1] * DEG_PER_METRE;

        const [ox, oy, oz] = model.targetActor.getOrientation();
        model.targetActor.setOrientation(ox + deltaPitch, oy + deltaYaw, oz);

        interactorStyle.render();
    };

    /**
     * Accepts the VTK actor to be rotated.
     * Called from index.js after each mesh load.
     * @param {vtkActor} actor
     */
    publicAPI.setActor = (actor) => {
        model.targetActor = actor;
    };
}

/**
 * vtk.js macro factory function for VRRotationManipulator.
 * @param {object} publicAPI
 * @param {object} model
 * @param {object} initialValues
 */
function extendRotation(publicAPI, model, initialValues = {}) {
    const defaults = {
        device: Device.RightController,
        input: Input.Trigger,
        previousPosition: null,
        targetActor: null,
    };

    Object.assign(model, defaults, initialValues);
    obj(publicAPI, model);

    // Chain the base composite manipulator (registers device/input getters)
    compositeVRExtend(publicAPI, model);

    // Attach our overridden methods
    vtkVRRotationManipulator(publicAPI, model);
}

const VRRotationManipulator = {
    newInstance: newInstance(extendRotation, 'vtkVRRotationManipulator'),
    extend: extendRotation,
};

// ---------------------------------------------------------------------------
// VRScaleManipulator
// ---------------------------------------------------------------------------

/**
 * Attaches scale behaviour to the publicAPI.
 * Uses thumbstick Y-axis rather than arm extension because forward/back arm
 * movement in a seated position is awkward and limited.
 *
 * @param {object} publicAPI
 * @param {object} model
 */
function vtkVRScaleManipulator(publicAPI, model) {
    model.classHierarchy.push('vtkVRScaleManipulator');

    publicAPI.onButton3D = () => {
        model.previousAxisY = null;
    };

    /**
     * For TrackPad/Thumbstick inputs, eventData.position carries axis values
     * in [-1, 1], NOT a 3D world position.
     * Y-axis: +1 = stick forward, -1 = stick back.
     */
    publicAPI.onMove3D = (interactorStyle, _renderer, _state, eventData) => {
        const { position, device } = eventData;

        if (device !== model.device) return;
        if (!model.targetActor) return;

        const axisY = position[1];

        if (model.previousAxisY === null) {
            model.previousAxisY = axisY;
            return;
        }

        const deltaAxis = axisY - model.previousAxisY;
        model.previousAxisY = axisY;

        // 0.02 scale change per unit axis delta; clamped to [MIN, MAX].
        const SENSITIVITY = 0.02;
        model.currentScale = Math.min(
            model.maxScale,
            Math.max(model.minScale, model.currentScale - deltaAxis * SENSITIVITY),
        );

        const s = model.currentScale;
        model.targetActor.setScale(s, s, s);
        interactorStyle.render();
    };

    publicAPI.setActor = (actor) => {
        model.targetActor = actor;
        model.currentScale = actor.getScale()[0]; // Preserve any existing scale
    };
}

/**
 * vtk.js macro factory function for VRScaleManipulator.
 * @param {object} publicAPI
 * @param {object} model
 * @param {object} initialValues
 */
function extendScale(publicAPI, model, initialValues = {}) {
    const defaults = {
        device: Device.RightController,
        input: Input.TrackPad,  // Maps to thumbstick on modern 6DOF headsets
        previousAxisY: null,
        targetActor: null,
        currentScale: 1.0,
        minScale: 0.1,
        maxScale: 8.0,
    };

    Object.assign(model, defaults, initialValues);
    obj(publicAPI, model);           

    compositeVRExtend(publicAPI, model);
    vtkVRScaleManipulator(publicAPI, model);
}

const VRScaleManipulator = {
    newInstance: newInstance(extendScale, 'vtkVRScaleManipulator'),
    extend: extendScale,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export { VRRotationManipulator, VRScaleManipulator };