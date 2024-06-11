// loadData.js
import vtkPolyDataReader from '@kitware/vtk.js/IO/Legacy/PolyDataReader';

export default function loadData(url) {
    console.log('Starting to load data from:', url); // Log when data loading starts

    const reader = vtkPolyDataReader.newInstance();
    return reader.setUrl(url).then(() => {
        console.log('Finished loading data from:', url); // Log when data loading finishes

        const outputData = reader.getOutputData(0); 
        if (!outputData) {
            throw new Error('Error loading data');
        }
        return outputData;
    });
}

export function loadDataFromNumber(meshNumber) {
    let url;
    console.log('Loading data from number:', meshNumber);
    switch (meshNumber) {
        case 0:
            url = './data/healthy.vtk';
            break;
        case 1:
            url = './data/afib.vtk';
            break;
        case 2:
            url = './data/hr.vtk';
            break;
        default:
            console.log('Invalid mesh number');
            url = 'data/data_coarse_scaled.vtk';
    }

    return loadData(url);
}