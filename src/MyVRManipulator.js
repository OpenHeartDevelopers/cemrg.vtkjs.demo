/**
 * MyVRManipulator.js
 *
 * Exports two VR manipulators for a seated-user experience.
 * Core design principle: the CAMERA is fixed. The ACTOR moves.
 * This avoids the nausea/disorientation of moving the viewpoint
 * and is the correct model for a seated clinical demo.
 *
 * Bindings:
 *   VRRotationManipulator  -- Right Controller + Trigger held + move hand
 *                             Horizontal delta  -> Y-axis rotation (yaw)
 *                             Vertical delta    -> X-axis rotation (pitch)
 *
 *   VRScaleManipulator     -- Right Controller + Thumbstick/TrackPad
 *                             Push stick forward  -> scale up
 *                             Pull stick backward -> scale down
 *
 * Both manipulators receive a reference to the scene actor via setActor()
 * after construction. See index.js :: setupVRManipulators().
 */

import vtkCompositeVRManipulator from '@kitware/vtk.js/Interaction/Manipulators/CompositeVRManipulator';
import { Device, Input } from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor/Constants';

// ---------------------------------------------------------------------------
// VRRotationManipulator
// ---------------------------------------------------------------------------

/**
 * Rotates the actor around its bounding-box centroid.
 *
 * Why centroid and not origin?
 * Cardiac meshes are not centred at (0,0,0) in VTK world space.
 * Rotating around the origin would produce an unpleasant orbital swing.
 * Using the actor's own centre keeps the model stationary while spinning.
 */
const VRRotationManipulator = vtkCompositeVRManipulator.extend({

    /**
     * @param {Device}  device  - Controller to bind (default: right)
     * @param {Input}   input   - Input type to bind (default: Trigger)
     */
    initialize(
        device = Device.RightController,
        input = Input.Trigger,
    ) {
        this.set({ device, input });
        /** @type {number[]|null} Previous controller position in XR space (metres) */
        this.previousPosition = null;
        /** @type {vtkActor|null} The actor to rotate */
        this.targetActor = null;
    },

    /**
     * Accepts the VTK actor to be manipulated.
     * Called from index.js after the first mesh is loaded.
     * @param {vtkActor} actor
     */
    setActor(actor) {
        this.targetActor = actor;
    },

    /**
     * Called on controller button press/release.
     * We use this to flush previousPosition so there is no
     * discontinuous jump when the trigger is released and re-pressed.
     */
    onButton3D(/* interactorStyle, renderer, state, eventData */) {
        this.previousPosition = null;
    },

    /**
     * Called every frame while the trigger is held and the controller moves.
     * @param {object} interactorStyle
     * @param {object} renderer
     * @param {object} state
     * @param {object} eventData  - { position: number[], device: Device, ... }
     */
    onMove3D(interactorStyle, renderer, state, eventData) {
        const { position, device } = eventData;

        // Guard: only respond to the bound controller
        if (device !== this.device) return;
        if (!this.targetActor) return;

        // On the first frame, seed the tracker and exit to avoid a spike
        if (!this.previousPosition) {
            this.previousPosition = [...position];
            return;
        }

        // Compute controller displacement in XR metres
        const delta = [
            position[0] - this.previousPosition[0], // X: left/right
            position[1] - this.previousPosition[1], // Y: up/down
            position[2] - this.previousPosition[2], // Z: forward/back
        ];
        this.previousPosition = [...position];

        // Convert metres of hand movement to degrees of actor rotation.
        // 150 deg/m is empirically comfortable at arm's rest distance.
        // Lower this value for a more sluggish feel, raise for snappier.
        const ROTATION_DEG_PER_METRE = 150.0;
        const deltaYaw = delta[0] * ROTATION_DEG_PER_METRE; // horizontal -> yaw
        const deltaPitch = delta[1] * ROTATION_DEG_PER_METRE; // vertical   -> pitch

        // vtk.js actor orientation is Euler angles [X, Y, Z] in degrees.
        // We accumulate on the existing orientation to avoid resetting prior rotations.
        const [ox, oy, oz] = this.targetActor.getOrientation();
        this.targetActor.setOrientation(ox + deltaPitch, oy + deltaYaw, oz);

        interactorStyle.render();
    },
});

// ---------------------------------------------------------------------------
// VRScaleManipulator
// ---------------------------------------------------------------------------

/**
 * Scales the actor uniformly using the thumbstick Y-axis (or trackpad Y).
 *
 * Why Z-axis of controller position is NOT used for scale:
 * Physical forward/backward arm motion in a seated position is limited
 * and awkward. The thumbstick provides a natural, ergonomic analogue.
 * The manipulator receives axis values in eventData.position for
 * trackpad/thumbstick inputs.
 */
const VRScaleManipulator = vtkCompositeVRManipulator.extend({

    /**
     * @param {Device} device  - Controller to bind (default: right)
     * @param {Input}  input   - Input type to bind (default: TrackPad / Thumbstick)
     */
    initialize(
        device = Device.RightController,
        input = Input.TrackPad, // Maps to thumbstick on modern 6DOF headsets
    ) {
        this.set({ device, input });
        this.previousAxisY = null;
        this.targetActor = null;
        this.currentScale = 1.0;

        // Scale clamping: prevents the model being lost at 0 or at galaxy size
        this.MIN_SCALE = 0.1;
        this.MAX_SCALE = 8.0;
    },

    /**
     * @param {vtkActor} actor
     */
    setActor(actor) {
        this.targetActor = actor;
        // Capture whatever scale the actor already has so we don't reset it
        this.currentScale = actor.getScale()[0]; // Assumes uniform scale
    },

    onButton3D(/* interactorStyle, renderer, state, eventData */) {
        this.previousAxisY = null;
    },

    /**
     * For TrackPad/Thumbstick inputs, eventData.position carries axis values
     * in the range [-1, 1], NOT a 3D world position.
     * Y-axis: +1 is thumbstick pushed forward (up on stick), -1 is back.
     * We invert so pushing forward makes the model bigger (intuitive).
     */
    onMove3D(interactorStyle, renderer, state, eventData) {
        const { position, device } = eventData;

        if (device !== this.device) return;
        if (!this.targetActor) return;

        // position[1] is the thumbstick Y axis value in [-1, 1]
        const axisY = position[1];

        if (this.previousAxisY === null) {
            this.previousAxisY = axisY;
            return;
        }

        const deltaAxis = axisY - this.previousAxisY;
        this.previousAxisY = axisY;

        // 0.02 scale change per unit axis delta feels responsive without being jerky.
        // Negative sign: pushing stick forward (+Y) -> scale up.
        const SCALE_SENSITIVITY = 0.02;
        this.currentScale = Math.min(
            this.MAX_SCALE,
            Math.max(this.MIN_SCALE, this.currentScale - deltaAxis * SCALE_SENSITIVITY),
        );

        this.targetActor.setScale(
            this.currentScale,
            this.currentScale,
            this.currentScale,
        );

        interactorStyle.render();
    },
});

export { VRRotationManipulator, VRScaleManipulator };