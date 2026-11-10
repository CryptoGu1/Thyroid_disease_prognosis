# Local OCR and PDF dependencies

Pinned versions:
- Tesseract.js 6.0.1 (Apache-2.0)
- tesseract.js-core 6.0.0 (Apache-2.0), four WebAssembly variants with paired loaders
- @tesseract.js-data/eng and /rus 1.0.0, 4.0.0_best_int (LSTM-only). Package wrappers declare MIT; the upstream traineddata license is Apache-2.0 and is included.
- pdfjs-dist 6.5.438 (Apache-2.0), matching main and worker modules

All npm tarballs were checked against the SHA-512 integrity provided by the official npm registry. `provenance.json` records source package versions, download URLs and SHA-256 of deployed assets. Upstream license files and notices are retained.

## OCR configuration

Load `tesseract.min.js`, then use the local worker/core/language paths:

```javascript
const base = new URL('./assets/vendor/', document.baseURI);
const worker = await Tesseract.createWorker('rus+eng', 1, {
  workerPath: new URL('tesseract-worker.min.js', base).href,
  corePath: new URL('tesseract-core/', base).href,
  langPath: new URL('tessdata/', base).href,
  gzip: true,
});
```

OEM 1 is LSTM only, which is required by the selected `best_int` language files. `corePath` is the directory, allowing Tesseract to select the correct SIMD/LSTM variant. Keep all worker/language paths explicit to avoid runtime CDN fallbacks.

## PDF configuration

```javascript
const base = new URL('./assets/vendor/', document.baseURI);
const pdfjs = await import(new URL('pdf.mjs', base).href);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', base).href;
const task = pdfjs.getDocument({
  data: arrayBuffer,
  cMapUrl: new URL('pdfjs/cmaps/', base).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('pdfjs/standard_fonts/', base).href,
  wasmUrl: new URL('pdfjs/wasm/', base).href,
  isEvalSupported: false,
});
```

This is a modern browser build. No PDF viewer scripting is needed for text extraction or rasterization. Do not enable document scripting; if a viewer is added, use `enableScripting: false` there. The version is newer than Mozilla's fixed version 6.2.108 for GHSA-hq66-cqwq-w95j.
