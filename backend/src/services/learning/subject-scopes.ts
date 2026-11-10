/**
 * 学习范围（Scope）：一条路径「必须覆盖哪些概念」的权威清单。
 *
 * 为什么需要这一层（2026-10-20 实跑复盘）：
 * 路径规划当时的输入只有叙事（故事、痛点、时间预算），`planningHints.conceptRange` 只说了
 * 「几个概念」而不是「哪些概念」，概念是模型从故事里现编的。结果一条「理综做不完」的路径
 * 可以诚实地生成四节「自检/归类/清单」课——结构自洽，但没有一节课在教学科内容。
 *
 * 这里的清单是**范围，不是课程**：它只回答「这门课应该覆盖到哪些实体」，怎么排课由路径规划决定。
 * 策略/元认知不进清单——它们是完成内容任务的方法，应该挂在任务的验收标准上。
 */

export interface ScopeEntry {
  /** 稳定的短 id（进路径绑定用，不随文案变化） */
  id: string;
  /** 学习者能看懂的概念名 */
  label: string;
  /** 文本里真正会出现的短词（2-4 字），用于判断阶段是否点名了这个实体 */
  term: string;
}

export interface SubjectScope {
  /** 范围名，用于日志与提示词 */
  name: string;
  /** 命中条件：考试范围/学科文本 */
  match: RegExp;
  entries: ScopeEntry[];
}

const PHYSICS_MECHANICS: ScopeEntry[] = [
  { id: 'force-analysis', label: '受力分析与受力图', term: '受力' },
  { id: 'friction', label: '摩擦力的方向与大小判定', term: '摩擦力' },
  { id: 'force-composition', label: '力的合成与分解', term: '合力' },
  { id: 'newton-1', label: '牛顿第一定律与惯性', term: '牛顿' },
  { id: 'newton-2', label: '牛顿第二定律', term: '牛顿' },
  { id: 'newton-3', label: '牛顿第三定律', term: '牛顿' },
  { id: 'uniform-accel', label: '匀变速直线运动规律', term: '匀变速' },
  { id: 'motion-graph', label: '运动图像（v-t、x-t）的读法', term: 'v-t' },
  { id: 'projectile', label: '平抛运动', term: '平抛' },
  { id: 'circular', label: '匀速圆周运动与向心力', term: '圆周' },
  { id: 'gravity', label: '万有引力与天体运动', term: '万有引力' },
  { id: 'work-power', label: '功与功率', term: '功率' },
  { id: 'kinetic-theorem', label: '动能定理', term: '动能定理' },
  { id: 'mechanical-energy', label: '机械能守恒定律', term: '机械能' },
  { id: 'momentum-theorem', label: '动量定理', term: '动量定理' },
  { id: 'momentum-conservation', label: '动量守恒定律', term: '动量守恒' },
  { id: 'collision', label: '碰撞与反冲', term: '碰撞' },
  { id: 'shm', label: '简谐运动', term: '简谐' },
];

const DISTRIBUTED_CONSENSUS: ScopeEntry[] = [
  { id: 'cap-tradeoff', label: 'CAP 取舍与一致性级别的选择', term: 'CAP' },
  { id: 'replication', label: '复制与主从同步', term: '复制' },
  { id: 'quorum', label: '多数派与提交规则', term: '多数派' },
  { id: 'term', label: '任期与领导权唯一性', term: '任期' },
  { id: 'log-replication', label: '日志复制与一致性检查', term: '日志' },
  { id: 'linearizability', label: '线性一致性对读写路径的承诺', term: '线性一致性' },
  { id: 'coordination', label: '协调依赖点与伪依赖的识别', term: '协调' },
  { id: 'failure-detection', label: '故障检测与心跳超时', term: '心跳' },
];

/**
 * 现有注册表：刻意收窄，只放能拿准的范围。
 * 匹配不到 → 不启用范围约束（行为与以前一致），绝不拿错误的清单去逼模型。
 */
export const SUBJECT_SCOPES: SubjectScope[] = [
  {
    name: '高中物理·力学',
    match: /(理综|物理|力学|牛顿|受力|动量|机械能)/,
    entries: PHYSICS_MECHANICS,
  },
  {
    name: '分布式一致性',
    match: /(分布式|一致性|共识|raft|zookeeper|etcd|paxos)/i,
    entries: DISTRIBUTED_CONSENSUS,
  },
];

/** 去标点/空白的比较键：概念名允许措辞差异，不允许换对象。 */
export function normalizeScopeText(value: unknown): string {
  let out = '';
  for (const ch of String(value ?? '').toLowerCase()) {
    const code = ch.charCodeAt(0);
    const isCjk = code >= 0x3400 && code <= 0x9fff;
    const isAscii = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (isCjk || isAscii) out += ch;
  }
  return out;
}

/** 从考试范围 / 学科 / 目标文本里解析出范围；命中不了返回 null（保持旧行为）。 */
export function resolveSubjectScope(...texts: Array<string | null | undefined>): SubjectScope | null {
  const haystack = texts.filter(Boolean).join(' ');
  if (!haystack.trim()) return null;
  for (const scope of SUBJECT_SCOPES) {
    if (scope.match.test(haystack)) return scope;
  }
  return null;
}

/** 概念是否落在范围内：双向包含都算命中（「牛顿第二定律」↔「牛顿第二定律与受力分析」）。 */
export function conceptInScope(concept: string, scope: SubjectScope): boolean {
  const target = normalizeScopeText(concept);
  if (!target) return false;
  for (const entry of scope.entries) {
    const key = normalizeScopeText(entry.label);
    if (!key) continue;
    if (target.includes(key) || key.includes(target)) return true;
    // 退化：概念名只写了范围词的一部分（如「动量」），按 2 字以上公共前缀算命中
    if (target.length >= 2 && key.length >= 2 && (key.startsWith(target.slice(0, 2)) || target.startsWith(key.slice(0, 2)))) {
      return true;
    }
  }
  return false;
}

export interface ScopeCoverage {
  total: number;
  inScope: number;
  outOfScope: string[];
}

export function measureScopeCoverage(concepts: string[], scope: SubjectScope): ScopeCoverage {
  const outOfScope: string[] = [];
  let inScope = 0;
  for (const concept of concepts) {
    if (conceptInScope(concept, scope)) inScope += 1;
    else outOfScope.push(concept);
  }
  return { total: concepts.length, inScope, outOfScope };
}

/** 给提示词用的一段人话（列 id + label，要求 coreConcept 从这里选）。 */
export function formatScopeForPrompt(scope: SubjectScope): string {
  return [
    `学习范围（${scope.name}）：本路径必须把这批实体覆盖到位，coreConcept 只能从下列条目里选，`,
    `不得自造范围外的概念；策略/自检/复盘这类方法不进 coreConcept，写进任务的验收标准。`,
    ...scope.entries.map((entry) => `- [${entry.id}] ${entry.label}`),
  ].join('\n');
}
