import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';

const mount = document.querySelector('#sheets-import');
let active;

function importTable(model, title) {
  const columns = ['作答單位', '題號', '工作表', '答案格'];
  const rows = model.units.flatMap((unit) => unit.questions.map(({ key, sheetTitle, cell }) => h('tr', null,
    h('td', null, unit.kind === 'GROUP' ? `題組 ${unit.groupCode}` : '單題'),
    h('td', null, key),
    h('td', null, sheetTitle),
    h('td', null, cell),
  )));
  return h('table', null,
    h('caption', null, `${title}（${model.questionCount} 題、${model.unitCount} 個單位）`),
    h('thead', null, h('tr', null, columns.map((column) => h('th', { scope: 'col' }, column)))),
    h('tbody', null, rows),
  );
}

function openImport(activity) {
  const { id } = activity;
  const controller = new AbortController();
  const { signal } = controller;
  const endpoint = `/api/teacher/activities/${encodeURIComponent(id)}/import`;
  const input = h('input', { id: 'spreadsheet-source', autocomplete: 'off', required: true });
  const load = h('button', { type: 'submit' }, '載入工作表');
  const form = h('form', null, h('label', { for: input.id }, 'Google Sheets 網址或 ID'), input, load);
  const available = h('fieldset', { hidden: true }, h('legend', null, '選擇工作表'));
  const choices = h('div');
  available.append(choices);
  const ordered = h('ol');
  const order = h('section', { hidden: true, 'aria-label': '匯入順序' },
    h('h3', null, '匯入順序'), ordered);
  const previewButton = h('button', { type: 'button', hidden: true, disabled: true }, '產生預覽');
  const confirmation = h('div');
  const confirmButton = h('button', { type: 'button', class: 'btn--primary' }, '確認匯入');
  const preview = h('section', { hidden: true, 'aria-label': '匯入預覽' }, confirmation, confirmButton);
  const current = h('section', { 'aria-label': '已確認的匯入' });
  const status = h('p', { class: 'status', role: 'status', hidden: true });
  mount.setAttribute('aria-labelledby', 'sheets-import-heading');
  mount.replaceChildren(
    h('h2', { id: 'sheets-import-heading' }, '線上匯入題目'), form, available, order, previewButton, status, preview, current,
  );

  let sheets = [];
  let spreadsheetId;
  let selection = [];
  let pending;
  let busy = false;
  let liveImportUpdates = 0;

  function showStatus(message, type = '') {
    setText(status, message);
    status.hidden = !message;
    status.className = type ? `status status--${type}` : 'status';
  }

  function updateButtons() {
    input.disabled = busy;
    load.disabled = busy;
    available.disabled = busy;
    previewButton.disabled = busy || selection.length === 0;
    confirmButton.disabled = busy || !pending;
    for (const [index, item] of [...ordered.children].entries()) {
      item.children[0].disabled = busy || index === 0;
      item.children[1].disabled = busy || index === selection.length - 1;
    }
  }

  function clearPreview() {
    pending = null;
    confirmation.replaceChildren();
    preview.hidden = true;
  }

  function moveSheet(index, offset) {
    const destination = index + offset;
    if (busy || destination < 0 || destination >= selection.length) return;
    [selection[index], selection[destination]] = [selection[destination], selection[index]];
    clearPreview();
    renderOrder();
    const buttons = [...ordered.children[destination].children];
    const preferred = buttons[offset < 0 ? 0 : 1];
    (preferred.disabled ? buttons.find((button) => !button.disabled) : preferred)?.focus();
  }

  function renderOrder() {
    order.hidden = selection.length === 0;
    ordered.replaceChildren(...selection.map((sheetId, index) => {
      const title = sheets.find((sheet) => sheet.id === sheetId).title;
      return h('li', null, title, ' ',
        h('button', { type: 'button', 'aria-label': `上移工作表 ${title}`, onclick: () => moveSheet(index, -1) }, '上移'),
        ' ',
        h('button', { type: 'button', 'aria-label': `下移工作表 ${title}`, onclick: () => moveSheet(index, 1) }, '下移'),
      );
    }));
    updateButtons();
  }

  function renderSheetChoices() {
    available.hidden = sheets.length === 0;
    previewButton.hidden = sheets.length === 0;
    choices.replaceChildren(...sheets.map(({ id: sheetId, title }) => {
      const check = h('input', { type: 'checkbox' });
      check.addEventListener('change', () => {
        if (check.checked) selection.push(sheetId);
        else selection = selection.filter((item) => item !== sheetId);
        clearPreview();
        renderOrder();
      });
      return h('label', null, check, ' ', title);
    }));
    renderOrder();
  }

  function renderCurrent(imported) {
    current.replaceChildren(...(imported ? [importTable(imported, '已確認的匯入')] : []));
  }

  async function perform(message, action) {
    if (busy || signal.aborted) return;
    busy = true;
    showStatus(message);
    updateButtons();
    try {
      await action();
    } catch (error) {
      if (!signal.aborted) showStatus(error.message, 'error');
    } finally {
      busy = false;
      if (!signal.aborted) updateButtons();
    }
  }

  const request = (subpath, body) => apiFetch(`${endpoint}${subpath}`, { method: 'POST', body, signal });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearPreview();
    void perform('正在載入 Google Sheets 工作表…', async () => {
      const result = await request('/sheets', { spreadsheet: input.value });
      if (signal.aborted) return;
      spreadsheetId = result.spreadsheetId;
      sheets = result.sheets;
      selection = [];
      renderSheetChoices();
      showStatus(sheets.length ? '請選擇工作表並確認匯入順序。' : '這份試算表沒有可匯入的工作表。');
    });
  });

  input.addEventListener('input', () => {
    sheets = [];
    selection = [];
    clearPreview();
    renderSheetChoices();
    showStatus('');
  });

  previewButton.addEventListener('click', () => {
    clearPreview();
    void perform('正在讀取 Google Sheets 並產生預覽…', async () => {
      const result = await request('/preview', { spreadsheet: spreadsheetId, sheetIds: selection });
      if (signal.aborted) return;
      pending = result.previewId;
      confirmation.replaceChildren(importTable(result.preview, '匯入預覽'));
      preview.hidden = false;
      showStatus('請檢查預覽後確認匯入。');
    });
  });

  confirmButton.addEventListener('click', () => void perform('正在確認匯入…', async () => {
    const previousUpdate = liveImportUpdates;
    const { imported } = await request('/confirm', { previewId: pending });
    if (signal.aborted) return;
    clearPreview();
    if (liveImportUpdates === previousUpdate) renderCurrent(imported);
    showStatus(`已匯入 ${imported.questionCount} 題、${imported.unitCount} 個作答單位。`, 'success');
  }));

  void perform('正在讀取已確認的匯入…', async () => {
    try {
      const { imported } = await apiFetch(endpoint, { signal });
      if (!signal.aborted && liveImportUpdates === 0) renderCurrent(imported);
    } catch (error) {
      if (liveImportUpdates === 0) throw error;
    }
    if (!signal.aborted) showStatus('');
  });

  return { id, controller, updateConfirmedImport(imported) {
    liveImportUpdates += 1;
    renderCurrent(imported);
  } };
}

function showActivity({ detail: activity }) {
  if (activity?.status === 'PREPARING' && active?.id === activity.id) return;
  active?.controller.abort();
  active = null;
  mount.hidden = activity?.status !== 'PREPARING';
  if (mount.hidden) {
    mount.replaceChildren();
    return;
  }
  active = openImport(activity);
}

document.addEventListener('teacher-activity', showActivity);
document.addEventListener('teacher-activity-phase', showActivity);
document.addEventListener('teacher-import-changed', ({ detail }) => {
  if (active?.id === detail.activityId) active.updateConfirmedImport(detail.imported);
});
