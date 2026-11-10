(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const info = {
    TSH: { name: 'ТТГ', subtitle: 'Тиреотропный гормон', unit: 'mIU/L' },
    FT4: { name: 'Т4 свободный', subtitle: 'FT4 · свободный тироксин', unit: 'pmol/L' },
    FT3: { name: 'Т3 свободный', subtitle: 'FT3 · свободный трийодтиронин', unit: 'pmol/L' },
    TPOAB: { name: 'Антитела к ТПО', subtitle: 'АТ-ТПО / anti-TPO', unit: 'IU/mL' },
    TGAB: { name: 'Антитела к ТГ', subtitle: 'АТ-ТГ / anti-Tg', unit: 'IU/mL' },
    TT4: { name: 'Т4 общий', subtitle: 'TT4 · не свободный Т4', unit: 'nmol/L' },
    TT3: { name: 'Т3 общий', subtitle: 'TT3 · не свободный Т3', unit: 'nmol/L' },
    FTI: { name: 'Индекс FTI', subtitle: 'Индекс свободного Т4', unit: 'index' },
    T4U: { name: 'T4 uptake', subtitle: 'T4U', unit: 'ratio' }
  };
  const state = { rows: [], file: null, source: null, result: null, busy: false, parseWarnings: [], importWarnings: [], revision: 0 };
  let toastTimer;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const textOf = (value) => typeof value === 'string' ? value : value?.message || value?.text || value?.description || JSON.stringify(value);
  const array = (value) => !value ? [] : Array.isArray(value) ? value : [value];
  function showNotice(target, messages) {
    const node = $(target), list = array(messages).map(textOf).filter(Boolean);
    node.hidden = !list.length;
    node.innerHTML = list.length === 1 ? escape(list[0]) : `<ul>${list.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`;
  }
  function toast(message) {
    $('#toast').textContent = message; $('#toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3600);
  }
  function stage(number) {
    $$('.step').forEach(node => { const step = Number(node.dataset.step); node.classList.toggle('active', step === number); node.classList.toggle('done', step < number); });
  }
  function invalidate() {
    state.result = null; state.revision++;
    $('#confirmed').checked = false;
    $('#result-content').hidden = true;
    $('#result-content').innerHTML = '';
    $('#result-empty').hidden = false;
    showNotice('#validation-error', []);
    stage(state.rows.some(row => String(row.value).trim()) ? 2 : 1);
  }
  function blankRow(analyte) {
    return { analyte, value: '', unit: '', low: '', high: '' };
  }
  function setRows(rows) {
    state.rows = rows.filter(row => info[row.analyte]).map(row => ({ ...row, value: String(row.value ?? ''), unit: String(row.unit ?? ''), low: String(row.low ?? ''), high: String(row.high ?? '') }));
    for (const analyte of ['TSH','FT4']) if (!state.rows.some(row => row.analyte === analyte)) state.rows.push(blankRow(analyte));
    renderRows(); invalidate();
  }
  function renderRows() {
    $('#rows-count').textContent = `${state.rows.length} ${state.rows.length === 1 ? 'показатель' : state.rows.length < 5 ? 'показателя' : 'показателей'}`;
    $('#lab-rows').innerHTML = state.rows.map((row,index) => {
      const entry = info[row.analyte];
      const value = row.qualifier && !String(row.value).startsWith(row.qualifier) ? row.qualifier + row.value : row.value;
      return `<tr data-row="${index}"><td class="name-cell"><select data-field="analyte" aria-label="Показатель ${index + 1}">${Object.entries(info).map(([key, item]) => `<option value="${key}"${key === row.analyte ? ' selected' : ''}>${escape(item.name)}</option>`).join('')}</select><small>${escape(entry.subtitle)}</small></td>
      <td data-label="Результат"><input data-field="value" inputmode="decimal" aria-label="${escape(entry.name)}: результат" value="${escape(value)}" placeholder="Значение" autocomplete="off"></td>
      <td data-label="Единицы"><input data-field="unit" aria-label="${escape(entry.name)}: единицы" value="${escape(row.unit)}" placeholder="${escape(entry.unit || 'Из бланка')}" autocomplete="off"></td>
      <td data-label="Референс: от"><input data-field="low" inputmode="decimal" aria-label="${escape(entry.name)}: нижний референс" value="${escape(row.low)}" placeholder="От" autocomplete="off"></td>
      <td data-label="Референс: до"><input data-field="high" inputmode="decimal" aria-label="${escape(entry.name)}: верхний референс" value="${escape(row.high)}" placeholder="До" autocomplete="off"></td>
      <td><button type="button" class="remove-row" data-remove="${index}" aria-label="Удалить ${escape(entry.name)}"><svg class="icon"><use href="#i-close"/></svg></button></td></tr>`;
    }).join('');
  }
  function readRows() {
    return state.rows.map((row,index) => {
      const node = $(`#lab-rows tr[data-row="${index}"]`), result = { ...row };
      node?.querySelectorAll('[data-field]').forEach(input => { result[input.dataset.field] = input.value.trim(); });
      // When the user edits a censored result, the visible field is authoritative.
      if (result.value !== String(row.value)) delete result.qualifier;
      return result;
    });
  }
  function clearContext() { $('#age').value=''; ['#pregnant','#thyroid-medication','#antithyroid-medication','#acute-illness'].forEach(id=>{$(id).checked=false;}); }
  function context() {
    const age = $('#age').value.trim();
    const onThyroxine = $('#thyroid-medication').checked, onAntithyroidMeds = $('#antithyroid-medication').checked;
    return { age: age === '' ? null : Number(age), pregnant: $('#pregnant').checked, onThyroxine, onAntithyroidMeds, thyroidMedication: onThyroxine || onAntithyroidMeds, acuteIllness: $('#acute-illness').checked, confirmed: $('#confirmed').checked };
  }
  function busy(value) {
    state.busy = value;
    ['#upload-button','#replace-file','#manual-button','#parse-text','#force-ocr','#calculate','#add-row','#clear-all'].forEach(id => { $(id).disabled = value; });
    $$('[data-demo]').forEach(node => { node.disabled = value; });
    $('#file-input').disabled = value;
    $('#lab-rows').querySelectorAll('input,select,button').forEach(node => { node.disabled = value; });
  }
  function progress({stage: label, progress: amount}) {
    $('#import-progress').hidden = false;
    $('#progress-label').textContent = label;
    const known = Number.isFinite(amount);
    $('#progress-number').textContent = known ? `${Math.round(Math.max(0,Math.min(1,amount))*100)}%` : '';
    $('#progress-fill').style.width = known ? `${Math.max(3,Math.min(100,amount*100))}%` : '35%';
    $('.progress-track').classList.toggle('indeterminate', !known);
  }
  function parsedText(text, warnings = []) {
    if (!window.ThyroLab?.parseLabText) throw new Error('Модуль расчёта ещё не загружен. Обновите страницу и попробуйте снова.');
    const parsed = window.ThyroLab.parseLabText(text);
    state.parseWarnings = [...warnings, ...array(parsed.warnings)];
    const rows = array(parsed.rows);
    if (!rows.length) state.parseWarnings.push('Показатели не удалось выделить автоматически. Проверьте текст ниже или внесите значения в таблицу вручную.');
    setRows(rows);
    showNotice('#parse-warnings', state.parseWarnings);
    stage(2);
    return rows.length;
  }
  async function importFile(file, forceOCR = false) {
    if (state.busy || !file) return;
    setRows([blankRow('TSH'),blankRow('FT4')]); clearContext(); state.source=null; $('#raw-text').value=''; $('#file-state').hidden=true; $('#drop-zone').hidden=false; showNotice('#parse-warnings',[]); showNotice('#import-error', []); busy(true);
    try {
      state.file = file;
      const extracted = await window.LabImport.extract(file, { onProgress: progress, forceOCR });
      state.source = { kind: 'file', name: file.name, method: extracted.method, synthetic: false };
      state.importWarnings = array(extracted.warnings);
      $('#raw-text').value = extracted.text;
      const count = parsedText(extracted.text, state.importWarnings);
      $('#file-name').textContent = file.name;
      $('#file-method').textContent = `${extracted.method} · выделено показателей: ${count}`;
      $('#file-state').hidden = false; $('#drop-zone').hidden = true;
      $('#force-ocr').hidden = !/\.pdf$/i.test(file.name);
      if (!count) $('#raw-details').open = true;
      toast(count ? 'Бланк прочитан. Проверьте цифры перед расчётом.' : 'Проверьте распознанный текст или заполните таблицу.');
      $('#review-panel').scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) {
      showNotice('#import-error', error.message || 'Не удалось прочитать файл. Введите показатели вручную.');
      $('#drop-zone').hidden = false;
    } finally { busy(false); $('#import-progress').hidden = true; }
  }
  const demos = {
    normal: { name: 'Учебный пример · в референсе', text: 'ТТГ 2,1 mIU/L 0,4–4,0\nТ4 свободный 15,2 pmol/L 10–22', rows: [{analyte:'TSH',value:'2.1',unit:'mIU/L',low:'0.4',high:'4.0'},{analyte:'FT4',value:'15.2',unit:'pmol/L',low:'10',high:'22'}] },
    hypo: { name: 'Учебный пример · повышенный ТТГ', text: 'ТТГ 8,6 mIU/L 0,4–4,0\nТ4 свободный 8,3 pmol/L 10–22', rows: [{analyte:'TSH',value:'8.6',unit:'mIU/L',low:'0.4',high:'4.0'},{analyte:'FT4',value:'8.3',unit:'pmol/L',low:'10',high:'22'}] },
    hyper: { name: 'Учебный пример · сниженный ТТГ', text: 'ТТГ 0,03 mIU/L 0,4–4,0\nТ4 свободный 29,4 pmol/L 10–22\nТ3 свободный 8,1 pmol/L 3,1–6,8', rows: [{analyte:'TSH',value:'0.03',unit:'mIU/L',low:'0.4',high:'4.0'},{analyte:'FT4',value:'29.4',unit:'pmol/L',low:'10',high:'22'},{analyte:'FT3',value:'8.1',unit:'pmol/L',low:'3.1',high:'6.8'}] }
  };
  function loadDemo(name) {
    const demo = demos[name]; if (!demo || state.busy) return;
    state.file = null; state.source = { kind:'demo', name:demo.name, synthetic:true };
    state.parseWarnings = []; state.importWarnings = [];
    $('#raw-text').value = demo.text; $('#age').value = '35';
    ['#pregnant','#thyroid-medication','#antithyroid-medication','#acute-illness'].forEach(id=>{$(id).checked=false;});
    setRows(demo.rows); stage(2);
    $('#file-name').textContent = demo.name;
    $('#file-method').textContent = 'Синтетические значения и референсы · возраст 35 лет';
    $('#file-state').hidden = false; $('#drop-zone').hidden = true; $('#force-ocr').hidden = true;
    showNotice('#parse-warnings', 'Учебный пример: все значения, референсы и возраст вымышлены. Проверьте таблицу и отметьте подтверждение.');
    showNotice('#import-error', []);
    $('#review-panel').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function measurementMarkup(item) {
    const label = info[item.analyte]?.name || item.name || item.analyte || 'Показатель';
    const status = ['normal','high','low'].includes(item.status) ? item.status : 'unknown';
    const statusText = { normal:'В референсе',high:'Выше референса',low:'Ниже референса',unknown:'Недостаточно данных для сравнения' }[status];
    const hasRange = item.low != null && item.high != null && Number.isFinite(Number(item.low)) && Number.isFinite(Number(item.high)) && String(item.low).trim() !== '' && String(item.high).trim() !== '' && Number(item.high) > Number(item.low);
    let position = Number(item.position);
    if (!Number.isFinite(position) && hasRange) position=(Number(item.value)-Number(item.low))/(Number(item.high)-Number(item.low));
    const marker = Math.max(1,Math.min(99,20+position*60));
    const upperOnly = item.low == null && item.high != null && Number.isFinite(Number(item.high)) && Number(item.high) > 0;
    const range = hasRange && status !== 'unknown' && Number.isFinite(position) ? `<div class="range" role="img" aria-label="${escape(label)}: ${escape(statusText)}"><span class="range-marker ${status}" style="left:${marker}%"></span></div><div class="range-labels"><span>${escape(item.low)}</span><span>${escape(item.high)}</span></div>` : '';
    return `<div class="measurement"><div class="measurement-heading"><strong>${escape(label)}</strong><span class="measurement-number">${escape(item.displayValue ?? item.value ?? '—')} <small>${escape(item.unit || '')}</small></span></div><div class="measure-status ${status}">${escape(item.deviationText || statusText)}</div>${range}<p class="range-note">${hasRange ? `Референс лаборатории: ${escape(item.low)}–${escape(item.high)} ${escape(item.unit || '')}` : upperOnly ? `Верхняя граница лаборатории: ${escape(item.high)} ${escape(item.unit || '')}` : 'Проверьте единицы и референсные границы в таблице'}</p></div>`;
  }
  function safeUrl(url) { try { const u=new URL(url);return u.protocol==='https:' || u.protocol==='http:' ? u.href : '#'; } catch { return '#'; } }
  function renderResult(result) {
    const status = /^[a-z_-]+$/i.test(result.status) ? result.status : 'unknown';
    const details = array(result.details).map(textOf), warnings = array(result.warnings).map(textOf), missing = array(result.missing).map(textOf);
    const messages = [...new Set([...warnings,...missing])];
    const sources = array(result.sources);
    const measures = array(result.measurements);
    const timestamp = new Date(result.created_at).toLocaleString('ru-RU');
    const ctx = result.context || {};
    const conditions = [ctx.pregnant && 'беременность', ctx.onThyroxine && 'приём тироксина', ctx.onAntithyroidMeds && 'приём антитиреоидных препаратов', ctx.acuteIllness && 'острое заболевание'].filter(Boolean);
    const html = `<div class="result-summary ${status}"><span class="result-kicker">${state.source?.synthetic ? 'УЧЕБНЫЙ ПРИМЕР · ' : ''}ЛАБОРАТОРНЫЙ ПРОФИЛЬ</span><h3>${escape(result.title || 'Разбор показателей')}</h3><p>${escape(result.summary || '')}</p></div>
      <p class="report-context">Источник: ${escape(result.source?.name || 'Ручной ввод')}. Возраст: ${escape(ctx.age ?? 'не указан')}. Особые условия: ${escape(conditions.join(', ') || 'не отмечены')}.</p>
      <div class="measurement-list">${measures.map(measurementMarkup).join('')}</div>
      ${details.length ? `<div class="result-details"><h4>Как получен вывод</h4><ul>${details.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></div>` : ''}
      ${messages.length ? `<div class="result-warnings"><h4>Контекст и недостающие данные</h4><ul>${messages.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></div>` : ''}
      ${result.ml ? `<div class="ml-result"><h4>Исследовательская оценка</h4><p>${escape(result.ml.summary || result.ml.title || '')}</p><small>${escape(result.ml.note || 'Оценка модели не является клинической вероятностью заболевания.')}</small></div>` : ''}
      <div class="result-sources">${sources.map(source=>`<a href="${escape(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escape(source.label || source.title || 'Источник')} ↗</a>`).join('')}</div>
      <span class="result-time">Расчёт: ${escape(timestamp)}</span>
      <div class="result-actions"><button type="button" class="button secondary" id="print-report"><svg class="icon"><use href="#i-print"/></svg>Отчёт / PDF</button><button type="button" class="button secondary" id="download-report">Скачать JSON</button></div>`;
    $('#result-content').innerHTML = html; $('#result-content').hidden=false; $('#result-empty').hidden=true;
    $('#print-report').addEventListener('click',()=>window.print());
    $('#download-report').addEventListener('click',downloadReport);
    stage(3);
  }
  function calculate() {
    showNotice('#validation-error', []);
    if (!$('#confirmed').checked) { showNotice('#validation-error','Сначала сверьте значения, единицы и референсы с бланком и отметьте подтверждение.'); $('#confirmed').focus(); return; }
    const rows=readRows(); state.rows=rows;
    const entered=rows.filter(row=>row.value.trim());
    if (!entered.length) { showNotice('#validation-error','Добавьте хотя бы один результат анализа.'); return; }
    const ctx=context();
    if (ctx.age !== null && (!Number.isInteger(ctx.age) || ctx.age<0 || ctx.age>120)) { showNotice('#validation-error','Проверьте возраст: введите целое число от 0 до 120 или оставьте поле пустым.'); return; }
    try {
      if (!window.ThyroLab?.evaluate) throw new Error('Модуль расчёта не загрузился. Обновите страницу.');
      const result=window.ThyroLab.evaluate(entered,ctx);
      if (!result || typeof result !== 'object') throw new Error('Модуль расчёта вернул неполный результат.');
      state.result={...result,created_at:new Date().toISOString(),input_rows:entered,context:ctx,source:state.source||{kind:'manual',name:'Ручной ввод',synthetic:false}};
      renderResult(state.result);
      $('#result-panel').scrollIntoView({behavior:'smooth',block:'start'});
    } catch(error) {showNotice('#validation-error',error.message||'Не удалось рассчитать результат. Проверьте данные.');}
  }
  function downloadReport() {
    if (!state.result) return;
    const payload={app:'ThyroVision LAB',version:'2.0',purpose:'Учебный разбор лабораторного профиля по референсам лаборатории',...state.result};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`ThyroVision_LAB_${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast('Отчёт сохранён. Исходный бланк в него не включён.');
  }
  function clearAll() {
    state.file=null;state.source=null;state.parseWarnings=[];state.importWarnings=[];
    $('#raw-text').value='';$('#file-input').value='';$('#age').value='';
    ['#pregnant','#thyroid-medication','#antithyroid-medication','#acute-illness'].forEach(id=>{$(id).checked=false;});
    $('#file-state').hidden=true;$('#drop-zone').hidden=false;$('#force-ocr').hidden=true;$('#raw-details').open=false;
    showNotice('#import-error',[]);showNotice('#parse-warnings',[]);
    setRows([blankRow('TSH'),blankRow('FT4')]);
    window.LabImport.clear?.().catch(()=>{});
    toast('Бланк и введённые показатели очищены.');
  }
  async function loadResearch() {
    try {
      const response=await fetch('assets/lab-model-meta.json');if(!response.ok)return;
      const data=await response.json();
      const desc=data.description||'Отдельный эксперимент на открытом наборе данных.';
      const limits=array(data.limitations), metrics=data.metrics||{};
      const pct=value=>Number.isFinite(value)?(100*value).toFixed(1)+'%':'—';
      $('#research-content').innerHTML=`<p>${escape(desc)}</p><p class="research-scope">Исследовательский режим использует только тестовые строки датасета с ТТГ, общим Т4 и Т3. Общий Т4 и свободный Т4 — разные показатели.</p><table class="research-table"><thead><tr><th>Модель</th><th>Accuracy</th><th>F1-macro</th><th>Тестовых строк</th></tr></thead><tbody><tr><td>${escape(data.name||'Классификатор')}</td><td>${pct(metrics.accuracy)}</td><td>${pct(metrics.f1_macro)}</td><td>${escape(metrics.test_size||'—')}</td></tr></tbody></table>${limits.length?`<p>${limits.map(textOf).map(escape).join(' ')}</p>`:''}${data.source?.url?`<p><a href="${escape(safeUrl(data.source.url))}" target="_blank" rel="noopener noreferrer">${escape(data.source.label||'Открыть датасет')} ↗</a></p>`:''}<div id="research-examples"></div>`;
      $('#research-section').hidden=false;
      if (array(data.examples).length && window.ThyroResearch?.predict) {
        const target=$('#research-examples');
        target.innerHTML=`<p style="margin-top:15px">Примеры из отложенной части датасета</p><div class="research-demo-buttons">${data.examples.slice(0,6).map((ex,i)=>`<button class="button secondary" type="button" data-research-example="${i}">${escape(ex.title||`Пример ${i+1}`)}</button>`).join('')}</div><div id="research-prediction" aria-live="polite"></div>`;
        target.querySelectorAll('[data-research-example]').forEach(button=>button.addEventListener('click',async()=>{
          const ex=data.examples[Number(button.dataset.researchExample)];
          const output=$('#research-prediction'); button.disabled=true;output.textContent='Вычисляем прогноз исследовательской модели…';
          try {
            await window.ThyroResearch.init();
            const value=await window.ThyroResearch.predict(ex.features);
            output.innerHTML=`<div class="research-result"><p class="research-features">ТТГ: ${escape(ex.features.TSH)} · Общий Т4: ${escape(ex.features.TT4)} · Т3: ${escape(ex.features.T3)} <small>Числа в масштабе исходного датасета; единицы не подтверждены.</small></p><strong>Прогноз: ${escape(value.label)}</strong><p>Метка датасета: ${escape(ex.trueLabel)}.</p><div class="research-scores">${array(value.scores).map(item=>`<div><span>${escape(item.label)}</span><b>${pct(item.score)}</b></div>`).join('')}</div><small>${escape(value.note||'Оценки исследовательского классификатора не являются вероятностями диагноза для пациента.')}</small></div>`;
          }catch(error){output.textContent=error.message||'Не удалось выполнить исследовательский расчёт.';}
          finally{button.disabled=false;}
        }));
      }
    } catch { /* The reference-based calculator remains independent of research metadata. */ }
  }
  $('#upload-button').addEventListener('click',()=>$('#file-input').click());
  $('#replace-file').addEventListener('click',()=>$('#file-input').click());
  $('#file-input').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';importFile(file);});
  $('#force-ocr').addEventListener('click',()=>importFile(state.file,true));
  $('#drop-zone').addEventListener('dragover',event=>{event.preventDefault();if(!state.busy)$('#drop-zone').classList.add('drag-over');});
  $('#drop-zone').addEventListener('dragleave',()=>$('#drop-zone').classList.remove('drag-over'));
  $('#drop-zone').addEventListener('drop',event=>{event.preventDefault();$('#drop-zone').classList.remove('drag-over');if(state.busy)return;if(event.dataTransfer.files.length!==1){invalidate();showNotice('#import-error','Загрузите один файл за раз. Данные разных бланков не объединяются.');return;}importFile(event.dataTransfer.files[0]);});
  $('#manual-button').addEventListener('click',()=>{$('#review-panel').scrollIntoView({behavior:'smooth',block:'start'});$('#lab-rows input')?.focus({preventScroll:true});stage(2);});
  $('#parse-text').addEventListener('click',()=>{try{showNotice('#import-error',[]);const text=$('#raw-text').value.trim();if(!text)throw new Error('Вставьте текст бланка в поле выше.');parsedText(text);clearContext();state.source={kind:'text',name:'Вставленный текст',synthetic:false};state.file=null;$('#force-ocr').hidden=true;$('#file-name').textContent='Вставленный текст бланка';$('#file-method').textContent='Проверьте распознанные показатели';$('#file-state').hidden=false;$('#drop-zone').hidden=true;$('#review-panel').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){showNotice('#import-error',error.message);}});
  $('#lab-rows').addEventListener('input',event=>{const row=event.target.closest('[data-row]');if(!row||!event.target.dataset.field)return;const index=Number(row.dataset.row),field=event.target.dataset.field;state.rows[index][field]=event.target.value;delete state.rows[index].qualifier;invalidate();if(field==='analyte')renderRows();if(field==='unit'||field==='analyte')showNotice('#parse-warnings','Показатель или единица изменены. Числа автоматически не пересчитываются. Заново сверьте значение и обе границы с бланком.');});
  $('#lab-rows').addEventListener('click',event=>{const button=event.target.closest('[data-remove]');if(!button)return;state.rows.splice(Number(button.dataset.remove),1);renderRows();invalidate();});
  $('#add-row').addEventListener('click',()=>{const analyte=$('#new-analyte').value;state.rows.push(blankRow(analyte));renderRows();invalidate();$('#lab-rows tr:last-child input')?.focus();});
  ['#age','#pregnant','#thyroid-medication','#antithyroid-medication','#acute-illness'].forEach(id=>$(id).addEventListener('input',invalidate));
  $('#confirmed').addEventListener('change',()=>{if(!$('#confirmed').checked)invalidate();else showNotice('#validation-error',[]);});
  $('#calculate').addEventListener('click',calculate);
  $$('[data-demo]').forEach(button=>button.addEventListener('click',()=>loadDemo(button.dataset.demo)));
  $('#clear-all').addEventListener('click',clearAll);
  $('#method-open').addEventListener('click',()=>$('#method').scrollIntoView({behavior:'smooth',block:'start'}));
  setRows([blankRow('TSH'),blankRow('FT4')]);loadResearch();
})();
