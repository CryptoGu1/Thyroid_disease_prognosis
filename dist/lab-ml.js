/* ThyroLab: research-only Random Forest trained on historical dataset-native
 * TSH/total T4/T3 values. Physical units are not documented. The application
 * must invoke this only for packaged dataset examples, never uploaded labs.
 */
(function (root) {
  'use strict';
  let model = null;
  let pending = null;
  async function init() {
    if (model) return model;
    if (!pending) pending = (async () => {
      const response = await fetch('assets/lab-model.json');
      if (!response.ok) throw new Error('Не удалось загрузить исследовательскую модель.');
      const loaded = await response.json();
      if (loaded.usage !== 'dataset_examples_only' || loaded.type !== 'random_forest' || !loaded.trees || !loaded.trees.length) throw new Error('Неверный формат исследовательской модели.');
      model = loaded; return model;
    })().catch(error => { pending = null; throw error; });
    return pending;
  }
  function predict(features) {
    if (!model) throw new Error('Сначала загрузите исследовательскую модель.');
    const row = model.feature_names.map((key, index) => {
      const value = Array.isArray(features) ? features[index] : features && features[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Для примера нужны три измеренных числовых поля: TSH, TT4, T3.');
      return Math.fround(value);
    });
    const probabilities = model.class_ids.map(() => 0);
    for (const tree of model.trees) {
      let node = 0;
      while (tree.left[node] !== -1) node = row[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
      tree.probability[node].forEach((value, index) => { probabilities[index] += value / model.trees.length; });
    }
    const classId = probabilities.indexOf(Math.max(...probabilities));
    return {
      label: model.class_names[classId], classId,
      scores: model.class_names.map((label,index) => ({label, score:probabilities[index]})),
      note: 'Оценка исторического примера датасета, не риск заболевания. Единицы исходных TSH/общего T4/T3 не подтверждены; к загружаемым анализам эта модель не применяется.',
      modelVersion: model.model_version, scope: 'dataset_examples_only'
    };
  }
  const api = Object.freeze({init,predict});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ThyroResearch = api;
})(typeof self !== 'undefined' ? self : this);
