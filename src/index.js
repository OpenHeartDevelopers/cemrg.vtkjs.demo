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
    background: [0.5, 0.5, 0.5],
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
console.log('Loading data...');

loadData('./data/data_coarse_scaled.vtk').then((polydata) => {
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
                lut.setNumberOfValues(range[1] - range[0] + 1 );
    
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
    
    const light = vtkLight.newInstance();
    light.setPosition(1, 1, 1);
    light.setFocalPoint(0, 0, 0);
    light.setIntensity(0.4);
    renderer.addLight(light);

    const light2 = vtkLight.newInstance();
    light2.setPosition(-1, -1, -1);
    light2.setFocalPoint(0, 0, 0);
    light2.setIntensity(0.6);
    renderer.addLight(light2);

    renderWindow.render();

}).catch((error) => {
    console.error('Error loading data:', error);
});

// -----------------------------------------------------------
// UI control handling
// -----------------------------------------------------------

fullScreenRenderer.addController(controlPanel);
const representationSelector = document.querySelector('.representations');
const resolutionChange = document.querySelector('.resolution');
const vrbutton = document.querySelector('.vrbutton');

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

vrbutton.addEventListener('click', (e) => {
    if (vrbutton.textContent === 'Send To VR') {
        XRHelper.startXR(XrSessionTypes.HmdVR);
        vrbutton.textContent = 'Return From VR';
    } else {
        XRHelper.stopXR();
        vrbutton.textContent = 'Send To VR';
    }
});

// -----------------------------------------------------------
// Make some variables global so that you can inspect and
// modify objects in your browser's developer console:
// -----------------------------------------------------------

global.source = currentSource;
global.mapper = mapper;
global.actor = actor;
global.renderer = renderer;
global.renderWindow = renderWindow;