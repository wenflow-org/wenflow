/**
 * 工件生产课检测（2026-11-09 外评「伪 PBL 造表味」结构手术第 1 刀）。
 *
 * 为什么需要：goal→path 的 firstDeliverable/observableResult 契约把「可观测掌握证据」
 * 狭隘成「有名字的文档」，模型于是把清单/卡片/流程图生产当课程排（实证：考研化学微课题
 * 排出「回收错判分子并固化反例边界清单」72 分钟收尾课）。提示词层已改契约语义并禁词，
 * 但散文规则会被模型换皮绕过（「定稿双分支路径」）——这里做确定性拦截：非创作类学科的
 * 任务命中「文书生产」模式时带修复提示重调一次，仍命中放行留痕（不阻塞）。
 *
 * 判据口径：只抓「文书生产」动作（产出/定稿/回写/固化 + 文档名词），
 * 不抓「把文档当输入」的合法引用（「对照原书」「用任务 2 产出的数据分组」）。
 * 保守优先：误伤代价=一次修复重调；漏检代价=学习者花 72 分钟替系统做表。
 */

/** 文书生产模式：生产动词 + 文档名词 的近邻组合，或文档名词 + 生产动词的反向组合 */
const ARTIFACT_PRODUCTION_RE = new RegExp(
  [
    '(产出|整理出?|形成|定稿|回写|汇编|固化|沉淀|输出一?[张份套])[^，。；、！？]{0,14}' +
      '(清单|自查卡|选择卡|口径卡|避坑卡|小抄|决策表|对照表|讲述稿|框架图|一页纸|底表|骨架|核对表|检查表|模板)',
    '(清单|自查卡|选择卡|口径卡|避坑卡|决策表|讲述稿|流程图|决策轴)[^，。；、！？]{0,10}' +
      '(产出|绘制|制定|固化|定稿|回写)',
  ].join('|'),
);

/** 创作类学科信号：目标本身就是作品（代码/文章/方案/攻略等）时工件是合法交付物 */
const CRAFT_SUBJECT_RE = new RegExp(
  [
    '代码', '编程', '爬虫', '网站', '小程序', '应用开发', 'app', 'App', 'APP',
    '文章', '文案', '写作', '论文', '报告', '简历', '方案', '攻略', '作品集',
    '演讲稿', 'PPT', 'ppt', '演示文稿', '视频', '剪辑', '绘画', '插画', '海报', '设计稿',
  ].join('|'),
);

export interface ArtifactTaskViolation {
  taskTitle: string;
  matchedSnippet: string;
}

/**
 * 路径主题是否创作类（工件即目标）。对路径级主题文本做确定性关键词判定；
 * 命中即整个守卫放行（创作类学科排「产出一份攻略」是合法的，不拦）。
 */
export function looksLikeCraftSubject(text: string): boolean {
  if (!text) return false;
  return CRAFT_SUBJECT_RE.test(text);
}

export function detectArtifactProductionTasks<T extends Record<string, unknown>>(tasks: T[]): ArtifactTaskViolation[] {
  const violations: ArtifactTaskViolation[] = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const title = typeof task?.title === 'string' ? task.title : '';
    const description = typeof task?.description === 'string' ? task.description : '';
    const hint = typeof task?.acceptanceHint === 'string'
      ? task.acceptanceHint
      : typeof task?.acceptanceCriteria === 'string'
        ? String(task.acceptanceCriteria)
        : '';
    const haystack = `${title}。${description}。${hint}`;
    const match = ARTIFACT_PRODUCTION_RE.exec(haystack);
    if (match) {
      violations.push({
        taskTitle: title,
        matchedSnippet: match[0].slice(0, 60),
      });
    }
  }
  return violations;
}
