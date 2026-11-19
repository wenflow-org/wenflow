/**
 * 跨阶段「动作族」重复检测（2026-11-18 外部评审驱动）。
 *
 * 病根：`allPreviousStageTasks` / `previousMilestone.tasks` 已经在载荷里，但
 * path-task-design 仍会把同一动作换个材料再做一遍：阶段 1「在记录里指认四个部件」，
 * 阶段 2 又「在另一段记录里指认四个部件」；阶段 1「抽掉组件看哪里露馅」，阶段 2 又
 * 「两段记录对比缺了哪件」。标题字面相似度不高，`dropCrossStageDuplicates` 的
 * 标题相似度闸抓不到。
 *
 * 这里只做**高精度**的动作族归类：识别/还原、诊断/纠错、设计/映射、论证/产出、
 * 迁移/综合。规则刻意保守——只有「本阶段所有动作族都已被前序阶段用过、且没有引入
 * 任何一个新族」才判重复；只要本阶段新增一个动作族就放行。
 *
 * 命中后由 stage-enrichment 带 `repairHints.actionDiversityFixes` 重调一次，
 * 而不是直接删课（删课会把阶段清空，且用户看不到原因）。
 */

export type ActionFamily = 'identify' | 'diagnose' | 'design' | 'build' | 'produce' | 'transfer';

export interface ActionTaskLike {
  title?: string;
  description?: string;
  acceptanceHint?: string;
}

export interface CrossStageActionRepeatResult {
  repeated: boolean;
  currentFamilies: ActionFamily[];
  previousFamilies: ActionFamily[];
  repeatedFamilies: ActionFamily[];
  previousExamples: string[];
  suggestion: string;
}

const FAMILY_PATTERNS: Array<{ family: ActionFamily; re: RegExp }> = [
  {
    family: 'identify',
    re: /(指认|认出|识别|标出|逐句|逐轮|对上号|找出.{0,16}(哪一(步|句|轮)|哪件|哪条)|说出.{0,16}(哪一(步|句|轮)|是谁|哪件|哪条))/,
  },
  {
    family: 'diagnose',
    re: /(抽掉|拿掉|缺了|缺哪|断在|露馅|失效|为什么.{0,16}(没|不).{0,8}(发现|察觉|知道)|对比.{0,12}(两段|记录|差异)|两段.{0,12}(记录|摆)|差异)/,
  },
  {
    family: 'design',
    re: /(设计|映射|对应到|架构|画.{0,8}图)/,
  },
  {
    // 动手搭：低代码平台里配节点/知识库/插件、跑通一次。与「纸上设计」分开算一个动作族，
    // 否则「写一条改法」和「在平台里搭原型」会被归成同一族，误判成跨阶段复读。
    family: 'build',
    re: /(搭.{0,10}(原型|助手|智能体|流程|工作流)|配置|配成|跑通|接.{0,6}(插件|工具|接口)|创建.{0,8}(知识库|助手|智能体)|建一个.{0,8}(知识库|助手|智能体)|导出.{0,6}轨迹)/,
  },
  {
    family: 'produce',
    re: /(写成|成稿|答辩|汇报|讲述|产出.{0,10}(说明|框架|段落|稿|图)|写.{0,8}(说明|段落|稿|答复|回答))/,
  },
  {
    family: 'transfer',
    re: /(新情形|迁移|综合实战|综合.{0,8}(运用|应用|练习)|自选|真实场景|换一个场景|换一段)/,
  },
];

/** 单条任务命中的动作族（可能不止一个）。 */
export function classifyActionFamilies(task: ActionTaskLike): Set<ActionFamily> {
  const text = [task?.title, task?.description, task?.acceptanceHint]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
  const hit = new Set<ActionFamily>();
  if (!text) return hit;
  for (const { family, re } of FAMILY_PATTERNS) {
    if (re.test(text)) hit.add(family);
  }
  return hit;
}

function collectFamilies(tasks: readonly ActionTaskLike[]): Set<ActionFamily> {
  const all = new Set<ActionFamily>();
  for (const task of tasks) {
    for (const family of classifyActionFamilies(task)) all.add(family);
  }
  return all;
}

/**
 * 判断当前阶段是否只是把前序阶段的动作族重做一遍。
 * - 当前阶段没有命中任何可识别动作族 → 不判（不拿模糊规则误伤）。
 * - 当前阶段引入了至少一个新动作族 → 不判。
 * - 当前阶段全部动作族都被前序用过 → 判重复。
 */
export function detectCrossStageActionRepeat(
  currentTasks: readonly ActionTaskLike[],
  previousTasks: readonly ActionTaskLike[],
): CrossStageActionRepeatResult {
  const currentFamilies = collectFamilies(currentTasks);
  const previousFamilies = collectFamilies(previousTasks);
  const empty: CrossStageActionRepeatResult = {
    repeated: false,
    currentFamilies: [...currentFamilies],
    previousFamilies: [...previousFamilies],
    repeatedFamilies: [],
    previousExamples: [],
    suggestion: '',
  };
  if (currentFamilies.size === 0 || previousFamilies.size === 0) return empty;

  const newFamilies = [...currentFamilies].filter((family) => !previousFamilies.has(family));
  if (newFamilies.length > 0) return empty;

  const repeatedFamilies = [...currentFamilies];
  const repeatedSet = new Set(repeatedFamilies);
  const previousExamples = previousTasks
    .filter((task) => {
      const families = classifyActionFamilies(task);
      return [...families].some((family) => repeatedSet.has(family));
    })
    .map((task) => String(task?.title || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    repeated: true,
    currentFamilies: [...currentFamilies],
    previousFamilies: [...previousFamilies],
    repeatedFamilies,
    previousExamples,
    suggestion: `本阶段动作族 ${repeatedFamilies.join('/')} 已在前序阶段全部出现；必须引入至少一个新动作族（诊断/纠错、设计/映射、搭建/配置、论证/产出、迁移/综合），不能只换材料重做前序动作。`,
  };
}
