/**
 * 「agentId → 用户可读名」映射（**单一来源**）。
 *
 * 为什么抽出来：通知中心（`V2NotifCenter`）与运行时面板（`V2Runtime`）此前各存一份
 * 完全相同的映射表 —— 新增 skill 只补一处、另一处就悄悄回退成兜底名「AI 任务」
 * （走查 N1 实测：`skill:learner-progress-report` 就落在这个坑里）。
 *
 * 约定：
 * - 新增**用户可见**的 skill/agent 时，在这里补一行；
 * - **平台内部** skill 不进表，由后端按 manifest `userVisible: false` 过滤
 *   （如 learner-state-review / concept-consolidator / concept-load-estimator /
 *   replan-attribution / learner-progress-report 已登记为不可见）；
 * - 兜底名刻意**不泄露内部代号**（原样取 `-` 末段会向用户暴露 generator/copy 等内部名）。
 */

export const AGENT_LABEL: Record<string, string> = {
  'skill:path-planning': '生成学习路径',
  'skill:goal-conversation': '目标澄清对话',
  'skill:teaching-turn': '课堂互动处理',
  'skill:peer-reinforcement': '伴学回应',
  'skill:session-wrapup': '生成课后总结',
  'skill:learner-model': '更新学习画像',
  'skill:stage-designer': '设计阶段任务',
  'skill:path-reviewer': '评审路径',
  'skill:kc-mapper': '整理知识组件',
  'skill:teaching-opening-generator': '生成教学开场',
  'path-agent': '路径生成',
  'ai-teaching-agent': '课堂处理',
  'ai-tutor': '伴学回应',
  'system-canary': '系统自检',
  'learner-model-agent': '更新学习画像',
};

/** path-agent 阶段流水 phase → 用户可读的阶段名 */
export const PATH_PHASE_LABEL: Record<string, string> = {
  core: '主结构生成',
  stageDesign: '阶段任务设计',
  started: '启动',
  succeeded: '完成',
  failed: '失败',
};

/** 未登记 agent 的兜底名：不泄露内部代号 */
export const AI_TASK_FALLBACK_LABEL = 'AI 任务';

export function agentLabelOf(agentId: string, phase?: string | null): string {
  if (agentId === 'path-agent') {
    if (phase) return PATH_PHASE_LABEL[phase] ? `路径生成 · ${PATH_PHASE_LABEL[phase]}` : `路径生成 · ${phase}`;
    return '路径生成';
  }
  return AGENT_LABEL[agentId] ?? AI_TASK_FALLBACK_LABEL;
}
