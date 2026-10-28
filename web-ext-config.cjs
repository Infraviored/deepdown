// web-ext works on the built Firefox extension: run `npm run build:firefox` first.
module.exports = {
  sourceDir: './build/firefox',
  artifactsDir: './web-ext-artifacts',
  build: { overwriteDest: true },
};
