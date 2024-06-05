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

