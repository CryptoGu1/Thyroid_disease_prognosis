/* Local report extraction. No report bytes are sent to a server. */
(function () {
  'use strict';
  let pdfModule, worker, workerPromise, progressCallback;
  const absolute = (p) => new URL(p, document.baseURI).href;
  const report = (stage, progress = null) => progressCallback?.({ stage, progress });
  const translations = {
    'initializing tesseract': 'Подготовка распознавания',
    'loading language traineddata': 'Загрузка русского и английского языков',
    'initializing api': 'Подготовка языковой модели',
    'recognizing text': 'Распознавание текста',
    'loading tesseract core': 'Загрузка движка распознавания'
  };
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src; tag.onload = resolve;
      tag.onerror = () => reject(new Error('Не удалось загрузить модуль распознавания. Можно внести показатели вручную или вставить текст бланка.'));
      document.head.appendChild(tag);
    });
  }
  async function getWorker() {
    if (worker) return worker;
    if (!workerPromise) workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(absolute('assets/vendor/tesseract.min.js'));
      const result = await window.Tesseract.createWorker(['rus', 'eng'], 1, {
        workerPath: absolute('assets/vendor/tesseract-worker.min.js'),
        corePath: absolute('assets/vendor/tesseract-core'),
        langPath: absolute('assets/vendor/tessdata'),
        logger: (message) => report(translations[message.status] || 'Подготовка распознавания', Number.isFinite(message.progress) ? message.progress : null),
        cacheMethod: 'write', gzip: true
      });
      await result.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '200' });
      worker = result;
      return result;
    })().catch(error => { workerPromise = null; throw error; });
    return workerPromise;
  }
  async function ocrImage(image) {
    const engine = await getWorker();
    let result = await engine.recognize(image);
    const primary = result.data.text || '';
    const core = window.ThyroLab;
    const parsed = core?.parseLabText(primary);
    // Cyrillic abbreviations can be mistaken for Latin letters by a bilingual
    // pass. Retry with Russian only when key fields are missing. Select one
    // complete transcription; never combine numbers from different passes.
    if (core && /[а-яё]/i.test(primary) && (!parsed.rows.some(row => row.analyte === 'TSH') || parsed.warnings.length)) {
      const score = (text) => core.parseLabText(text).rows.reduce((total, row) => {
        const definition = core.definitions[row.analyte];
        return total + 1 + Number(core.parseNumber(row.value) !== null)
          + Number(definition.units.includes(row.unit))
          + Number(core.parseNumber(row.high) !== null)
          + Number(definition.antibody || core.parseNumber(row.low) !== null);
      }, 0);
      report('Уточняем русские обозначения', null);
      try {
        await engine.reinitialize('rus', 1);
        await engine.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '200' });
        const russian = await engine.recognize(image);
        if (score(russian.data.text || '') > score(primary)) result = russian;
      } finally {
        await engine.reinitialize(['rus', 'eng'], 1);
        await engine.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '200' });
      }
    }
    return { text: result.data.text || '', confidence: result.data.confidence };
  }
  function textFromPdfItems(items) {
    const lines = [];
    for (const item of items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Number(item.transform?.[5] || 0);
      let line = lines.find(candidate => Math.abs(candidate.y - y) < 3);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push({ x: Number(item.transform?.[4] || 0), text: item.str });
    }
    return lines.sort((a,b) => b.y-a.y).map(line => line.items.sort((a,b) => a.x-b.x).map(i=>i.text).join('  ')).join('\n');
  }
  async function readPdf(file, forceOCR) {
    report('Читаем PDF', 0);
    pdfModule ||= await import(absolute('assets/vendor/pdf.mjs'));
    pdfModule.GlobalWorkerOptions.workerSrc = absolute('assets/vendor/pdf.worker.mjs');
    let pdf, loadingTask;
    try {
      loadingTask = pdfModule.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, cMapUrl: absolute('assets/vendor/pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: absolute('assets/vendor/pdfjs/standard_fonts/'), wasmUrl: absolute('assets/vendor/pdfjs/wasm/') });
      pdf = await loadingTask.promise;
      if (pdf.numPages > 5) throw new Error('В PDF больше 5 страниц. Загрузите отдельный бланк до 5 страниц или введите нужные показатели вручную.');
      const texts = []; let ocrPages = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        report(`Читаем страницу ${pageNumber} из ${pdf.numPages}`, (pageNumber - 1) / pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        const text = forceOCR ? '' : textFromPdfItems((await page.getTextContent()).items);
        if (text.replace(/\s/g,'').length >= 35) {
          texts.push(text);
        } else {
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2.4, 2600 / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          report(`Распознаём скан: страница ${pageNumber} из ${pdf.numPages}`, null);
          texts.push((await ocrImage(canvas)).text); ocrPages++;
          canvas.width = canvas.height = 1;
        }
        page.cleanup();
      }
      return { text: texts.join('\n\n'), method: ocrPages ? `PDF + OCR (${ocrPages} стр.)` : 'Текст PDF', pages: pdf.numPages, warnings: ocrPages ? ['Проверьте распознанные цифры, знаки, единицы и референсы по оригиналу бланка.'] : [] };
    } catch (error) {
      if (error.name === 'PasswordException') throw new Error('PDF защищён паролем. Используйте изображение доступного вам бланка или внесите показатели вручную.');
      throw error;
    } finally { if (loadingTask?.destroy) await loadingTask.destroy(); }
  }
  async function readImage(file) {
    report('Подготавливаем изображение', null);
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 70e6) { bitmap.close(); throw new Error('Изображение слишком большое. Используйте фото бланка с меньшим разрешением.'); }
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > 3000 ? 3000 / longest : longest < 1600 ? Math.min(2, 1600 / longest) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    try {
      const result = await ocrImage(canvas);
      return { text: result.text, method: 'OCR · русский / английский', confidence: result.confidence, warnings: ['OCR может ошибаться: сверьте цифры, десятичные знаки, единицы и референсы с бланком.'] };
    } finally { canvas.width = canvas.height = 1; }
  }
  async function extract(file, { onProgress, forceOCR = false } = {}) {
    progressCallback = onProgress;
    if (!file) throw new Error('Сначала выберите файл.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Файл больше 10 МБ. Загрузите более компактный PDF или фотографию бланка.');
    const ext = file.name.split('.').pop().toLowerCase();
    let result;
    if (ext === 'pdf' || file.type === 'application/pdf') result = await readPdf(file, forceOCR);
    else if (['png','jpg','jpeg','webp','bmp'].includes(ext) || file.type.startsWith('image/')) result = await readImage(file);
    else if (['txt','csv','tsv'].includes(ext) || /^text\//.test(file.type)) {
      report('Читаем текст', 0.5);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = new TextDecoder('utf-8').decode(bytes);
      if ((text.match(/\uFFFD/g)||[]).length > 3) text = new TextDecoder('windows-1251').decode(bytes);
      result = { text: text.replace(/^\uFEFF/,''), method: 'Текст / таблица', warnings: [] };
    } else throw new Error('Поддерживаются PDF, JPG, PNG, WebP, BMP, CSV и TXT.');
    if (!result.text.trim()) throw new Error('Текст не найден. Попробуйте более чёткое фото или внесите показатели вручную.');
    report('Бланк прочитан', 1);
    return result;
  }
  async function clear() { if (worker) { await worker.terminate(); worker = null; workerPromise = null; } progressCallback = null; }
  window.LabImport = { extract, clear };
})();
