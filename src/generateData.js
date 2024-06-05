// generateCone.js
import vtkConeSource from '@kitware/vtk.js/Filters/Sources/ConeSource';
import vtkCalculator from '@kitware/vtk.js/Filters/General/Calculator';

export default function generateCone() {
    const coneSource = vtkConeSource.newInstance({ height: 100.0, radius: 50 });
    const filter = vtkCalculator.newInstance();

    filter.setInputConnection(coneSource.getOutputPort());
    // filter.setFormulaSimple(FieldDataTypes.CELL, [], 'random', () => Math.random());
    filter.setFormula({
        getArrays: (inputDataSets) => ({
            input: [],
            output: [
                {
                    location: FieldDataTypes.CELL,
                    name: 'Random',
                    dataType: 'Float32Array',
                    attribute: AttributeTypes.SCALARS,
                },
            ],
        }),
        evaluate: (arraysIn, arraysOut) => {
            const [scalars] = arraysOut.map((d) => d.getData());
            for (let i = 0; i < scalars.length; i++) {
                scalars[i] = Math.random();
            }
        },
    });

    return filter.getOutputPort();
}