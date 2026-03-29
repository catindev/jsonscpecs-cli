document.addEventListener('DOMContentLoaded', function () {

  // ── 1. Назначаем id каждому flow-item с аккордеоном ──────────────────────
  //
  // id строится из data-pipeline-id на заголовке (проставляется в _flow.ejs).
  // Если атрибут не задан — пропускаем (якорь не нужен).

  document.querySelectorAll('[data-accordion]').forEach(function (header) {
    var pipelineId = header.dataset.pipelineId;
    if (!pipelineId) return;
    var item = header.closest('.flow-item');
    if (item) item.id = 'pipe-' + pipelineId;
  });

  // ── 2. Аккордеон: открытие/закрытие + hash в URL ─────────────────────────

  document.addEventListener('click', function (e) {
    var header = e.target.closest('[data-accordion]');
    if (!header) return;
    e.stopPropagation();

    var item = header.closest('.flow-item');
    if (!item) return;

    var wasOpen = item.classList.contains('is-open');
    item.classList.toggle('is-open');

    // Обновляем hash: при открытии — ставим якорь, при закрытии — убираем
    var pipelineId = header.dataset.pipelineId;
    if (pipelineId) {
      if (!wasOpen) {
        // Открыли — пишем в hash без прокрутки (replaceState)
        history.replaceState(null, '', '#pipe-' + pipelineId);
      } else {
        // Закрыли — убираем hash если он был наш
        if (location.hash === '#pipe-' + pipelineId) {
          history.replaceState(null, '', location.pathname + location.search);
        }
      }
    }
  });

  // ── 3. Восстановление состояния при загрузке страницы ────────────────────
  //
  // Если в URL есть hash вида #pipe-<id> — раскрываем этот пайплайн
  // и все его родительские аккордеоны, затем скроллим к нему.

  function restoreFromHash(hash) {
    if (!hash || !hash.startsWith('#pipe-')) return;
    var target = document.getElementById(hash.slice(1));
    if (!target) return;

    // Раскрываем сам элемент и всех предков
    var el = target;
    while (el) {
      if (el.classList && el.classList.contains('flow-item')) {
        el.classList.add('is-open');
      }
      el = el.parentElement;
    }

    // Небольшая задержка — дать браузеру отрисовать display:block у вложенных
    setTimeout(function () {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  restoreFromHash(location.hash);

  // ── 4. Реакция на навигацию браузера (forward/back) ──────────────────────

  window.addEventListener('popstate', function () {
    // Сворачиваем все открытые
    document.querySelectorAll('.flow-item.is-open').forEach(function (item) {
      item.classList.remove('is-open');
    });
    restoreFromHash(location.hash);
  });

  // ── 5. Tabs ───────────────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.tab-btn');
    if (!btn) return;
    var tab = btn.dataset.tab;
    if (!tab) return;  // ссылочные табы (nav-ссылки без data-tab) — не трогаем
    var container = btn.closest('.main');

    container.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('tab-btn--active', b.dataset.tab === tab);
    });
    container.querySelectorAll('.tab-pane').forEach(function (p) {
      p.classList.toggle('tab-pane--active', p.id === 'tab-' + tab);
    });
  });

});
