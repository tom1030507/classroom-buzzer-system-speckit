import { badRequest } from '../../lib/errors.js';

const MARKER = /^\{\{Q:([A-Za-z0-9._-]+)(?:\|G:([A-Za-z0-9._-]+))?\}\}$/;
const MARKER_START = /\{\{\s*[qQ](?![A-Za-z])/;

export function cellAddress(rowIndex, columnIndex) {
  let letters = '';
  for (let column = columnIndex + 1; column > 0; column = Math.floor((column - 1) / 26)) {
    letters = String.fromCharCode(65 + (column - 1) % 26) + letters;
  }
  return `${letters}${rowIndex + 1}`;
}

function markerCells(sheet) {
  const cells = [];
  for (const { startRow = 0, startColumn = 0, rowData = [] } of sheet.data ?? []) {
    rowData.forEach((row, rowOffset) => {
      row?.values?.forEach((cell, columnOffset) => {
        const raw = cell?.userEnteredValue?.stringValue;
        if (typeof raw === 'string' && MARKER_START.test(raw)) {
          cells.push({ raw, rowIndex: startRow + rowOffset, columnIndex: startColumn + columnOffset });
        }
      });
    });
  }
  return cells.sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
}

function isMerged(sheet, rowIndex, columnIndex) {
  return (sheet.merges ?? []).some((range) =>
    rowIndex >= (range.startRowIndex ?? 0) && rowIndex < range.endRowIndex &&
    columnIndex >= (range.startColumnIndex ?? 0) && columnIndex < range.endColumnIndex);
}

export function parseSheets(spreadsheetId, sheets) {
  const units = [];
  const grouped = new Map();
  const seen = new Set();
  for (const sheet of sheets) {
    for (const { raw, rowIndex, columnIndex } of markerCells(sheet)) {
      const cell = cellAddress(rowIndex, columnIndex);
      const location = `「${sheet.title}」${cell}`;
      const match = MARKER.exec(raw.trim());
      if (!match) {
        throw badRequest('IMPORT_INVALID_MARKER', `${location} 的題目標記格式無效。`);
      }
      const [, key, groupCode] = match;
      if (seen.has(key)) {
        throw badRequest('IMPORT_DUPLICATE_QUESTION', `${location} 的題號「${key}」重複。`);
      }
      if (isMerged(sheet, rowIndex, columnIndex)) {
        throw badRequest('IMPORT_MERGED_CELL', `${location} 為合併儲存格，請先拆成獨立答案格。`);
      }
      let unit = grouped.get(groupCode);
      if (!unit) {
        unit = { kind: groupCode ? 'GROUP' : 'SINGLE', groupCode: groupCode ?? null, position: units.length + 1, questions: [] };
        units.push(unit);
        if (groupCode) grouped.set(groupCode, unit);
      }
      seen.add(key);
      unit.questions.push({
        key, position: seen.size, positionInUnit: unit.questions.length + 1, sheetId: sheet.id, sheetTitle: sheet.title,
        rowIndex, columnIndex, originalMarker: raw, cell,
      });
    }
  }
  if (seen.size === 0) throw badRequest('IMPORT_NO_QUESTIONS', '選擇的工作表中找不到題目標記。');
  for (const [groupCode, unit] of grouped) {
    if (unit.questions.length < 2) {
      throw badRequest('IMPORT_SINGLE_MEMBER_GROUP', `題組「${groupCode}」需要至少兩道題目。`);
    }
  }
  return { spreadsheetId, questionCount: seen.size, unitCount: units.length, units };
}
