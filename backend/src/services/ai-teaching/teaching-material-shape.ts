/**
 * 课堂材料形状判定（纯函数）：开场/终检/出图三条链都要回答同一个问题——
 * 「这份 taskMaterial 是不是一张带逐格数值的数据表？」
 *
 * 放在独立模块，避免 teaching-session-views（开场落地）与 teaching-visual.service
 * （出图时机）互相 import 形成环。
 */

const TASK_MATERIAL_TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TASK_MATERIAL_NUMERIC_ROW_RE = /(?:^|[\s,，;；\t|])(-?\d+(?:\.\d+)?%?)(?=[\s,，;；\t|]|$)/g;

function nonEmptyLines(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 是否像「表头 + 数据行」或「每行至少两个数字」的数值材料。 */
export function looksLikeNumericTaskMaterial(material: string | null | undefined): boolean {
  const text = String(material || '').trim();
  if (!text) return false;
  const lines = nonEmptyLines(text);
  if (lines.filter((line) => TASK_MATERIAL_TABLE_ROW_RE.test(line)).length >= 2) return true;
  return lines.filter((line) => {
    const numbers = line.match(TASK_MATERIAL_NUMERIC_ROW_RE) || [];
    return numbers.length >= 2;
  }).length >= 2;
}

/**
 * 抽一段可上屏的材料：优先 Markdown 表格，其次「每行多个数字」的数据行，
 * 最后退到前 maxChars 字原文。表/数据行最多 24/20 行，避免把整本手册灌进开场。
 */
export function extractTaskMaterialExcerpt(material: string, maxChars = 1600): string {
  const text = String(material || '').trim();
  if (!text) return '';
  const lines = nonEmptyLines(text);
  const tableRows = lines.filter((line) => TASK_MATERIAL_TABLE_ROW_RE.test(line));
  if (tableRows.length >= 2) return tableRows.slice(0, 24).join('\n').slice(0, maxChars);
  const dataRows = lines.filter((line) => {
    const numbers = line.match(TASK_MATERIAL_NUMERIC_ROW_RE) || [];
    return numbers.length >= 2;
  });
  if (dataRows.length >= 2) return dataRows.slice(0, 20).join('\n').slice(0, maxChars);
  return text.slice(0, maxChars);
}
