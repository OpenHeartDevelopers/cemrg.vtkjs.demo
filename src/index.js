import '@kitware/vtk.js/favicon';

// Load the rendering pieces we want to use (for both WebGL and WebGPU)
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkWebXRRenderWindowHelper from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkCompositeVRManipulator from '@kitware/vtk.js/Interaction/Manipulators/CompositeVRManipulator.js';

import { AttributeTypes } from '@kitware/vtk.js/Common/DataModel/DataSetAttributes/Constants';
import { FieldDataTypes } from '@kitware/vtk.js/Common/DataModel/DataSet/Constants';
import { XrSessionTypes } from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper/Constants';

// Force DataAccessHelper to have access to various data source
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HtmlDataAccessHelper';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HttpDataAccessHelper';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/JSZipDataAccessHelper';

import vtkResourceLoader from '@kitware/vtk.js/IO/Core/ResourceLoader';


import vtkLight from '@kitware/vtk.js/Rendering/Core/Light.js';
// import MyVRManipulator from './MyVRManipulator.js';
import controlPanel from './controller.html';
// import loadData from './loadData';
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

// Standard rendering code setup
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

// Clear the scene
function clearScene(renderer, renderWindow) {
    const actors = renderer.getActors();
    actors.forEach((actor) => {
        renderer.removeActor(actor);
    });
    renderer.resetCamera();
    renderWindow.render();
}

// Load and process data
let currentSource = null;

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
        actor.getProperty().setSpecular(0.75);
        actor.getProperty().setSpecularPower(20);

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
            light3.setPosition(0, -1, -1);
            light3.setFocalPoint(0, 0, 0);
            light3.setIntensity(0.9);
            renderer.addLight(light3);
        }

        renderWindow.render();
    });
}

console.log("Initially load the first mesh")
processData(0, true);

// UI control handling
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
    actor.getProperty().setOpacity(opacity / 10);
    renderWindow.render();
});

let xrSession = null;

vrbutton.addEventListener('click', async (e) => {
    if (vrbutton.textContent === 'Send To VR') {
        console.log('Requesting XR session...');
        await XRHelper.startXR(XrSessionTypes.HmdVR);
        // setupVRManipulators(renderer, renderWindow);
        vrbutton.textContent = 'Return From VR';
    } else {
        if (xrSession) {
            await xrSession.end();
            xrSession = null;
        }
        vrbutton.textContent = 'Send To VR';
    }
});

function setupVRManipulators(renderer, renderWindow) {
    const interactor = renderWindow.getInteractor();
    const vrManipulator = MyVRManipulator.newInstance();
    interactor.addVRManipulator(vrManipulator);
    renderer.resetCamera();
    renderWindow.render();
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
    
    Enjoy! `;
    alert(message);
};

// Make some variables global so that you can inspect and
// modify objects in your browser's developer console:
global.source = currentSource;
global.mapper = mapper;
global.actor = actor;
global.renderer = renderer;
global.renderWindow = renderWindow;
