import '@kitware/vtk.js/favicon';

// Load the rendering pieces we want to use (for both WebGL and WebGPU)
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';

import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkWebXRRenderWindowHelper from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';

import { AttributeTypes } from '@kitware/vtk.js/Common/DataModel/DataSetAttributes/Constants';
import { FieldDataTypes } from '@kitware/vtk.js/Common/DataModel/DataSet/Constants';
import { XrSessionTypes } from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper/Constants';

// Force DataAccessHelper to have access to various data source
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HtmlDataAccessHelper';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HttpDataAccessHelper';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/JSZipDataAccessHelper';

import vtkResourceLoader from '@kitware/vtk.js/IO/Core/ResourceLoader';

import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';

// Custom UI controls, including button to start XR session
import controlPanel from './controller.html';
import loadData from './loadData';
import { loadDataFromNumber } from './loadData.js';
import generateCone from './generateData';

// Dynamically load WebXR polyfill from CDN for WebVR and Cardboard API backwards compatibility
if (navigator.xr === undefined) {
    vtkResourceLoader
        .loadScript(
            'https://cdn.jsdelivr.net/npm/webxr-polyfill@latest/build/webxr-polyfill.js'
        )
        .then(() => {
            // eslint-disable-next-line no-new, no-undef
            new WebXRPolyfill();
        });
}

// ----------------------------------------------------------------------------
// Standard rendering code setup
// ----------------------------------------------------------------------------

const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
    background: [0.0, 0.0, 0.0],
});
const renderer = fullScreenRenderer.getRenderer();
const renderWindow = fullScreenRenderer.getRenderWindow();
const XRHelper = vtkWebXRRenderWindowHelper.newInstance({
    renderWindow: fullScreenRenderer.getApiSpecificRenderWindow(),
});

const mapper = vtkMapper.newInstance();
const actor = vtkActor.newInstance();

// ----------------------------------------------------------------------------
// Example code
// ----------------------------------------------------------------------------
// create a filter on the fly, sort of cool, this is a random scalars
// filter we create inline, for a simple cone you would not need
// this
// ----------------------------------------------------------------------------

let currentSource = null;

function clearScene(renderer, renderWindow) {
    // Get all actors from the renderer
    const actors = renderer.getActors();

    // Remove each actor from the renderer
    actors.forEach((actor) => {
        renderer.removeActor(actor);
    });

    // Reset the camera
    renderer.resetCamera();

    // Render the scene
    renderWindow.render();
}

// Function to load and process data
function processData(meshNumber, addLight = true) {
    console.log('Loading data...');

    loadDataFromNumber(meshNumber).then((polydata) => {
        console.log('Loaded data:', polydata);
        currentSource = polydata;

        let pdLoaded = true;
        let zPosition = -20.0;
        if (currentSource === null) {
            currentSource = generateCone();
            pdLoaded = false;
            zPosition = -20.0;
        }

        if (pdLoaded) {
            mapper.setInputData(currentSource);

            const cellData = currentSource.getCellData();
            const numberOfArrays = cellData.getNumberOfArrays();
            console.log('Number of cell data arrays:', numberOfArrays);

            if (numberOfArrays > 0) {
                const arrayName = cellData.getArrayName(0);
                console.log('Array name:', arrayName);

                cellData.setActiveScalars(arrayName);

                const scalars = cellData.getScalars(arrayName);
                if (scalars) {
                    const range = scalars.getRange();

                    console.log('Range:', range);

                    const lut = vtkColorTransferFunction.newInstance();
                    lut.setRange(range[0], range[1]);
                    lut.addRGBPoint(range[0], 0.5, 0.0, 0.0);
                    // lut.addRGBPoint((range[0] + range[1]) / 2.0, 0.0, 0.8, 0.0);
                    lut.addRGBPoint(range[1], 0.1, 0.0, 1.0);

                    lut.setDiscretize(true);
                    lut.setNumberOfValues(range[1] - range[0] + 1);

                    mapper.setLookupTable(lut);
                    mapper.setScalarRange(range[0], range[1]);
                } else {
                    console.log('No active scalar array in the cell data.');

                    const pointData = currentSource.getPointData();
                    console.log('Number of point data arrays:', pointData.getNumberOfArrays());
                }
            }
        } else {
            mapper.setInputConnection(currentSource);
        }

        actor.setMapper(mapper);
        actor.setPosition(0.0, 0.0, zPosition);
        actor.getProperty().setSpecular(0.75);      // Set the specular coefficient [0, 1]
        actor.getProperty().setSpecularPower(20); // Set the specular power

        renderer.addActor(actor);
        renderer.resetCamera();

        if (addLight) { 
            const light = vtkLight.newInstance();
            light.setPosition(1, 1, 1);
            light.setFocalPoint(0, 0, 0);
            light.setIntensity(0.5);
            renderer.addLight(light);
    
            const light2 = vtkLight.newInstance();
            light2.setPosition(-1, -1, -1);
            light2.setFocalPoint(0, 0, 0);
            light2.setIntensity(0.7);
            renderer.addLight(light2);

            const light3 = vtkLight.newInstance();
            light2.setPosition(0, -1, -1);
            light2.setFocalPoint(0, 0, 0);
            light2.setIntensity(0.9);
            renderer.addLight(light3);
        }

        renderWindow.render();
    });
}

console.log("Initially load the first mesh")
processData(0, true);


// -----------------------------------------------------------
// UI control handling
// -----------------------------------------------------------

fullScreenRenderer.addController(controlPanel);
const representationSelector = document.querySelector('.representations');
const resolutionChange = document.querySelector('.resolution');
const vrbutton = document.querySelector('.vrbutton');
const loadMeshSelector = document.querySelector('.meshes');

representationSelector.addEventListener('change', (e) => {
    const newRepValue = Number(e.target.value);
    actor.getProperty().setRepresentation(newRepValue);
    renderWindow.render();
    });

resolutionChange.addEventListener('input', (e) => {
    const opacity = Number(e.target.value);
    actor.getProperty().setOpacity(opacity/10);
    renderWindow.render();
});

let xrSession = null;

function onSqueezeStart(event) {
    console.log('Squeeze start');
    alert('Squeeze start');
}

function onSqueezeEnd(event) {
    console.log('Squeeze end');
    alert('Squeeze end');
}

function onSelectStart(event) {
    console.log('Select start');
    alert('Select start');
}

function onSelectEnd(event) {
    console.log('Select end');
    alert('Select end');
}

// This function creates a line from the target ray
function createPointer(inputSource) {
    // Get the target ray
    const targetRay = inputSource.targetRaySpace;

    // Create a new line geometry
    const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), // Start at the origin
        new THREE.Vector3(0, 0, -1) // End one unit in the -Z direction
    ]);

    // Create a new line material
    const material = new THREE.LineBasicMaterial({ color: 0xff0000 });

    // Create a new line
    const line = new THREE.Line(geometry, material);

    // Set the line's matrix to the target ray's matrix
    line.matrix.fromArray(targetRay.matrix);

    // Update the line's matrix world
    line.updateMatrixWorld(true);

    return line;
}

vrbutton.addEventListener('click', async (e) => {
    if (vrbutton.textContent === 'Send To VR') {
        console.log('Requesting XR session...');
        // Request a new WebXR session
        // xrSession = await navigator.xr.requestSession('immersive-vr', {
        //     optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        // });

        // console.log(xrSession.inputSources); // Add this line
        // for (let inputSource of xrSession.inputSources) {
        //     console.log(inputSource);
        //     if (inputSource.targetRayMode === 'tracked-pointer') {
        //         // This is a controller
        //         const pointer = createPointer(inputSource);
        //         scene.add(pointer);
        //     }

        //     if (inputSource.gamepad) {
        //         // This is a gamepad input source
        //         inputSource.addEventListener('squeezestart', onSqueezeStart);
        //         inputSource.addEventListener('squeezeend', onSqueezeEnd);
        //         inputSource.addEventListener('selectstart', onSelectStart);
        //         inputSource.addEventListener('selectend', onSelectEnd);
        //     }
        // }

        // xrSession.addEventListener('inputsourceschange', event => { 
        //     for (let inputSource of event.removed) {
        //         if (inputSource.gamepad) {
        //             // This is a gamepad input source
        //             inputSource.removeEventListener('squeezestart', onSqueezeStart);
        //             inputSource.removeEventListener('squeezeend', onSqueezeEnd);
        //             inputSource.removeEventListener('selectstart', onSelectStart);
        //             inputSource.removeEventListener('selectend', onSelectEnd);
        //         }
        //     }
        // });

        // // Start the session
        // XRHelper.startXR(xrSession);
        
        XRHelper.startXR(XrSessionTypes.HmdVR);

        vrbutton.textContent = 'Return From VR';
    } else {
        // End the session
        XRHelper.stopXR();
        xrSession = null;

        vrbutton.textContent = 'Send To VR';
    }
});

// This function starts the WebXR session
async function startXR() {
    // Request a new WebXR session
    xrSession = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
    });

    // Set the renderer's XR session
    renderer.xr.setSession(xrSession);

    // Set up the render loop
    xrSession.requestAnimationFrame(render);
}

// This function renders a frame
function render(time, xrFrame) {
    // Request the next animation frame
    xrSession.requestAnimationFrame(render);

    // Get the pose of the viewer
    const pose = xrFrame.getViewerPose(xrReferenceSpace);

    // If the pose is not null, render the scene
    if (pose) {
        // Get the WebGL layer
        const layer = xrSession.renderState.baseLayer;

        // Set the WebGL context's framebuffer
        renderer.context.bindFramebuffer(renderer.context.FRAMEBUFFER, layer.framebuffer);

        // Clear the canvas
        renderer.clear();

        // Render the scene for each view
        for (let view of pose.views) {
            // Get the viewport for the view
            const viewport = layer.getViewport(view);

            // Set the renderer's viewport
            renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);

            // Render the scene
            renderer.render(scene, camera);
        }
    }
}
    
// Listen for changes to the 'meshes' select element and load the selected mesh
loadMeshSelector.addEventListener('change', function (event) {
    const meshNumber = Number(event.target.value);
    const meshName = event.target.options[event.target.selectedIndex].text;
    console.log('Loading mesh:', meshNumber, meshName);
        clearScene(renderer, renderWindow);
        processData(meshNumber, false);
    });
window.onload = function () {
    let message = ` Thank you for visiting the CEMRG website.
    
    To view this in VR, you need to have the WebXR Emulator extension installed in your browser.
    Look for it on the Extension store in your browser or use the link provided. 
    
    Once installed, click on the VR button below to view the model in VR.
    
    Enjoy! `
    alert(message);
};

// -----------------------------------------------------------
// Make some variables global so that you can inspect and
// modify objects in your browser's developer console:
// -----------------------------------------------------------

global.source = currentSource;
global.mapper = mapper;
global.actor = actor;
global.renderer = renderer;
global.renderWindow = renderWindow;