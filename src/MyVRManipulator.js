import vtkCompositeVRManipulator from '@kitware/vtk.js/Interaction/Manipulators/CompositeVRManipulator';
import { Device, Input } from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor/Constants';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';

const MyVRManipulator = vtkCompositeVRManipulator.extend({
    initialize(device = Device.RightController, input = Input.TrackPad) {
        this.set({ device, input });
        this.previousPosition = null;
    },

    onButton3D(interactorStyle, renderer, state, eventData) {
        // Implement your button logic here, if any
        console.log('Button event', eventData);
    },

    onMove3D(interactorStyle, renderer, state, eventData) {
        const { position, direction, device } = eventData;

        if (!this.previousPosition) {
            this.previousPosition = position.slice();
            return;
        }

        // Compute the difference in positions
        const deltaPosition = [
            position[0] - this.previousPosition[0],
            position[1] - this.previousPosition[1],
            position[2] - this.previousPosition[2]
        ];

        // Reset previous position
        this.previousPosition = position.slice();

        // Check if the controller is the one we are tracking
        if (device !== this.device) {
            return;
        }

        // Perform translation or zoom based on the input type
        if (this.input === Input.TrackPad) {
            this.handleTrackPadMovement(interactorStyle, renderer, deltaPosition);
        } else if (this.input === Input.Trigger) {
            this.handleTriggerMovement(interactorStyle, renderer, deltaPosition);
        }
    },

    handleTrackPadMovement(interactorStyle, renderer, deltaPosition) {
        // Handle pan (translation)
        const camera = renderer.getActiveCamera();
        const focalPoint = camera.getFocalPoint();
        const position = camera.getPosition();

        // Translate both the camera position and focal point
        vtkMatrixBuilder
            .buildFromRadian()
            .translate(deltaPosition)
            .apply(position);

        vtkMatrixBuilder
            .buildFromRadian()
            .translate(deltaPosition)
            .apply(focalPoint);

        camera.setPosition(...position);
        camera.setFocalPoint(...focalPoint);
        interactorStyle.render();
    },

    handleTriggerMovement(interactorStyle, renderer, deltaPosition) {
        // Handle zoom (dolly)
        const camera = renderer.getActiveCamera();
        const direction = camera.getDirectionOfProjection();

        // Calculate the dolly amount based on the Z-axis movement of the controller
        const dollyAmount = deltaPosition[2] * 0.1; // Adjust multiplier as needed
        const distance = vtkMath.norm(direction) * dollyAmount;

        // Dolly the camera
        camera.dolly(1.0 + distance);
        interactorStyle.render();
    }
});

export default MyVRManipulator;