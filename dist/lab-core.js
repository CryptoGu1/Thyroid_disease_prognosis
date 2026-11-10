/* ThyroVision LAB: transparent reference-interval calculations.
 * No patient data is sent to a server. These rules are not an ML model.
 */
(function (root) {
  'use strict';
  const SOURCES = [
    {label:'American Thyroid Association — Thyroid Function Tests',url:'https://www.thyroid.org/thyroid-function-tests/'},
    {label:'NICE NG145 — исследование функции щитовидной железы',url:'https://www.nice.org.uk/guidance/ng145/chapter/recommendations'},
    {label:'Mayo Clinic Laboratories — единицы измерения',url:'https://www.mayocliniclabs.com/order-tests/si-unit-conversion.html'}
  ];
  const DEFINITIONS = {
    TSH: {name:'ТТГ', units:['mIU/L','μIU/mL'], re:/(?:тиреотропн(?:ый|ого)\s+гормон|thyroid\s+stimulating\s+hormone|thyrotropin|(?<![\p{L}\d])ттг(?![\p{L}\d])|(?<![\p{L}\d])tsh(?![\p{L}\d]))/iu},
    FT4: {name:'Свободный Т4', units:['pmol/L','ng/dL'], re:/(?:свободн(?:ый|ого)\s+(?:тироксин[а]?|[тt]\s*4)|тироксин\s*(?:\([^)]*\))?\s*свободн(?:ый|ого)|[тt]\s*4\s*[-–]?\s*(?:свободн(?:ый|ого)|св\.?)(?![\p{L}])|св\.?\s*[тt]\s*4|free\s*[тt]\s*4|[тt]\s*4\s*free|(?<![\p{L}\d])f[тt]\s*4(?![\p{L}\d]))/iu},
    FT3: {name:'Свободный Т3', units:['pmol/L','pg/mL'], re:/(?:свободн(?:ый|ого)\s+(?:трийодтиронин[а]?|[тt]\s*3)|трийодтиронин\s*(?:\([^)]*\))?\s*свободн(?:ый|ого)|[тt]\s*3\s*[-–]?\s*(?:свободн(?:ый|ого)|св\.?)(?![\p{L}])|св\.?\s*[тt]\s*3|free\s*[тt]\s*3|[тt]\s*3\s*free|(?<![\p{L}\d])f[тt]\s*3(?![\p{L}\d]))/iu},
    TPOAB: {name:'Анти-ТПО', units:['IU/mL','kIU/L','U/mL'], antibody:true, re:/(?:антитела\s+к\s+тиреопероксидазе|ат\s*(?:к\s+)?тиреопероксидазе|ат\s*[-–]?\s*тпо|анти\s*[-–]?\s*тпо|anti\s*[-–]?\s*tpo|tpo\s*(?:ab|antibodies))/iu},
    TGAB: {name:'Анти-ТГ', units:['IU/mL','kIU/L','U/mL'], antibody:true, re:/(?:антитела\s+к\s+тиреоглобулину|ат\s*[-–]?\s*тг(?![\p{L}])|анти\s*[-–]?\s*тг|anti\s*[-–]?\s*tg|tg\s*(?:ab|antibodies))/iu},
    TT4: {name:'Общий Т4', units:['nmol/L','μg/dL'], re:/(?:общий\s+(?:тироксин|[тt]\s*4)|тироксин\s*общий|[тt]\s*4\s*общ(?:ий|\.)|total\s*[тt]\s*4|[тt]\s*4\s*total|(?<![\p{L}\d])tt4(?![\p{L}\d]))/iu},
    TT3: {name:'Общий Т3', units:['nmol/L','ng/dL'], re:/(?:общий\s+(?:трийодтиронин|[тt]\s*3)|трийодтиронин\s*общий|[тt]\s*3\s*общ(?:ий|\.)|total\s*[тt]\s*3|[тt]\s*3\s*total|(?<![\p{L}\d])tt3(?![\p{L}\d]))/iu},
    FTI: {name:'Индекс свободного тироксина', units:['index'], re:/(?:индекс\s+свободного\s+тироксина|free\s+thyroxine\s+index|(?<![\p{L}\d])fti(?![\p{L}\d]))/iu},
    T4U: {name:'T4U', units:['ratio'], re:/(?<![\p{L}\d])t4u(?![\p{L}\d])/iu}
  };
  const NUMBER='[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)(?:[eE][+-]?\\d+)?';
  const UNIT_RE=/(?:мк\s*(?:ме|ед)\s*\/\s*мл|м\s*(?:ме|ед)\s*\/\s*л|(?:μ|µ|u)\s*i[uü]\s*\/\s*m[l1]|m\s*i[uü]\s*\/\s*[l1]|(?:пмоль|нмоль|pmol|nmol)\s*\/\s*(?:л|l)|(?:нг|ng)\s*\/\s*(?:дл|dl)|(?:пг|pg)\s*\/\s*(?:мл|ml)|(?:мкг|μg|µg|ug)\s*\/\s*(?:дл|dl)|(?:кме|kiu)\s*\/\s*(?:л|l)|(?:ме|ед|iu|u)\s*\/\s*(?:мл|ml))/iu;
  function str(v){return v===null||v===undefined?'':String(v).trim();}
  function parseNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const s=str(value).replace(/\u00a0/g,' ').trim();
    if(!new RegExp('^'+NUMBER+'$','u').test(s))return null;
    const n=Number(s.replace(',','.'));return Number.isFinite(n)?n:null;
  }
  function normalizeUnit(input){
    let u=str(input).toLowerCase().replace(/\s+/g,'').replace(/пмоль/g,'pmol').replace(/нмоль/g,'nmol').replace(/µ/g,'μ').replace(/мк/g,'μ').replace(/мл/g,'ml').replace(/дл/g,'dl').replace(/л/g,'l').replace(/ме|ед/g,'iu').replace(/пмоль/g,'pmol').replace(/нмоль/g,'nmol').replace(/нг/g,'ng').replace(/пг/g,'pg').replace(/μг/g,'μg');
    const map={'miu/l':'mIU/L','мiu/l':'mIU/L','μiu/ml':'μIU/mL','uiu/ml':'μIU/mL','pmol/l':'pmol/L','nmol/l':'nmol/L','ng/dl':'ng/dL','pg/ml':'pg/mL','μg/dl':'μg/dL','ug/dl':'μg/dL','iu/ml':'IU/mL','kiu/l':'kIU/L','кiu/l':'kIU/L','u/ml':'U/mL','index':'index','ratio':'ratio'};
    return map[u]||str(input);
  }
  function identify(input){
    // OCR may read the digit in Т3 as the visually identical Cyrillic З.
    // Normalize only the analyte label; never alter numeric results or units.
    const label=str(input).replace(/([тt]\s*)з(?=\s|$|[-–])/giu,(_,prefix)=>prefix+'3');
    const raw=str(input).toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(DEFINITIONS[raw])return {analyte:raw,index:0,length:str(input).length};
    for(const [analyte,definition] of Object.entries(DEFINITIONS)){
      const m=label.match(definition.re); if(m)return {analyte,index:m.index,length:m[0].length};
    }
    return null;
  }
  function splitDelimited(line,delimiter){
    const cells=[];let cell='',quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(c===delimiter&&!quoted){cells.push(cell.trim());cell='';}else cell+=c;
    }
    cells.push(cell.trim());return cells;
  }
  function rawRow(analyte,value,unit,low,high,sourceLine){
    let v=str(value);const q=v.match(/^(<=|>=|[<>≤≥])/);
    return {analyte,value:v,unit:normalizeUnit(unit),low:str(low),high:str(high),qualifier:q?q[0]:'',sourceLine:str(sourceLine)};
  }
  function parseCSV(text){
    const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length<2)return null;
    const header=lines[0];const delim=header.includes(';')?';':header.includes('\t')?'\t':',';
    const cells=splitDelimited(header,delim).map(x=>x.toLowerCase());
    const find=patterns=>cells.findIndex(s=>patterns.some(p=>p.test(s)));
    const nameI=find([/^(показатель|анализ|тест|analyte|test|name|marker)$/]);
    const valueI=find([/^(результат|значение|value|result)$/]);
    if(nameI<0||valueI<0)return null;
    const unitI=find([/^(unit|units|ед.*|единицы.*)$/]);
    const lowI=find([/^(low|lower|ref_low|reference_low|ниж.*|от)$/]);
    const highI=find([/^(high|upper|ref_high|reference_high|верх.*|до)$/]);
    const rangeI=find([/^(reference|range|референс.*|норма)$/]);
    const rows=[],warnings=[];
    for(const line of lines.slice(1)){
      const c=splitDelimited(line,delim), id=identify(c[nameI]);if(!id)continue;
      let lo=lowI>=0?c[lowI]:'',hi=highI>=0?c[highI]:'';
      if(rangeI>=0&&c[rangeI]){const m=c[rangeI].match(new RegExp('('+NUMBER+')\\s*[-–—…]\\s*('+NUMBER+')'));if(m){lo=m[1];hi=m[2];}else if(/^(?:до|<|≤)/i.test(c[rangeI]))hi=c[rangeI].match(new RegExp(NUMBER))?.[0]||'';}
      rows.push(rawRow(id.analyte,c[valueI],unitI>=0?c[unitI]:'',lo,hi,line));
    }
    if(!rows.length)warnings.push('В CSV не найдены поддерживаемые показатели щитовидной железы.');
    return {rows,warnings};
  }
  function parseLabText(text){
    text=str(text).replace(/\u2212/g,'-').replace(/\u00a0/g,' ');
    const csv=parseCSV(text);if(csv)return csv;
    const lines=text.split(/\r?\n/),rows=[],warnings=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim(), id=identify(line);if(!id)continue;
      let tail=line.slice(id.index+id.length).trim();
      // PDF text often splits a test name from its numerical row.
      if(!new RegExp(NUMBER).test(tail)&&i+1<lines.length&&!identify(lines[i+1])){tail+=' '+lines[i+1].trim();i++;}
      tail=tail.replace(/^[\s:|]+/,'').replace(/\((?:TSH|FT4|FT3|T4|T3|ТТГ|Т4|Т3)\)/ig,'');
      const unitMatch=tail.match(UNIT_RE);const unit=unitMatch?unitMatch[0]:'';
      const rangeRE=new RegExp('('+NUMBER+')\\s*(?:[-–—…]|\\.\\.)\\s*('+NUMBER+')','u');
      const range=tail.match(rangeRE);let low='',high='',without=tail;
      if(range){low=range[1];high=range[2];without=tail.slice(0,range.index)+' '+tail.slice(range.index+range[0].length);}
      else{
        const upper=tail.match(new RegExp('(?:реф[^:]*:|норма[^:]*:|до|reference\\s*:?|normal\\s*:?|[<(]\\s*)\\s*(?:<|≤)?\\s*('+NUMBER+')','iu'));
        // A one-sided reference is accepted only after an already visible result.
        if(upper&&upper.index>0&&new RegExp(NUMBER).test(tail.slice(0,upper.index))){high=upper[1];without=tail.slice(0,upper.index)+' '+tail.slice(upper.index+upper[0].length);}
      }
      if(unitMatch)without=without.replace(unitMatch[0],' ');
      const valueMatch=without.match(new RegExp('(?:<=|>=|[<>≤≥])?\\s*'+NUMBER,'u'));
      if(!valueMatch){warnings.push('Не удалось извлечь результат: '+DEFINITIONS[id.analyte].name+'. Заполните строку вручную.');continue;}
      const value=valueMatch[0].trim();rows.push(rawRow(id.analyte,value,unit,low,high,line));
      if(!unit)warnings.push(DEFINITIONS[id.analyte].name+': единицы не распознаны.');
      if(!high||(!low&&!DEFINITIONS[id.analyte].antibody))warnings.push(DEFINITIONS[id.analyte].name+': проверьте референсный интервал.');
      if(rows.length>=30){warnings.push('Извлечены первые 30 показателей. Используйте один бланк одной даты.');break;}
    }
    if(!rows.length)warnings.push('Показатели щитовидной железы не найдены. Проверьте текст или внесите ТТГ и свободный Т4 вручную.');
    const seen={};for(const r of rows)seen[r.analyte]=(seen[r.analyte]||0)+1;
    if(Object.values(seen).some(n=>n>1))warnings.push('Есть повторные показатели. Оставьте по одному результату одной даты — разные бланки не объединяются автоматически.');
    return {rows,warnings:[...new Set(warnings)]};
  }
  function format(n){return n===null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4}).format(n);}
  function evaluate(input,context={}){
    const warnings=[],missing=[],errors=[],measurements=[],rows=(Array.isArray(input)?input:[]).filter(r=>str(r.value)!=='');
    const result={status:'incomplete',title:'Недостаточно данных',summary:'Добавьте ТТГ и свободный Т4 с единицами и референсами лаборатории.',details:[],measurements,warnings,missing,sources:SOURCES,method:'reference_rules',version:'thyrovision-lab-rules-1.0',modelRisk:null};
    const seen={};
    for(const r of rows){
      const id=str(r.analyte).toUpperCase(),def=DEFINITIONS[id];if(!def){errors.push('Неизвестный показатель: '+str(r.analyte));continue;}
      seen[id]=(seen[id]||0)+1;
      const v=parseNumber(r.value),lo=parseNumber(r.low),hi=parseNumber(r.high),unit=normalizeUnit(r.unit),qualifier=str(r.qualifier)||str(r.value).match(/^(<=|>=|[<>≤≥])/)?.[0]||'';
      const m={analyte:id,name:def.name,value:v,displayValue:str(r.value),unit,low:lo,high:hi,status:'unknown',deviationText:'Нужны подтверждённые данные',position:null,sourceLine:str(r.sourceLine),qualifier};
      measurements.push(m);
      if(qualifier){warnings.push(def.name+': результат содержит знак '+qualifier+'. Он не считается точной концентрацией; автоматический профиль ограничен.');continue;}
      if(v===null||v<0){errors.push(def.name+': введите неотрицательное число без дополнительных символов.');continue;}
      if(!unit||!def.units.includes(unit)){warnings.push(def.name+': укажите поддерживаемые единицы ('+def.units.join(', ')+').');continue;}
      if(hi===null||hi<=0||(!def.antibody&&lo===null)){warnings.push(def.name+': нужны границы референса с вашего бланка.');continue;}
      if((lo!==null&&(lo<0||lo>=hi))){errors.push(def.name+': нижняя граница должна быть меньше верхней и неотрицательной.');continue;}
      m.status=v>hi?'high':lo!==null&&v<lo?'low':'normal';
      m.position=(v-(lo===null?0:lo))/(hi-(lo===null?0:lo));
      m.deviationText=m.status==='high'?'Выше верхней границы на '+format(v-hi)+' '+unit:m.status==='low'?'Ниже нижней границы на '+format(lo-v)+' '+unit:lo===null?'Не выше указанного лабораторного порога':'В пределах указанного референса';
      if(def.antibody&&m.status==='high')warnings.push(def.name+' повышен относительно лабораторного порога. Антитела не заменяют оценку функции железы по ТТГ и свободному Т4.');
    }
    for(const [id,n]of Object.entries(seen))if(n>1)errors.push(DEFINITIONS[id].name+': обнаружены повторные строки. Оставьте один результат одной даты.');
    result.abnormalCount=measurements.filter(m=>['low','high'].includes(m.status)).length;
    result.assessedCount=measurements.filter(m=>m.status!=='unknown').length;
    if(context.confirmed!==true){result.status='unconfirmed';result.title='Проверьте распознанные значения';result.summary='Подтвердите числа, единицы и референсы после сверки с бланком.';result.details=errors;return result;}
    if(errors.length){result.status='invalid';result.title='Исправьте данные перед расчётом';result.summary='Некоторые строки нельзя использовать в расчёте.';result.details=errors;return result;}
    const get=id=>measurements.find(m=>m.analyte===id), tsh=get('TSH'),ft4=get('FT4'),ft3=get('FT3');
    if(!tsh||tsh.status==='unknown')missing.push('ТТГ: точное значение, единицы и обе границы референса');
    if(!ft4||ft4.status==='unknown')missing.push('Свободный Т4: точное значение, единицы и обе границы референса');
    if(get('TT4')&&!ft4)warnings.push('Общий Т4 распознан отдельно. Его значение не подставляется вместо свободного Т4.');
    if(get('FTI'))warnings.push('FTI — отдельный индекс. Он не подставляется в поле свободного Т4.');
    const age=parseNumber(context.age),restrictions=[];
    if(age===null)restrictions.push('возраст не указан');else if(age<18||age>120)restrictions.push('возраст вне взрослой схемы приложения');
    if(context.pregnant)restrictions.push('беременность');
    if(context.postpartum)restrictions.push('послеродовой период');
    if(context.thyroidMedication||context.onThyroxine||context.onAntithyroidMeds)restrictions.push('приём препаратов, влияющих на функцию щитовидной железы');
    if(context.acuteIllness)restrictions.push('острое заболевание');
    if(context.pituitaryDisease)restrictions.push('заболевание гипофиза');
    if(context.biotin)restrictions.push('приём биотина');
    if(restrictions.length){result.status='limited';result.title='Сравнение с лабораторными референсами';result.summary='Автоматическая интерпретация профиля ограничена: '+restrictions.join(', ')+'.';result.details=['Отклонения по заполненным строкам рассчитаны. Для заключения нужен соответствующий клинический контекст.'];if(age===null)result.details.push('Укажите возраст для взрослой схемы интерпретации.');return result;}
    if(missing.length)return result;
    const a=tsh.status,b=ft4.status,c=ft3?.status;
    const set=(title,summary,status='attention')=>{result.title=title;result.summary=summary;result.status=status;};
    result.details.push('ТТГ '+format(tsh.value)+' '+tsh.unit+' — '+(a==='high'?'выше':a==='low'?'ниже':'в пределах')+' референса '+format(tsh.low)+'–'+format(tsh.high)+'.');
    result.details.push('Свободный Т4 '+format(ft4.value)+' '+ft4.unit+' — '+(b==='high'?'выше':b==='low'?'ниже':'в пределах')+' референса '+format(ft4.low)+'–'+format(ft4.high)+'.');
    const contradictoryFT3=(c==='high'&&(a==='high'||b==='low'))||(c==='low'&&b==='high');
    if(contradictoryFT3){set('Несогласованное сочетание показателей','Свободный Т3 противоречит простой схеме ТТГ/свободного Т4. Проверьте бланк, единицы и обсудите результаты с врачом.','limited');}
    else if(a==='high'&&b==='low'){set('Профиль, совместимый с первичным гипотиреозом','ТТГ выше референса, а свободный Т4 ниже. Это лабораторное сочетание требует оценки эндокринологом; приложение не устанавливает причину.');}
    else if(a==='high'&&b==='normal'){set('Повышенный ТТГ при свободном Т4 в референсе','Такое сочетание может соответствовать субклиническому гипотиреозу. Одного анализа недостаточно для решения о лечении.');}
    else if(a==='low'&&b==='high'){set('Лабораторный профиль тиреотоксикоза','ТТГ ниже референса, свободный Т4 выше. По одному бланку нельзя установить причину этого сочетания.');}
    else if(a==='low'&&b==='normal'){
      if(c==='high')set('Сниженный ТТГ и повышенный свободный Т3','Сочетание может соответствовать Т3-тиреотоксикозу и требует клинической оценки.');
      else if(c==='normal')set('Профиль субклинического тиреотоксикоза','ТТГ снижен, свободные Т4 и Т3 находятся в указанных интервалах. Важно оценить устойчивость изменения и клинический контекст.');
      else if(!ft3||c==='unknown'){set('ТТГ снижен: не хватает свободного Т3','Свободный Т4 находится в референсе. Без свободного Т3 нельзя полностью классифицировать это сочетание.','incomplete');missing.push('Свободный Т3 с единицами и референсом');}
      else set('Снижение ТТГ и свободного Т3','Это сочетание не относится к простой схеме. Нужна отдельная оценка с учётом состояния и препаратов.','limited');
    }
    else if(b==='low'&&(a==='normal'||a==='low')){set('Низкий свободный Т4 без повышения ТТГ','Не следует считать этот профиль нормой. Возможны разные причины, включая нарушения центральной регуляции; требуется отдельная оценка.','limited');}
    else if(a==='normal'&&b==='normal'){
      if(c==='high'||c==='low')set('ТТГ и свободный Т4 в референсе; Т3 отклонён','Изолированное изменение свободного Т3 требует проверки контекста и исходного бланка.','limited');
      else set('ТТГ и свободный Т4 в пределах референсов','В представленной паре показателей отклонений от подтверждённых лабораторных интервалов не обнаружено. Это не исключает все заболевания щитовидной железы.','normal');
    }
    else if(a==='high'&&b==='high')set('Несогласованное сочетание ТТГ и свободного Т4','Оба показателя повышены. Проверьте распознавание, единицы и лабораторные интервалы; требуется индивидуальная оценка.','limited');
    else if(a==='normal'&&b==='high')set('Повышенный свободный Т4 при ТТГ в референсе','Это сочетание требует проверки контекста и не получает автоматического диагноза.','limited');
    if(ft3&&ft3.status==='unknown')warnings.push('Свободный Т3 не удалось оценить; он не использован в профиле.');
    warnings.push('Вывод описывает текущий лабораторный профиль. Вероятность заболевания, прогноз на будущее и дозы препаратов не рассчитываются.');
    return result;
  }
  function convert(analyte,value,from,to){
    const v=parseNumber(value);if(v===null)return null;from=normalizeUnit(from);to=normalizeUnit(to);if(from===to)return v;
    if(analyte==='TSH'&&['mIU/L','μIU/mL'].includes(from)&&['mIU/L','μIU/mL'].includes(to))return v;
    if(analyte==='FT4'&&from==='ng/dL'&&to==='pmol/L')return v*12.87;
    if(analyte==='FT4'&&from==='pmol/L'&&to==='ng/dL')return v/12.87;
    if(analyte==='FT3'&&from==='pg/mL'&&to==='pmol/L')return v*1.54;
    if(analyte==='FT3'&&from==='pmol/L'&&to==='pg/mL')return v/1.54;
    return null;
  }
  const api={parseLabText,evaluate,parseNumber,normalizeUnit,identify,convert,definitions:DEFINITIONS,sources:SOURCES};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ThyroLab=api;
})(typeof globalThis!=='undefined'?globalThis:this);
