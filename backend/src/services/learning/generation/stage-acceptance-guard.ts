/**
 * not_judgeable 验收越界检测（2026-10-28 从 stage-enrichment 抽出的纯函数）。
 * 词表与判据口径见下方原注释；stage-enrichment 继续 re-export 保持调用方/测试零改动。
 */

/**
 * not_judgeable 验收越界检测（2026-10-26 外部评审悖论/吉他 5 条越界实证）。
 * 词表只抓「要求确认声音/动作属性达标」的判据形态，不抓「描述练习事实 + 自述归因」
 * （「反复出现闷音，判断问题出在指法」是合法自述；「声音清晰无闷响」才是越界达标断言）。
 * 保守优先：误伤的代价只是多一次修复重调，漏检的代价是下游判官永远放水。
 */
const UNJUDGEABLE_ACCEPTANCE_RE = new RegExp(
  [
    '声音清晰', '无闷响', '没有闷音', '不出现闷音', '无杂音', '没有杂音',
    '听不出', '看不出', '录回来听', '录下来听', '回放听',
    '[弹画唱吹跳奏拉]得?(干净|清晰|标准|到位|准确|流畅|均匀|稳定|好听)',
    '(手型|指法|姿势|握拍|握笔|动作|坐姿|站姿)(正确|标准|到位|规范|标准)',
    '逐根拨响', '逐根发声', '都能发声', '都能按响', '能按响', '能拨响',
    '节奏稳', '不抢拍', '不拖拍', '音准',
  ].join('|'),
);

export interface UnjudgeableAcceptanceViolation {
  taskTitle: string;
  acceptanceHint: string;
  matchedTerms: string[];
}

export function detectUnjudgeableAcceptance<T extends Record<string, unknown>>(tasks: T[]): UnjudgeableAcceptanceViolation[] {
  const violations: UnjudgeableAcceptanceViolation[] = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const hint = typeof task?.acceptanceHint === 'string'
      ? task.acceptanceHint
      : typeof task?.acceptanceCriteria === 'string'
        ? String(task.acceptanceCriteria)
        : '';
    if (!hint) continue;
    const matchedTerms = (hint.match(new RegExp(UNJUDGEABLE_ACCEPTANCE_RE.source, 'g')) || [])
      .filter((term, index, all) => all.indexOf(term) === index);
    if (matchedTerms.length > 0) {
      violations.push({
        taskTitle: String(task?.title || ''),
        acceptanceHint: hint,
        matchedTerms,
      });
    }
  }
  return violations;
}
