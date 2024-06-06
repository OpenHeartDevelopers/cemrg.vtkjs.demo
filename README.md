# README

Install the necessary dependencies:
```shell
npm install @kitware/vtk.js http-server
```

Install dev-only packs: 
```shell
npm install --save-dev webpack webpack-cli html-loader
```

Run the build script `npm run build`

Create an index.html file in the dist directory and include the main.js script.

# Running the Project Locally
To run your project locally, you can use http-server, a simple static server. Here's how you can install it and use it to serve your project:

Install http-server
```shell
npm install http-server
cd dist
npx http-server
```

Navigate to your dist directory and start the server:
By default, this will start a server on http://localhost:8080. You can then open this URL in your web browser to see your project.

## Viewing Scenes with WebXR

vtk.js supports virtual reality rendering via the [WebXR device API](https://www.w3.org/TR/webxr/) for most standalone and PC headsets.

Developers seeking to develop VR experiences without hardware may make use of the Mozilla WebXR emulator extension at [https://github.com/MozillaReality/WebXR-emulator-extension](https://github.com/MozillaReality/WebXR-emulator-extension) with these installation steps:

- Install the WebXR extension on either Chrome or Firefox.
- Close and reopen the browser.
- Press F12 to access the browser console.
- Select the "WebXR" tab to selected XR emulated hardware and view controls.

<iframe src="https://scribehow.com/embed/Install_Chrome_Extension_for_VR_Visualization__vjzrmIAYSoOtJBrybbPZng" width="100%" height="640" allowfullscreen frameborder="0"></iframe>
