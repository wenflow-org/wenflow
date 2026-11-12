/**
 * 资料需求来源域（public / private）判定。
 *
 * 背景（2026-10-28 Frontier R1/R2 实证）：goal 在 44–50% 的路径里声明 needsMaterial，
 * 但 F3 私有材料组 26 次联网尝试 0 成功——内部手册/私有协议/本公司字典本就不该走公网检索。
 * 该模块把「要不要联网」从提示词软约束变成确定性分流：
 *   - private → 跳过 material-collector，由 goal 请用户上传附件（或按“用户手上有原文”设计路径）；
 *   - public  → 照旧交给 material-collector 检索/抓取/抽取。
 *
 * 判定优先级：goal 显式给出的 origin（public/private）> 文本启发式 > 默认 public。
 * 默认 public 是保守选择：保留现有检索行为，不因漏标而少采。
 */
import type { MaterialNeed } from '../../skills/material-collector/types';

export type MaterialOrigin = 'public' | 'private';

/** 私有/内部资料的强信号（先于公开信号判断；“公司内部规范”应判 private）。 */
const PRIVATE_PATTERNS = [
  /内部/,
  /自研/,
  /自建/,
  /本公司/,
  /本院/,
  /本实验室/,
  /本厂/,
  /本团队/,
  /私有/,
  /内控/,
  /未刊稿/,
  /无外键/,
  /字典说明/,
  /红皮书/,
  /内部文档/,
  /内部规范/,
  /私有协议/,
  /内部手册/,
  /本公司数据/,
];

/** 公开权威资料的信号（仅在没有私有信号时生效）。 */

/**
 * path 阶段「思考触发」兜底（2026-11-12 实证：goal 对话承诺「都是公开日志能查到的、
 * 不拿编的」却没登记 needsMaterial → 联网采集整链未触发 → 15 节课全靠即兴合成还标"真实"）。
 *
 * goal 声明是主通道（有对话上下文、能问用户私有材料、async 下与规划并行）；
 * 这里是第二道闸：path 拿着全量 goal 文本，声明缺失但文本里出现「真实材料承诺 /
 * 具体文档依赖」信号时，确定性派生采集需求——派生出的 need 走同一条
 * resolveMaterialPacks 链（private 信号照旧被 partitionMaterialNeeds 拦下不联网）。
 * queries 只求方向正确（material-collector 自己有选源与抽取两道模型把关）。
 */
const REAL_PROMISE_RE = /(真实案例|真实记录|真实对话|公开(跑偏|事故|调用|训练)?(记录|日志|复盘)|不拿编的|都是真事)/;
const DOC_DEPENDENCY_RE = /(官方文档|API\s*文档|开发文档|技术规范|白皮书|操作手册|使用指南)/;

/**
 * 研究价值信号（2026-11-12 定调：联网补料是一等公民，模型知识是兜底）：
 * 事实/机制/框架/法规/数据/案例类领域，模型参数记忆要么泛化、要么过期、要么编造——
 * 即使 goal 没承诺「真实材料」，这类路径也应默认带锚点资料。计分 ≥2（有关键阶段时 ≥1）
 * 即派生锚点 need（从 key stages 取主题）。口语/习惯/体能这类纯训练目标不命中信号，零误伤。
 */
const RESEARCH_WORTHINESS_RE = /(机制|原理|框架|工具|平台|模型|算法|法规|法律|标准|规范|政策|经济|金融|心理|医学|历史|行业|数据|统计|案例|事件|版本|API|SDK|技术|科学|市场)/g;

export interface GoalTextSource {
  surfaceGoal?: string | null;
  realProblem?: string | null;
  learningDirection?: string | null;
  keyStages?: string | null;
  /** 关键阶段名列表（锚点 need 的取材对象；与 keyStages 二选一，stages 优先） */
  stages?: string[] | null;
}

export function deriveMaterialNeedsFromGoalText(source: GoalTextSource): MaterialNeed[] {
  const texts = [
    String(source.learningDirection || ''),
    String(source.surfaceGoal || ''),
    String(source.realProblem || ''),
    String(source.keyStages || ''),
    ...(Array.isArray(source.stages) ? source.stages.map((s) => String(s || '')) : []),
  ];
  const corpus = texts.join(' ');
  if (!corpus.trim()) return [];

  // 主题词：surface_goal/learning_direction 里最可能当检索主干的短语（截短去杂）
  const topicRaw = String(source.learningDirection || source.surfaceGoal || source.realProblem || '').trim();
  const topic = topicRaw.replace(/[，。；、,.!？""'']/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ').slice(0, 24);

  const needs: MaterialNeed[] = [];
  if (REAL_PROMISE_RE.test(corpus)) {
    needs.push({
      kind: '公开记录/案例',
      title: topic ? `${topic}：公开记录与案例` : '目标领域的公开记录与案例',
      why: 'goal 文本承诺使用真实/公开记录当学习样本，但 goal 阶段未登记 needsMaterial——不采集就只能即兴合成，违反来源诚实',
      origin: 'public',
      queries: [
        ...(topic ? [topic] : []),
        '案例 复盘',
      ].filter((q): q is string => q.trim().length >= 2).slice(0, 3),
    });
  }
  if (DOC_DEPENDENCY_RE.test(corpus)) {
    const docMatch = corpus.match(DOC_DEPENDENCY_RE);
    needs.push({
      kind: '官方文档',
      title: topic ? `${topic}：${docMatch?.[0]}` : '目标相关官方文档',
      why: 'goal 文本点名依赖官方文档/规范类资料，goal 阶段未登记 needsMaterial',
      origin: 'public',
      queries: [topic, docMatch?.[0] || '官方文档'].filter((q): q is string => q.trim().length >= 2).slice(0, 3),
    });
  }

  // 研究价值闸（Layer 3）：事实/机制/框架类领域默认带锚点资料——即使没有任何承诺信号。
  const worthinessScore = new Set(corpus.match(RESEARCH_WORTHINESS_RE) || []).size;
  const stages = (Array.isArray(source.stages) ? source.stages : []).map((s) => String(s || '').trim()).filter(Boolean);
  const worthCollecting = stages.length > 0 ? worthinessScore >= 1 : worthinessScore >= 2;
  if (worthCollecting) {
    for (const stage of stages.slice(0, 2)) {
      if (needs.length >= 3) break;
      const stageKey = stage.replace(/[，。；、,.!？""'']/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ').slice(0, 14);
      needs.push({
        kind: '领域背景资料',
        title: topic ? `${topic}：${stageKey || stage}` : `${stageKey || '目标领域'}背景资料`,
        why: '研究价值闸：目标属于事实/机制/框架类领域（模型参数记忆易泛化或过期），默认采锚点资料；goal 未显式声明 needsMaterial',
        origin: 'public',
        queries: [stageKey || stage, topic].filter((q): q is string => q.trim().length >= 2).slice(0, 3),
      });
    }
    // 没有可用阶段名时，用主题本身当锚点（保证研究价值闸命中时至少派生 1 条）
    if (needs.length === 0 && topic) {
      needs.push({
        kind: '领域背景资料',
        title: `${topic}：背景与案例资料`,
        why: '研究价值闸：目标属于事实/机制/框架类领域，默认采锚点资料；goal 未显式声明 needsMaterial',
        origin: 'public',
        queries: [topic, '入门 案例'].filter((q): q is string => q.trim().length >= 2).slice(0, 3),
      });
    }
  }

  // 兜底闸上限 3 条（与 MATERIAL_COLLECTION_MAX_NEEDS 对齐）：补漏不是主力，goal 层声明才是主通道
  return needs.slice(0, 3);
}

/** 公开权威资料的信号（仅在没有私有信号时生效）。 */
const PUBLIC_PATTERNS = [
  /法规/,
  /法律/,
  /条例/,
  /准则/,
  /标准/,
  /规范/,
  /指南/,
  /公告/,
  /白皮书/,
  /官方文档/,
  /规范/,
  /国标/,
  /ISO/,
  /IEC/,
  /\bW3C\b/,
  /\bRFC\b/,
  /\bAPI\b/,
  /\bSDK\b/,
  /specification/i,
  /release notes/i,
  /documentation/i,
];

function textOf(need: MaterialNeed | null | undefined): string {
  if (!need || typeof need !== 'object') return '';
  return [need.kind, need.title, need.why, need.publisher, need.version]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

/** goal 显式 origin 优先；否则按文本启发式；都无法判断时默认 public。 */
export function inferMaterialOrigin(need: MaterialNeed | null | undefined): MaterialOrigin {
  const explicit = String(need?.origin || '').trim().toLowerCase();
  if (explicit === 'private') return 'private';
  if (explicit === 'public') return 'public';

  const text = textOf(need);
  if (!text) return 'public';
  if (PRIVATE_PATTERNS.some((pattern) => pattern.test(text))) return 'private';
  if (PUBLIC_PATTERNS.some((pattern) => pattern.test(text))) return 'public';
  return 'public';
}

export function partitionMaterialNeeds(needs: MaterialNeed[]): {
  publicNeeds: MaterialNeed[];
  privateNeeds: MaterialNeed[];
} {
  const publicNeeds: MaterialNeed[] = [];
  const privateNeeds: MaterialNeed[] = [];
  for (const need of needs) {
    if (inferMaterialOrigin(need) === 'private') privateNeeds.push(need);
    else publicNeeds.push(need);
  }
  return { publicNeeds, privateNeeds };
}
