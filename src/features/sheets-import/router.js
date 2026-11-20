import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { badRequest, conflict } from '../../lib/errors.js';
import { getActivity } from '../activity-groups/activities.js';
import { requireMutation, requireTeacher } from '../activity-groups/sessions.js';
import { createSheetsGateway, parseSpreadsheetId } from './gateway.js';
import { parseSheets } from './parser.js';
import { readImport, replaceImport, requirePreparing } from './units.js';

const ROOT = '/teacher/activities/:activityId/import';
const PREVIEW_LIFETIME = 15 * 60 * 1000;
const MAX_PREVIEWS = 100;

function validateSheetIds(value) {
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((id) => Number.isInteger(id) && id >= 0 && id <= 2147483647) ||
      new Set(value).size !== value.length) {
    throw badRequest('INVALID_SHEET_SELECTION', '請選擇需要匯入的工作表，每張工作表只能選擇一次。');
  }
  return value;
}

export function createSheetsImportRouter(deps) {
  const { db, clock } = deps;
  const gateway = deps.sheetsGateway ?? createSheetsGateway({ credentialsFile: deps.config.googleCredentialsFile, clock });
  const router = Router();
  const teacherOnly = requireTeacher(deps);
  const mutation = requireMutation(deps, 'teacher');
  const previews = new Map();

  function prunePreviews(now) {
    for (const [id, entry] of previews) {
      if (entry.expiresAt <= now) previews.delete(id);
    }
  }

  router.get(ROOT, teacherOnly, (req, res) => {
    getActivity(db, req.params.activityId);
    res.json({ imported: readImport(db, req.params.activityId) });
  });

  router.post(`${ROOT}/sheets`, teacherOnly, mutation, async (req, res) => {
    const { activityId } = req.params;
    requirePreparing(db, activityId);
    const spreadsheetId = parseSpreadsheetId(req.body?.spreadsheet);
    const sheets = await gateway.listSheets(spreadsheetId);
    requirePreparing(db, activityId);
    res.json({ spreadsheetId, sheets });
  });

  router.post(`${ROOT}/preview`, teacherOnly, mutation, async (req, res) => {
    const { activityId } = req.params;
    requirePreparing(db, activityId);
    const spreadsheetId = parseSpreadsheetId(req.body?.spreadsheet);
    const sheetIds = validateSheetIds(req.body?.sheetIds);
    const sheets = await gateway.readSheets(spreadsheetId, sheetIds);
    requirePreparing(db, activityId);
    const preview = parseSheets(spreadsheetId, sheets);
    const previewId = randomUUID();
    const now = clock.now().getTime();
    prunePreviews(now);
    if (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
    previews.set(previewId, { activityId, owner: req.teacherSession.tokenHash,
      expiresAt: now + PREVIEW_LIFETIME, preview });
    res.json({ previewId, preview });
  });

  router.post(`${ROOT}/confirm`, teacherOnly, mutation, (req, res) => {
    const { activityId } = req.params;
    prunePreviews(clock.now().getTime());
    const previewId = req.body?.previewId;
    const entry = previews.get(previewId);
    if (!entry || entry.owner !== req.teacherSession.tokenHash || entry.activityId !== activityId) {
      throw conflict('IMPORT_PREVIEW_INVALID', '找不到這場活動的有效預覽，請重新產生預覽。');
    }
    replaceImport(db, activityId, entry.preview);
    previews.delete(previewId);
    res.json({ imported: entry.preview });
  });

  return router;
}
