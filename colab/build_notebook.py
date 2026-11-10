"""Build a compact, self-contained Colab notebook from the evaluated project.

The notebook embeds application/research bytes; pinned vendor packages are
downloaded by bootstrap_runtime.py and verified against the original manifest.
"""
from pathlib import Path
import base64
import hashlib
import io
import json
import textwrap
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'colab' / 'ThyroVision_LAB_Colab.ipynb'


def markdown(text, cell_id):
    return {'cell_type': 'markdown', 'metadata': {'id': cell_id},
            'id': cell_id, 'source': textwrap.dedent(text).strip().splitlines(True)}


def code(text, cell_id, form=False):
    source = textwrap.dedent(text).strip() + '\n'
    compile(source, cell_id, 'exec')
    metadata = {'id': cell_id}
    if form:
        metadata['cellView'] = 'form'
    return {'cell_type': 'code', 'metadata': metadata, 'id': cell_id,
            'source': source.splitlines(True), 'execution_count': None,
            'outputs': []}


def make_payload():
    manifest = json.loads((ROOT / 'dist/assets/vendor/provenance.json').read_text())
    hydrated = {'dist/assets/vendor/' + a['path'] for a in manifest['assets'] if a.get('package')}
    buffer = io.BytesIO()
    allowed = ('dist', 'research', 'data', 'results', 'README.md',
               'START_HERE_RU.txt', 'START_WINDOWS.bat', 'start.sh')
    included = []
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in allowed:
            entry = ROOT / name
            paths = [entry] if entry.is_file() else sorted(entry.rglob('*'))
            for path in paths:
                if not path.is_file() or path.is_symlink():
                    continue
                rel = path.relative_to(ROOT).as_posix()
                if '__pycache__' in path.parts or path.suffix == '.pyc' or rel in hydrated:
                    continue
                # Stable ZIP timestamps make a rebuild reproducible.
                info = zipfile.ZipInfo(rel, (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
                included.append(rel)
    return buffer.getvalue(), included


def main():
    payload, included = make_payload()
    digest = hashlib.sha256(payload).hexdigest()
    encoded = '\n'.join(textwrap.wrap(base64.b64encode(payload).decode(), 100))
    bootstrap = (ROOT / 'colab/bootstrap_runtime.py').read_text()
    # The whole installer is visible in the cell; no remote executable code
    # is fetched. Vendor files come only from the pinned provenance manifest.
    setup = ('#@title 1. Подготовить приложение\n'
             '#@markdown Первый запуск скачает проверенные PDF/OCR-ресурсы. GPU не нужен.\n'
             + bootstrap + '\n\n'
             + 'from pathlib import Path\n'
             + 'try:\n    from google.colab import output as colab_output\n    IN_COLAB = True\n'
             + 'except ImportError:\n    colab_output = None\n    IN_COLAB = False\n'
             + 'THYROLAB_ROOT = Path("/content/thyrovision_lab") if IN_COLAB else Path.cwd() / "thyrovision_lab_runtime"\n'
             + 'THYROLAB_PAYLOAD_SHA256 = ' + repr(digest) + '\n'
             + 'THYROLAB_PAYLOAD_B64 = """\n' + encoded + '\n"""\n'
             + 'prepared = prepare_app(THYROLAB_PAYLOAD_B64, THYROLAB_PAYLOAD_SHA256, THYROLAB_ROOT)\n'
             + 'print("Готово: проверено ресурсов — {}. Запустите ячейку 2.".format(prepared["verified_assets"]))\n')
    launch = '''
        #@title 2. Открыть приложение: загрузка анализов и расчёт
        #@markdown Интерфейс появится прямо под этой ячейкой. Выберите PDF или фото внутри приложения.
        from IPython.display import display, HTML, IFrame
        if 'prepared' not in globals():
            raise RuntimeError('Сначала выполните ячейку 1 — «Подготовить приложение».')
        if '_thyrolab_server' in globals():
            _thyrolab_server.shutdown()
            _thyrolab_server.server_close()
        _thyrolab_server = start_server(prepared['dist'])
        _thyrolab_port = _thyrolab_server.server_port
        display(HTML('<p><b>Приложение готово.</b> Загрузите бланк, сверьте таблицу, укажите возраст и нажмите «Рассчитать и разобрать».</p>'))
        if IN_COLAB:
            colab_output.serve_kernel_port_as_iframe(
                _thyrolab_port, path='/', width='100%', height=1100,
                cache_in_notebook=False)
        else:
            _thyrolab_url = f'http://127.0.0.1:{_thyrolab_port}/'
            display(HTML(f'<p><a href="{_thyrolab_url}" target="_blank" rel="noopener">Открыть приложение в отдельной вкладке</a></p>'))
            display(IFrame(_thyrolab_url, width='100%', height=1100))
        print('Среда должна оставаться подключённой. После её перезапуска снова выполните ячейки 1 и 2.')
    '''
    research = '''
        #@title 3. Исследовательская модель: пример из тестовой выборки
        #@markdown Это историческая запись датасета с общим Т4. Загруженные анализы в эту модель не передаются.
        example_number = 3 #@param {type:"slider", min:1, max:6, step:1}
        import json, struct, html
        from IPython.display import display, HTML
        if 'prepared' not in globals():
            raise RuntimeError('Сначала выполните ячейку 1.')
        project = Path(prepared['root'])
        model = json.loads((project / 'dist/assets/lab-model.json').read_text())
        examples = json.loads((project / 'results/examples.json').read_text())['examples']
        metrics = json.loads((project / 'results/metrics.json').read_text())
        assert model['usage'] == 'dataset_examples_only'
        assert model['type'] == 'random_forest'
        assert 1 <= int(example_number) <= len(examples)
        example = examples[int(example_number) - 1]
        values = [struct.unpack('f', struct.pack('f', float(example['values'][key])))[0]
                  for key in model['feature_names']]
        scores = [0.0 for _ in model['class_ids']]
        for tree in model['trees']:
            node = 0
            while tree['left'][node] != -1:
                node = (tree['left'][node] if values[tree['feature'][node]] <= tree['threshold'][node]
                        else tree['right'][node])
            for index, value in enumerate(tree['probability'][node]):
                scores[index] += value / len(model['trees'])
        predicted_class = max(range(len(scores)), key=scores.__getitem__)
        assert predicted_class == example['reference_prediction'], 'Прогноз не совпал с сохранённой проверкой.'
        assert max(abs(a-b) for a,b in zip(scores, example['reference_scores'])) < 1e-12
        selected = next(item for item in metrics['models'] if item['selected'])
        escape = html.escape
        score_rows = ''.join(f'<tr><td>{escape(label)}</td><td>{score:.1%}</td></tr>'
                             for label, score in zip(model['class_names'], scores))
        display(HTML(f"""
        <div style="font-family:Arial,sans-serif;padding:20px;border:1px solid #dbe5df;border-radius:14px;max-width:850px">
          <h3 style="margin-top:0;color:#116f67">Random Forest · отложенный пример {int(example_number):02d}</h3>
          <p>TSH: {example['values']['TSH']} · общий T4: {example['values']['TT4']} · T3: {example['values']['T3']}</p>
          <p><b>Прогноз:</b> {escape(model['class_names'][predicted_class])}<br>
             <b>Метка датасета:</b> {escape(model['class_names'][example['true_class_id']])}</p>
          <table style="border-collapse:collapse;width:100%"><tr><th style="text-align:left">Класс</th><th style="text-align:left">Оценка классификатора</th></tr>{score_rows}</table>
          <p>Отложенная выборка: {selected['test_size']} записей · Accuracy {selected['accuracy']:.2%} · F1-macro {selected['f1_macro']:.2%}.</p>
          <p style="font-size:13px;color:#5c6966">Оценки классов не являются клиническим риском. Единицы исходных TSH/TT4/T3 не подтверждены для переноса на произвольный бланк. Метрики относятся к историческим записям, не к распознаванию PDF или фото.</p>
        </div>"""))
    '''
    training = '''
        #@title 4. Необязательно: повторить обучение модели
        #@markdown Для загрузки анализов эта ячейка не нужна. Включайте только для воспроизведения эксперимента.
        retrain_model = False #@param {type:"boolean"}
        if retrain_model:
            import subprocess, sys
            if 'prepared' not in globals():
                raise RuntimeError('Сначала выполните ячейку 1.')
            project = Path(prepared['root'])
            subprocess.run([sys.executable, '-m', 'pip', 'install', '-r',
                            str(project / 'research/requirements.txt')], check=True)
            subprocess.run([sys.executable, str(project / 'research/train_research.py'),
                            '--data', str(project / 'data/thyroidDF.csv'),
                            '--out', str(project / 'reproduced_results')], check=True)
            print('Результаты повторного эксперимента:', project / 'reproduced_results')
        else:
            print('Повторное обучение отключено. Приложение и готовая модель уже доступны.')
    '''
    cells = [
        markdown('''
            # ThyroVision LAB
            ## Загрузка анализов щитовидной железы и расчёт

            **PDF / фото → проверка распознанных показателей → сравнение с референсами → объяснение результата.**

            ### Быстрый запуск

            1. Откройте этот блокнот в Google Colab. Выберите обычную **CPU-среду** — GPU не нужен.
            2. Нажмите **«Среда выполнения → Выполнить все»**. При первом запуске потребуется интернет для загрузки проверенных библиотек распознавания.
            3. Под ячейкой **2** появится приложение. Загрузите бланк, проверьте числа, единицы и референсы, укажите возраст, подтвердите таблицу и нажмите **«Рассчитать и разобрать»**.

            Для первого показа используйте ссылки **«Учебный PDF» / «Фото учебного бланка»** или готовые примеры в интерфейсе. Файлы содержат синтетические значения. Для учебного бланка указан возраст 35 лет.

            **Основной расчёт:** отклонения от лабораторных интервалов и сочетание ТТГ со свободными Т4/Т3. Референсы не выдумываются; отсутствующие данные можно внести вручную. Распознанные числа всегда нужно сверять с бланком.

            **Исследовательская ML-часть:** отдельная модель Random Forest на историческом датасете; демонстрируется на готовых тестовых записях с общим Т4. Она не получает показатели из загруженного вами бланка. Этот прототип не рассчитывает будущий риск заболевания и не назначает лечение.

            ### Данные и время работы

            В этой версии Python-сервер отдаёт только файлы приложения. Содержимое выбранного PDF или фото обрабатывается JavaScript в браузере; оно не отправляется обработчику Python и не записывается в ячейки блокнота. Сохранённый JSON-отчёт остаётся у вас.

            Colab используется для временной интерактивной демонстрации внутри активного блокнота. После отключения среды повторите первые две ячейки. Для обычного локального запуска используйте полный ZIP проекта и `START_WINDOWS.bat`.
        ''', 'intro-lab'),
        code(setup, 'prepare-lab', form=True),
        code(launch, 'open-lab', form=True),
        markdown('''
            ## Учебный эксперимент с машинным обучением

            Следующая ячейка выполняет реальный проход по сохранённым деревьям модели на одной из шести отложенных записей и сверяет результат с эталонным прогнозом. Можно выбрать другой номер примера и запустить ячейку повторно.

            Исходные данные: [HF-зеркало](https://huggingface.co/datasets/anasmakki/thyroid_disease_dataset), [первоисточник UCI Thyroid Disease](https://archive.ics.uci.edu/dataset/102/thyroid+disease). Методика, ограничения, исходный CSV и test-прогнозы распаковываются вместе с приложением. Класс без диагностической пометки не означает подтверждённое здоровье.
        ''', 'research-note'),
        code(research, 'research-example', form=True),
        code(training, 'optional-training', form=True),
        markdown('''
            ## Если что-то не открылось

            - **Ошибка сети в ячейке 1:** выполните её ещё раз. Уже проверенные ресурсы используются повторно; непроверенные файлы не подменяются другими источниками.
            - **Пустая область приложения:** дождитесь подключения среды, затем повторите ячейку 2. В некоторых браузерах ограничения сторонних cookies/iframe могут мешать интерфейсу; готовая локальная версия не зависит от Colab.
            - **После закрытия сессии интерфейс перестал отвечать:** снова запустите первые две ячейки. Здесь нет постоянного сервера и публичного туннеля.
            - **Нечёткое фото или незнакомое название анализа:** исправьте таблицу вручную. Если не хватает референсов, возьмите их с исходного бланка.

            Источники интерпретации: [ATA](https://www.thyroid.org/thyroid-function-tests/), [NICE NG145](https://www.nice.org.uk/guidance/ng145/chapter/recommendations). Лицензии и точные версии PDF/OCR-ресурсов находятся в `dist/assets/vendor`.
        ''', 'help-lab'),
    ]
    notebook = {
        'nbformat': 4, 'nbformat_minor': 5,
        'metadata': {'colab': {'name': DESTINATION.name, 'provenance': []},
                     'kernelspec': {'display_name': 'Python 3', 'name': 'python3'},
                     'language_info': {'name': 'python'}},
        'cells': cells,
    }
    DESTINATION.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({'notebook': str(DESTINATION), 'notebook_bytes': DESTINATION.stat().st_size,
                      'payload_bytes': len(payload), 'payload_sha256': digest,
                      'payload_files': len(included), 'code_cells_compiled': 4}, ensure_ascii=False))


if __name__ == '__main__':
    main()
