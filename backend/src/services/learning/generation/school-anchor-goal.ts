/**
 * 阶段目标锚补齐（2026-09-30 b3 子代理评审驱动）。
 *
 * 实证：锚进定帧层与两层提示词后，milestone goal 的锚遵从率仍只有 ~30%（23 条 goal 仅 7 条含
 * 显式锚节点，教材册次名 0/23）——逐路径方差极大（0/5 到 4/5），说明提示词层遵从是模型抽签，
 * 不是机制。b3 建议上结构层硬约束（generate→校验→定向重生成一次→落账）。
 *
 * 本模块取该建议的确定性最小实现：**不重生成、不改写原句**，只在 goal 缺锚要素时追加一个
 * 括注（「（对照人教版八年级上册第五单元）」/「（期中考前）」）。理由：
 *   · 重生成一次 = 多一次全量规划 LLM 调用，且可能换掉整条路径结构（回归面不可控）；
 *   · goal 是学习者可见字段，原句保留 + 追加锚括注既满足"与课堂对表"又不丢模型的结构判断；
 *   · 补齐与否可精确记账：模型自发引用的比例 vs 机制补齐的比例，都是给后续决策的事实。
 */
import type { PathSchoolAnchor } from './school-anchor';

const EXAM_NODES = ['期末', '期中', '月考', '高考', '中考', '学业水平', '会考', '模拟考', '模考', '单元测', '一轮复习', '二轮复习'];

/** 从锚里取出可追加的括注；已引用或无法构造时返回 null */
export function buildAnchorGoalNote(anchor: PathSchoolAnchor | null, goal: string): string | null {
  if (!anchor) return null;
  const text = String(goal || '');
  const hasExam = EXAM_NODES.some((n) => text.includes(n));
  // 已显式引用册次**或**考试节点 → 不补：模型只要把阶段挂到校内体系上过一次，就不再追加
  if (anchor.textbook) {
    const core = anchor.textbook.replace(/^(人教|北师大|苏教|外研|沪教|湘教|教科|鲁教|粤教|部编)版?/, '');
    const gradeTerm = core.split(/第/)[0];
    if (hasExam || text.includes(anchor.textbook) || text.includes(core) || text.includes(gradeTerm)) return null;
    const examSuffix = !hasExam && anchor.examScope ? `·${pickExamNode(anchor.examScope) || ''}` : '';
    return `（对照${anchor.textbook}${examSuffix}）`;
  }
  if (!hasExam && anchor.examScope) {
    const node = pickExamNode(anchor.examScope);
    if (node) return `（${node}前）`;
  }
  return null;
}

function pickExamNode(examScope: string): string | null {
  for (const n of EXAM_NODES) if (examScope.includes(n)) return n;
  return null;
}
