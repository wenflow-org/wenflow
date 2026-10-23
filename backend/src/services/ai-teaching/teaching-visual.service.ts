/**
 * 教学配图（课堂内联的生成图）—— owner 口径 2026-09-23：**「图片是一种特殊的文字，放在教学中」**。
 *
 * 三条原则：
 *   ① **文本是唯一真相源**：图由老师给的**文字描述**（`visual.prompt`）生成，prompt 即原文，可回溯；
 *   ② **图内联在课堂消息流里**，像一段文字一样（不是附件区、不是弹窗）；
 *   ③ **文本脱离图也成立**：图只是辅助，`reply` 必须自洽——"不得依赖图片推进"的既有规则不推翻，
 *      只是加一条"允许附图作辅助"（提示词侧有硬规则，这里不重复）。
 *
 * 分工（与全仓纪律一致）：**LLM 只"请求"**（teaching-turn 输出可选 `visual` 块），
 * **代码裁决要不要真的画**——闸门都在这里：
 *   - 开关 `TEACHING_VISUAL_DISABLED=1` → 一律不生成（灰度回滚）；
 *   - 每会话 ≤ `TEACHING_VISUAL_MAX_PER_SESSION`（默认 6）张（单回合天然 ≤1）；
 *   - prompt 过短/空白 → 不生成；
 *   - 同 prompt 本会话已画过 → 不重复生成（不重复计费，2026-09-26）；
 *   - 生成失败/超时 → 只告警，**绝不阻断课堂**（fail-open，与 material-collector 同款）；
 *     瞬时失败（超时/不可用/5xx/空结果）且失败得快 → 有界重试一次（2026-09-26）。
 *
 * 成本提示：单张实测约 12s 且计费，故必须有上限；上限可 env 调。
 */

import { logger } from '../../utils/logger';
import { generateImages } from '../image';
import { ImageError, type ImageErrorCode, type ImageRatio } from '../image/types';
import type { TeachingImage, TeachingSessionMessage } from './TeachingSessionRepository';

/** 老师请求的配图（teaching-turn 输出的可选顶层块 `visual`）。 */
export interface TeachingVisualRequest {
  /** 画面描述（必填）：要画什么，取自当前教学内容的文字 */
  prompt: string;
  /** 图的说明文字（学生可见；可空） */
  caption?: string | null;
  /** 图类型（示意图/插画/对比图…）：仅作 prompt 润色与留痕 */
  kind?: string | null;
}

export type { TeachingImage };

export const DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION = 6;
/**
 * 每个**任务**（= 一个教学会话）的配图上限：owner 口径 2026-09-25 **放开每任务 1 张的限制**——
 * 图该出就出，由外圈每会话上限（6）兜底防失控。设 `TEACHING_VISUAL_MAX_PER_TASK` 可再收紧（回滚用），
 * 0 或负数 = 不限。历史背景：此闸门曾因"提示词挡不住模型自发出图"而代码化为 1；现在改为只拦会话级总量。
 */
export const DEFAULT_TEACHING_VISUAL_MAX_PER_TASK = Number.POSITIVE_INFINITY;
/** 生图超时（毫秒）：实测单张约 12s，给足余量但不无限等。 */
export const DEFAULT_TEACHING_VISUAL_TIMEOUT_MS = 60_000;
/** 画面描述最短长度（太短无信息量，不值得画）。 */
const MIN_VISUAL_PROMPT_CHARS = 6;
const MAX_VISUAL_PROMPT_CHARS = 800;

/** 开关：`TEACHING_VISUAL_DISABLED=1` 时课堂一律不配图（灰度回滚）。 */
export function isTeachingVisualEnabled(): boolean {
  // owner 终审 2026-09-27（设计文档 §九）：扩散生图**停用**——「我没感觉这些图有任何的教育意义」
  // （17 样本实测：语义全在 caption、结构类还会语义反转）。默认关闭；仅显式设
  // TEACHING_VISUAL_ENABLED=1 时启用（实验/回放用，生产不设）。
  return process.env.TEACHING_VISUAL_ENABLED === '1';
}

/** 每会话上限（正整数；非法值回落默认并告警）。 */
export function resolveTeachingVisualMaxPerSession(value = process.env.TEACHING_VISUAL_MAX_PER_SESSION): number {
  if (!value || String(value).trim() === '') return DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`[teaching-visual] TEACHING_VISUAL_MAX_PER_SESSION 无效（${value}），使用默认 ${DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION}`);
    return DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION;
  }
  return parsed;
}

/**
 * 每**任务**上限（**默认不限**；0/负数 = 不限）。一个教学会话 = 一个任务，所以判据就是"本会话已有几张图"。
 * owner 口径 2026-09-25：放开"每任务 1 张"，图该出就出，由每会话上限兜底；env 设正整数可再收紧（回滚用）。
 * 历史背景：闸门因"提示词挡不住模型自发出图（一次 3 张）"而代码化为 1，现仅保留会话级总量控制。
 */
export function resolveTeachingVisualMaxPerTask(value = process.env.TEACHING_VISUAL_MAX_PER_TASK): number {
  if (!value || String(value).trim() === '') return DEFAULT_TEACHING_VISUAL_MAX_PER_TASK;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return Number.POSITIVE_INFINITY;
  return parsed === 0 ? Number.POSITIVE_INFINITY : parsed;
}

/** 课堂里已有的配图数量（用于上限判定）。 */
export function countTeachingVisuals(messages: TeachingSessionMessage[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message) => sum + (Array.isArray(message?.images) ? message.images.length : 0), 0);
}

/**
 * 组最终生图 prompt：**风格前缀 + 老师的描述**。
 * owner 口径 2026-09-24：图是"特殊的文字字符"——它呈现教学内容的**抽象关系**，但**不以文字形态出现**。
 * 实测（doc/re_test/img-audit）：生图模型图内中文必坏（6 处标注 6 处乱码），故硬禁图内文字；
 * 说明职责交给图下方 caption/reply（真实文本渠道）。
 */
export function composeTeachingVisualPrompt(request: TeachingVisualRequest): string {
  const kind = String(request?.kind || '').trim();
  const subject = String(request?.prompt || '').trim().slice(0, MAX_VISUAL_PROMPT_CHARS);
  const style = [
    '教学示意图（课堂辅助用）',
    kind ? `类型：${kind}` : null,
    '要求：简洁、线条清晰、结构明确，只画描述里说的内容；不要多余的装饰与无关文字',
    '画面里不要出现任何文字：不要标签、不要对话气泡、不要表格与编号；要说明的内容由图下方的说明文字承担，至多保留极少量数字符号',
    '画关系不画故事：画面呈现的是顺序/层级/包含/对比/变化这类抽象关系；状态差异要画出可见区别（如满/半、开/合）',
    '构图：横向关系用横向构图，纵向层级用纵向构图，画面留白充足',
  ].filter(Boolean).join('；');
  // 收尾再钉一次"无字"：老师的描述里常自带"标注××"类要求，放在末尾压过它（图像模型对尾部指令权重高）
  return `${style}。画面内容：${subject}。再次强调：画面内不出现文字与标注，只画图形与关系。`;
}

/**
 * 教学配图规格：`kind`/`prompt` → **精确尺寸（主）+ 同向 ratio（兜底）**（代码裁决，不让模型自选）。
 *
 * 实测矩阵（本仓网关 = 自建 new-api，`IMAGE_API_URL`）：
 * - 精确尺寸（`1312x736`）：**透传开/关都生效**（`1024x768`→就近档位 1152x864）；
 * - 文档写法 `size:'1K' + ratio`：透传开启后生效，但 **`2K` + ratio 不生效**（回 2048x2048 方图）；
 * - `size` 与 `ratio` **冲突时 size 胜**（`1312x736`+`ratio:3:4` → 仍 1312x736）。
 * 故以精确尺寸为准、同向 ratio 作兜底：既确定，又能在"网关忽略精确尺寸"时靠 ratio 兜住。
 *
 * 默认 1:1；横向结构（位置线/流程/时间轴）给 16:9——否则信息被压扁。
 * 判据同时看 `kind` 与 `prompt`：**实测老师常把 kind 写成笼统的"示意图"**，方向线索其实在 prompt 里
 * （提示词已要求横向关系在 prompt 里注明"横向构图"）。未命中回落 1:1，绝不抛错。
 */
export function resolveTeachingVisualSpec(
  kind?: string | null,
  prompt?: string | null
): { size: string; ratio: ImageRatio } {
  const text = `${String(kind || '')} ${String(prompt || '')}`;
  // 显式方向优先（提示词已要求横向关系在 prompt 里注明"横向构图"）；
  // 弱词（竖直/层级）**不作强信号**——实测"用一条竖直虚线标出间隔距离"会把横向位置线误判成纵向。
  if (/横向|水平|横着|从左到右|从左往右/.test(text)) return { size: '1312x736', ratio: '16:9' };
  if (/纵向|垂直|剖面|树形|自上而下|从上到下/.test(text)) return { size: '864x1152', ratio: '3:4' };
  if (/流程|时序|时间轴|位置|过程|循环|链条|步骤|线路|方向/.test(text)) {
    return { size: '1312x736', ratio: '16:9' };
  }
  if (/对比|对照|并列|比较/.test(text)) return { size: '1152x864', ratio: '4:3' };
  if (/层级|结构|装配|组织|分类/.test(text)) return { size: '864x1152', ratio: '3:4' };
  return { size: '1024x1024', ratio: '1:1' };
}

/** 描述是否值得画（空白/过短直接不画）。 */
export function isUsableVisualPrompt(request: TeachingVisualRequest | null | undefined): boolean {
  const text = String(request?.prompt || '').trim();
  return text.length >= MIN_VISUAL_PROMPT_CHARS;
}

/**
 * 回复是否在同轮布置了「由学生自己排出/画出该结构」的练习——此时配图 = 把答案先画给学生（答案泄漏）。
 *
 * 为什么代码化（2026-09-24 配图审计，doc/re_test/img-audit）：提示词例外句实测压不过"配图时机"信号
 * （同一 payload 三次重放均仍出图），与 maxPerTask"提示词会被忽略→代码硬闸门"同思路。
 * 判据刻意收紧（请你在纸上/把它排成/动手排这类明确指令），只拦真泄漏；宁漏不误——少配一张图无害。
 */
const EXERCISE_LEAK_PATTERNS: RegExp[] = [
  /请你在(纸上|这里|下面)[^。！？\n]{0,24}(排|画|摆|写)/,
  /请你(把|将)(它|这些|上面|刚才)[^。！？\n]{0,12}(排|画|摆)(一|成|出)/,
  /在(纸上|草稿上)[^。！？\n]{0,24}(排|画|摆)(一|成|出|个)/,
  /(你|先|来|动手|自己)(排|画|摆)一(排|遍|下|个)/,
  /横着排(一|一遍)/,
  // 2026-10-23 外部视觉评审：送审三张泄漏率 100%，都是「老师让学生产出 → 图里已有现成答案」。
  // 下面只拦「具体交付物」指令（填表/补全/写一句/贴结果），普通的苏格拉底追问不在此列。
  /(填|补全|补齐)(一下|这|那张|表|表格|格子|空|完)/,
  /(贴出|贴一下|贴上来|写出结果|写出完整|写完整|写一句|用一句话)/,
  /(跑一遍|跑一下|跑三行|运行一下)[^。！？\n]{0,14}(结果|打印|输出|贴)/,
  /(先|你)[^。！？\n]{0,4}(自己)?(写|填|答|做|跑)[^。！？\n]{0,8}(再|然后|之后|给我看)/,
  /(捏成|写成|凑成)[^。！？\n]{0,12}(完整|解释句|一句话|整句)/,
];

export function detectExerciseLeakInReply(reply: string | null | undefined): boolean {
  const text = String(reply ?? '');
  if (!text) return false;
  return EXERCISE_LEAK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 指向「图」的显式引用（A/B 报告 D10，2026-10-13）：回复里出现"（见图）/（如下图）/我画了一个结构示意"
 * 这类指向本轮附图的指引，但消息实际不带任何图（images/diagrams/figures 全空）→ 学生看到的是一句指向虚空的话。
 *
 * 判据取紧（宁漏不误，只剥真悬空）：① 括号里的图指引（见图/如下图/详见下图…）；
 * ② 第一人称"我（给你）画了…图/示意"的落笔声称——只认"我…画了"，不碰祈使句
 * （"你可以画一张""自己画一条"是布置练习，不是声称已画）。
 */
const DANGLING_FIGURE_PARENTHETICAL = /[（(]\s*(?:详见|参见|见|如|如下图|见下图)?\s*(?:上|下|左|右|本)?图(?:示|解|表)?\s*[）)]/g;
const DANGLING_FIGURE_CLAIM = /我(?:给(?:你|您))?画(?:了|好|上)(?:[一二两三四五几]|张|幅|个)?[^，。；！？\n]{0,8}?(?:示意图|结构图|结构示意|示意图|图|示意)/g;

/** 回复里是否存在指向「本轮并不存在的图」的悬空引用。 */
export function hasDanglingFigureReference(reply: string | null | undefined): boolean {
  const text = String(reply ?? '');
  if (!text) return false;
  DANGLING_FIGURE_PARENTHETICAL.lastIndex = 0;
  DANGLING_FIGURE_CLAIM.lastIndex = 0;
  return DANGLING_FIGURE_PARENTHETICAL.test(text) || DANGLING_FIGURE_CLAIM.test(text);
}

/**
 * 剥离指向「不存在的图」的悬空引用，并清理删除括号后遗留的空标点/多余空格。
 * 仅在消息确认不带图时调用（见 teaching-turn-engine 调用点）。
 */
export function stripDanglingFigureReferences(reply: string | null | undefined): string {
  const text = String(reply ?? '');
  if (!text) return text;
  return text
    .replace(DANGLING_FIGURE_PARENTHETICAL, '')
    .replace(DANGLING_FIGURE_CLAIM, '')
    .replace(/\s+([，。；！？、：])/g, '$1')
    .replace(/([，。；！？、：])\1+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** ASCII 结构图特征字符：箭头 / 方框 / 圆点 / 长横线 —— 老师"用字符硬画结构"的痕迹。 */
const ASCII_STRUCTURE_CHARS = /[→←↑↓─━│┃┌┐└┘├┤┬┴┼●○■□▲▼◆◇]/g;

/**
 * 老师是否在本轮回复里**用字符画结构**（ASCII 示意）。
 *
 * 这是"这里本来需要一张图"的**高精度可观测信号**（2026-09-23 实测：小学"位置线"课上，
 * 老师画出了 `甲（前）●———→ 方向 →`、`┌────┬───────┬───────┐`、`（前面）小明 → 走的方向 → （后面）小红`
 * 这类字符图，却不会主动请求 `visual`）。
 *
 * 判据：结构字符 **≥2 个**即视为"在摆结构"——单个箭头出现在行文里（"甲→乙"）不算；
 * 而位置线/链条/方框/流程都会 ≥2。（首版要求"≥3 个且≥2 种"，实测漏掉了 `A → … → B` 这种纯箭头结构。）
 */
export function detectAsciiStructure(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  if (!value) return false;
  const hits = value.match(ASCII_STRUCTURE_CHARS) || [];
  return hits.length >= 2;
}

/** 本轮"结构图/配图时机"信号（喂给教学回合的**显式**输入，见 buildVisualOpportunity 注释）。 */
export interface VisualOpportunity {
  suggested: true;
  reason: 'ascii-structure' | 'position-description' | 'time-order' | 'structure-content' | 'task-structure' | 'recap-cadence';
  /** 编排层建议的图型（模型可改）；只用于事后追溯「代码想让它画什么」 */
  kindHint?: string | null;
  /** 代码判据的一句话理由（如「两边差的不是条目，是请求要跳几跳」） */
  ruleWhy?: string | null;
  /** 命中的原文片段：证明「为什么这一轮被判为出图时机」，不是让模型自述 */
  matched?: string[];
  /** 给模型的**显式、正向**要求 */
  instruction: string;
}

/**
 * 结构内容线索（2026-10-18 扩图型）：老师上一轮在讲**二维/多对多/象限**关系。
 *
 * 为什么需要这个信号：位置线的触发器（学生描述空间关系）只覆盖追及题那一类；
 * 对账、归类、象限、多对多这些课型本来就需要图，但模型不会主动请求 `figure`。
 * 判据取"≥1 个结构词 + 回复有实质长度"——宁可多给一次机会让模型自己判断，
 * 也不要整节课一张图都不出；总量仍由每会话上限兜底。
 */
const STRUCTURE_CUE = /(对比|对照|区别|区分|归类|分类|矩阵|象限|两个维度|两维|多对多|一一对应|一对多|映射|对账|归位|两栏|两大|两边|两层|一层|分层|命中|重复|堆砌|棋盘|走法|信度|效度|四类|三类|两类|两列|成对|配对)/g;

export function detectStructuralCue(text: string | null | undefined, minCues = 2): boolean {
  const value = String(text ?? '');
  if (!value) return false;
  // **默认 ≥2 种**结构词才算（单个「对比」在日常讲解里太常见）；
  // 任务标题/描述可以传 minCues=1——任务本身只讲一件事，一个结构词就足以定性。
  const hits = value.match(STRUCTURE_CUE) || [];
  return new Set(hits).size >= Math.max(1, minCues);
}

/**
 * 学科 → 调色板：服务端按学习路径的 subject 盖章。
 * 只影响观感（色相与材质），不改变几何与语义；判据取「讲的是什么」，不取界面语言。
 */
const SUBJECT_PALETTES: Array<{ test: RegExp; palette: 'earth' | 'violet' | 'warm' | 'tech' }> = [
  { test: /地理|区位|气候|地形|水文|人口迁移|城市|农业|工业区/, palette: 'earth' },
  { test: /心理|教育|动机|信度|效度|学习理论|认知|发展/, palette: 'violet' },
  { test: /象棋|围棋|棋盘|古文|诗词|写作|语言|幼儿园|五大领域/, palette: 'warm' },
  { test: /代码|程序|算法|数据库|共识|分布式|日志|系统|网络|前端|后端|并发|张量|模型/, palette: 'tech' },
];

export function paletteOfSubject(subject?: string | null): 'indigo' | 'earth' | 'tech' | 'warm' | 'violet' | 'mono' {
  const text = String(subject ?? '');
  for (const entry of SUBJECT_PALETTES) {
    if (entry.test.test(text)) return entry.palette;
  }
  return 'indigo';
}

/** 图型选择表 + spec 形状：只在"该出图"的回合随 visualOpportunity 送进 prompt。
 * 不常驻 system prompt（避免每轮都付这段 token）；字段上限与 normalizeFigure 的 SPEC 一致。
 */
const FIGURE_KIND_GUIDE = [
  '（系统提示里若是旧版"v1 唯一图型 position-line"，以本轮为准：下列 kind 代码已支持并会逐字段校验。）',
  '**出图前先过三关（缺一不出）**：① 实体关——节点/标签必须是学科实体（真实代码、方程各项、数值与单位、时间点/事件、对象/要素），'
  + '出现「第一步/自查/缺X/重写/评分/口诀/批改」这类元认知或评语，整张作废；② 几何关——关系必须由位置/数值/区间/连线/包含读出来'
  + '（谁比谁大、谁指向谁、谁在谁里面），两栏文字也能说清就不画；③ 留白关——本轮让学生产出 X（句子/步骤/分类/判断）时，'
  + '图里不得出现完整的 X，只给 "?" 或空槽。',
  '若确实该出图，按关系选 kind（最多 8 行/6 列、8 个条目；标签用学科实指，≤18 字）：',
  '- bins：**归属/分类**（这些条目各归哪一堆）。{"bins":[{"label":"自然条件","tone":"ok","items":["水源","地形"]},{"label":"社会经济条件","items":["交通"]}],"note":"…"}——条目画在容器**里面**，表达「属于」，比两列并排更贴切。',
  '- grid：二维排布、每格是内容（比较表）。{"rows":2,"cols":3,"rowLabels":["…"],"colLabels":["…"],"cells":[{"r":0,"c":0,"text":"…","hl":"accent|warn|ok"}],"note":"…"}——**已有内容**的表才画，等待学生填写的空表不画（那是练习控件）。',
  '- matrix：二维命中矩阵（✓有/—无/叠=重复堆砌/≡两边同一项）。{"rowLabels":["…"],"colLabels":["…"],"cells":[{"r":0,"c":1,"tone":"hit|miss|dup|key"}],"legend":[{"text":"✓ 已写到","fill":"#e6f4f1"}]}',
  '- range-bar：**多组数值区间并排**（新组/旧组的波动范围、上下限、从哪到哪）。{"unit":"%","rows":[{"label":"新组四天","from":3.1,"to":3.8,"tone":"accent"},{"label":"旧组四天","from":2.9,"to":3.6,"tone":"neutral"}],"marks":[{"at":0.5,"label":"汇报的均值差"}],"note":"…"}——**数值区间不要塞进 position-line**：一根时间轴画不出带宽，把「幅度」横着放会被读成日期跨度。',
  '- **想用 compare 但两侧只是句子**：改成 grid（判断点做行、两边做列）；没有共同判断点就不要画（2026-10-23 起纯两栏会被丢弃）。',
  '- **变量名/引用/拷贝**：用 bipartite，左列变量名、右列内存对象，edges 表示指向；`b = a` 是两条边汇到同一个对象节点，`a[:]` 是外层两个节点、内层同一节点。',
  '- **同一组时刻上的两个方向/两组数**：用 grid，行是时刻、列是方向，格子写数值；不要用两根时间轴或两栏条目。',
  '- compare：两条分支并排对照（**对等**的两边），**必须至少一侧带 chain**（纯两栏条目会被代码丢弃，2026-10-23 起）。卡片形态：{"left":{"head":"…","sub":"…","items":["…"]},"right":{"head":"…","items":["…"]},"divider":"…","leftTone":"neutral","rightTone":"accent"}',
  '- **compare 的链路形态（架构/请求路径类对比必须用它，2026-10-20 实跑）**：当差别是「几跳」「几次跨集群往返」时，不要只给两栏条目——把每侧的请求链路写进 chain，渲染器会画出客户端、集群边界与穿过边界的箭头，**箭头数就是跳数**。{"left":{"head":"外置协调","badge":"2 套集群 · 2 次独立共识","badgeTone":"warn","client":"客户端","chain":[{"label":"共识 ①：ZooKeeper 集群","sub":"定路由、选主","tone":"warn"},{"label":"共识 ②：业务存储节点","sub":"写日志与数据","tone":"warn"}],"items":["两份结论必须互相迁就"]},"right":{"head":"内置共识","badge":"单一系统 · 1 次共识","badgeTone":"ok","client":"客户端","chain":[{"label":"业务进程内置 Raft 状态机","sub":"元数据与数据落同一条日志","merged":true,"tone":"ok"}],"items":["省掉一次跨集群往返"]}}。**顺序段与往返**：若请求是一段接一段（网关→订单→库存，都在同一个集群内），**第二张卡起默认就是串联**（渲染器把缺省的 `from` 当作上一张卡，2026-10-22 起）；只有真正的并行扇出（一个请求同时打到多个节点）才写 `"from":"client"`。第一张卡才跨集群。要强调「发出去还要等回话」，给该节点 `"rtt":true`，箭头上会出现反向箭头。**铁律**：①链上必须至少两层实体（客户端 → 组件 → 组件），不许把两边各写成三行文字；②「省掉/差异」只能体现在链的条数与 merged 节点上，不要靠中间悬浮一句话；③badge 是这一栏的结论，贴在栏头，不要写进正文；④同一进程内的请求/响应链（前端回调、网关→服务）给每一侧 `boundaryLabel`（如「组件异步边界」），否则边界会显示成「集群边界」。',
  '- balance：**权衡/取舍**（两边各自压多少）。{"left":{"head":"补角度","weight":3,"items":["…"]},"right":{"head":"练落地","weight":5,"items":["…"]},"pivotLabel":"时间预算"}——倾斜方向由代码按 weight 算，你只给数（0~10）。',
  '- ladder：**层级/先后/进度**（先到哪、再到哪）。{"steps":[{"label":"定角度","state":"done"},{"label":"落材料","state":"done"},{"label":"扣设问","state":"current"},{"label":"排层次","state":"todo"}]}',
  '- quadrant：2×2（四格顺序：左上、右上、左下、右下）。{"colLabels":["左","右"],"rowLabels":[{"label":"上","sub":"…"},{"label":"下"}],"cells":[{"title":"…","body":["…"],"tone":"ok|warn|neutral"}]}',
  '- bipartite：左右两列 + 连线（多对多映射）。{"left":{"head":"…","nodes":[{"id":"a","label":"…"}]},"right":{"head":"…","nodes":[{"id":"x","label":"…"}]},"edges":[{"from":"a","to":"x"}]}——一条建议挂两个目标就是两条线；**次要/附带的连接加 "dash":"4 3"（虚线）**，渲染器会自动补图例，别把主次写成同一根实线。',
  '- cycle：**首尾相接的闭环**（一轮结束要回到起点）。{"center":"每一轮都回到同一个问题","nodes":[{"label":"驱动问题","sub":"为什么非做不可"},{"label":"持续探究"},{"label":"公开产出","sub":"?"}]}——3~6 个节点；说不出来的一格写 "?"。',
  '- tree：**一个上位概念长出哪些下位**（派生/分类体系）。{"root":{"label":"五大领域"},"branches":[{"label":"健康","items":["易混：社会"]},{"label":"语言","items":["?"]}]}——2~6 个分支、每支最多两条要点。',
  '- venn：**两个概念的重叠与独有**（易混/边界）。{"left":{"head":"社会","items":["轮流收玩具"]},"right":{"head":"科学","items":["按属性分类"]},"overlap":{"head":"两边都算","items":["按同一规则排"]}}',
  '- bullseye：**稳不稳 × 准不准**这类"点落在哪儿"的几何问题（信度/效度、误差分布、命中集中度）。{"colLabels":["高效度","低效度"],"rowLabels":[{"label":"高信度","sub":"每次一致"},{"label":"低信度"}],"cells":[{"title":"稳且准","tone":"ok","dots":[[0.05,0.08],[-0.08,0.02]]},…]}——**四格必须齐**；dots 取 [-1,1]，(0,0)=靶心。',
  '- board：中国象棋（col 0-8 左→右，rank 0-9 上→下；大写黑方、小写红方：R车 N马 B象 A士 K将 C炮 P卒）。{"pieces":[{"col":4,"rank":9,"key":"K"}],"arrows":[{"a1":{"col":4,"rank":9},"a2":{"col":4,"rank":7},"label":"进一"}]}',
  '- position-line：只有**一维的先后/远近**才用（顶层 axis/marks/spans/guides/group，不用 spec）。'
  + '**spans 只表示区间/距离**（「相距 40 米」「从第 1 题到第 3 题」）。若你要说的是「这几道题是同一类」，'
  + '用 `group`：{"from":1,"to":3,"label":"同一个毛病：方向没跟已知条件对"}——画成花括号（归在一起）；'
  + '用区间线表达同一性会被读成跨度，把同一句标签在每点下重复一遍又会被读成「重复的题」，两种都别用。',
  '可选 `focus` 指出本轮该看哪里（只填位置，不要填颜色）：grid/matrix 用 {"row":0} 或 {"col":1}；compare 用 "left"/"right"；bins 用下标数字；ladder 用下标数字。',
  '同一节课同一种图最多 3 张：第 4 次请换一种形状表达，或者干脆用文字——反复摆同一张图，学生会以为老师在重复同一件事。',
  '纯流程、层级、时序用 diagram（mermaid）。但**内容本质是表**时（多个条目 × 多个维度/栏目，或一格一格判断命中/漏/重复）**必须**用 grid/matrix：',
  'mermaid 会把它压成树，丢掉「哪一格」这个信息——学生看不出自己在哪一个格子上判断错了。',
  '图里不要写出本轮要学生自己产出的答案；reply 脱离图也必须成立。',
  '**留白槽位**：课上用来让学生自己填的那一格/那一支，label 写 "?"（渲染成虚线待填），不要把答案先填上。',
  '**不要用 grid 代替有专属形状的关系**：能画成闭环/辐射/交集/靶盘/二分连线的，画成一个表格等于把几何信息丢回文字。',
].join('\n');

/**
 * 学生用文字描述**空间位置关系**的语言特征（位置/方向/距离/先后）。
 * 判据：≥2 种特征词、或 ≥3 处命中——单个「后面」这种日常用词不算（宁漏不误）。
 */
const POSITION_LANGUAGE = /(相距|追及|追上|相遇|同向|相向|背向|在前|在后|前面|后面|左边|右边|左侧|右侧|左端|右端|往右|往左|向东|向西|向南|向北|速度差|先出发|位置线|起点|终点)/g;

export function detectPositionDescription(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  if (!value) return false;
  const hits = value.match(POSITION_LANGUAGE) || [];
  return new Set(hits).size >= 2 || hits.length >= 3;
}

/**
 * 时间先后线索（2026-10-21 实跑补齐）：竞态/时序课的「位置线」其实是**时间轴**。
 * 学生的描述里通常一个空间词都没有，只有「先发 / 后至 / 返回 / 覆盖」这类动词——
 * 只认空间词的旧判据在这里永远打不响，最后只能靠 recap 兜底收图。
 */
const TIME_ORDER_LANGUAGE = /(先发|后至|先后|晚到|早到|返回|回来|响应|发出|发出去|发的时候|时间轴|毫秒|时序|并发|同时发出|覆盖|延迟|时刻|写回|过期|先到|后到)/g;

/** 命中的原文片段（去重、限量）——用于事后回答「为什么这一轮被判为出图时机」。 */
export function matchCues(text: string | null | undefined, pattern: RegExp): string[] {
  const hits = String(text ?? '').match(pattern) || [];
  return [...new Set(hits)].slice(0, 6);
}

export function matchPositionCues(text: string | null | undefined): string[] {
  const hits = String(text ?? '').match(POSITION_LANGUAGE) || [];
  const unique = [...new Set(hits)];
  return unique.length >= 2 || hits.length >= 3 ? unique.slice(0, 6) : [];
}

export function matchTimeOrderCues(text: string | null | undefined): string[] {
  const hits = String(text ?? '').match(TIME_ORDER_LANGUAGE) || [];
  const unique = [...new Set(hits)];
  return unique.length >= 2 || hits.length >= 3 ? unique.slice(0, 6) : [];
}

export function matchStructureCues(text: string | null | undefined): string[] {
  return matchCues(text, STRUCTURE_CUE);
}

export function matchAsciiCues(text: string | null | undefined): string[] {
  return matchCues(text, ASCII_STRUCTURE_CHARS);
}

/**
 * 视觉教具路由（2026-10-20）：把「该画成什么形状」从模型的自由发挥变成代码裁决。
 *
 * 为什么需要：提示词里给了十几种 kind，模型默认永远挑 grid（白框填字）——
 * 用户点名的典型：信度×效度本该画 4 个靶盘，结果画了 4 个写字的方框；
 * 「一条建议服务两个目标」本该画二分连线，结果画成打勾矩阵。
 * 这里只做**建议**（写进本轮输入），真正的白名单与字段校验仍在 teaching-turn。
 */
export type FigureKindHint =
  | 'bullseye'
  | 'cycle'
  | 'bipartite'
  | 'venn'
  | 'tree'
  | 'balance'
  | 'ladder'
  | 'bins'
  | 'matrix'
  | 'compare'
  | 'grid'
  | 'range-bar';

interface KindRule {
  kind: FigureKindHint;
  test: RegExp;
  why: string;
}

/**
 * 顺序即优先级：先判「有专属几何原型」的（靶盘/闭环/交集/二分/辐射），
 * 再判容器/权衡/层级，最后才是矩阵与对照表——越靠后越接近「表格也能画」。
 */
const KIND_RULES: readonly KindRule[] = [
  { kind: 'bullseye', test: /(信度|效度|稳不稳|准不准|打偏|靶心|误差分布|系统性偏差|每次都一致|忽高忽低)/, why: '稳不准是两个几何量，点聚不聚、偏不偏要一眼看出来' },
  { kind: 'cycle', test: /(闭环|回到起点|每一轮|迭代|循环|反馈回路|下一段.{0,6}前提|前置条件|一轮结束)/, why: '走完要回到起点，是环不是列' },
  { kind: 'venn', test: /(易混|分不清|分不开|重叠|边界|两边都算|交集|既有.{0,6}又有|既.{0,4}又)/, why: '要看出重叠与各自独有，并排两栏会把重叠吃掉' },
  { kind: 'bipartite', test: /(多对多|一对多|同时服务|同时满足|连线|映射|一一对应|对应关系|配对|交叉关系)/, why: '一条对应多条，交叉连线本身是信息' },
  { kind: 'tree', test: /(五大领域|分类体系|子领域|子类|派生|词根|上位|下位|包含关系|长成|分为几大类|三层结构)/, why: '一个上位概念长出一层下位，是派生不是并列' },
  { kind: 'balance', test: /(取舍|权衡|哪边更重|压得住|孰轻孰重|代价|成本与收益|两难|牺牲)/, why: '两边各自的分量，靠倾斜方向表达' },
  { kind: 'ladder', test: /(门槛|阶梯|逐级|先从.{0,12}再到|一级一级|递进)/, why: '先后与层级，位置本身就是信息' },
  { kind: 'bins', test: /(归类|归位|分到|放进|哪一堆|三类|四类|两类各)/, why: '条目要放进容器，表达属于关系' },
  { kind: 'matrix', test: /(对账|命中|漏了|漏掉|堆砌|逐条核|一格一格|核对表)/, why: '逐条对账要看哪一格对上了' },
  // 数值区间必须有自己的轨道（2026-10-21 走查 #4~#7）：位置线一根轴画不出带宽，
  // 模型会把「波动幅度」横着画到日期上，读起来就是「周二到周六 = 0.7 个点」。
  { kind: 'range-bar', test: /(波动(区间|范围|带)|区间(对比|比较)|上下限|幅度范围|取值范围|高低区间|从.{0,6}到.{0,6}的(区间|范围))/, why: '每组是一段数值区间，并排看长度，不能压在时间轴上' },
  { kind: 'compare', test: /(架构|选型|链路|请求路径|来回|往返|跳数|跨集群|集群边界|协调服务|内置还是外置|省掉一次|多一次)/, why: '两边差的不是文字条目，是请求要穿过几层网络边界——走 compare 的链路形态，箭头数就是跳数' },
  // 引用/指向类内容：名字→对象是二分连线，边就是「指向」，两栏文字会把这层信息丢掉。
  { kind: 'bipartite', test: /(变量名|指向|引用|同一个对象|浅拷贝|深拷贝|内存|栈|堆|别名|改它会不会影响)/, why: '名字与对象是两列，边表示指向；同一个对象要有多条边汇入' },
  // 同一组时刻/取值上的两个方向或两组数据：网格的列是方向、行是时刻。
  { kind: 'grid', test: /(水平方向|竖直方向|两个方向|分运动|合运动|同一时刻|每秒|时刻.{0,6}位移|随时间的?变化)/, why: '同一组时刻上的两列数据，行是时刻、列是方向，表本身就是分解' },
  // 2026-10-23 视觉评审：模型把「对比/区别」一律画成两栏文字卡片（最大废图来源）。
  // 改为引导二维表：两边在同一组判断点上逐项比，行列本身是几何；没有共同判断点就不画。
  { kind: 'grid', test: /(对比|对照|区别|差异|不同点|两种写法|两种做法)/, why: '两边要在同一组判断点上逐项比：把判断点做成行、两边做成列，二维表才承载关系' },
];

export function chooseFigureKind(text: string | null | undefined): { kind: FigureKindHint; why: string; match: string } | null {
  const value = String(text ?? '');
  if (!value.trim()) return null;
  for (const rule of KIND_RULES) {
    const hit = value.match(rule.test);
    if (hit) return { kind: rule.kind, why: rule.why, match: hit[0] };
  }
  return null;
}

/** 给模型的一句话：本轮该用哪种形状（无命中就返回空串，沿用原指南）。 */
export function figureKindHintLine(kind: { kind: FigureKindHint; why: string } | null): string {
  if (!kind) return '';
  return `\n本轮判断：这段内容的关系是「${kind.why}」——**优先用 kind=${kind.kind}**；`
    + `只有确实不适合时才退回 grid/compare，并说明理由。`;
}


const DEFAULT_FIGURE_MAX_PER_SESSION = 4;

export function resolveFigureMaxPerSession(value = process.env.TEACHING_FIGURE_MAX_PER_SESSION): number {
  if (!value || String(value).trim() === '') return DEFAULT_FIGURE_MAX_PER_SESSION;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`[teaching-visual] TEACHING_FIGURE_MAX_PER_SESSION 无效（${value}），使用默认 ${DEFAULT_FIGURE_MAX_PER_SESSION}`);
    return DEFAULT_FIGURE_MAX_PER_SESSION;
  }
  return parsed;
}

/** 本会话已摆过的位置线图数量（上限判定用）。 */
export function countTeachingFigures(messages: TeachingSessionMessage[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message) => sum + (Array.isArray(message?.figures) ? message.figures.length : 0), 0);
}

/**
 * 同一图型在一节课里的上限（默认 3，与 shouldEmitTeachingFigure 里的同类上限一致）。
 *
 * 为什么要在引擎里再判一次：那个上限读的是回合内存里的消息，而真课里它一次都没触发
 * （2026-10-21：会话上限 4 的一节课出了 6 张，同图型 10 张）——引擎这道闸门的计数
 * 取自库里的侧表，不信内存快照。
 */
const DEFAULT_FIGURE_MAX_PER_KIND = 3;

export function resolveFigureMaxPerKind(value = process.env.TEACHING_FIGURE_MAX_PER_KIND): number {
  if (!value || String(value).trim() === '') return DEFAULT_FIGURE_MAX_PER_KIND;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`[teaching-visual] TEACHING_FIGURE_MAX_PER_KIND 无效（${value}），使用默认 ${DEFAULT_FIGURE_MAX_PER_KIND}`);
    return DEFAULT_FIGURE_MAX_PER_KIND;
  }
  return parsed;
}

/**
 * 图型的证据等级（见 doc/DIAGRAM_PEDAGOGY_RESEARCH.md §五）。
 *
 * 为什么按等级分配配额：2026-10-22 的 744 张图里，top3（对照/阶梯/归类）占 72.3%，
 * 而其中阶梯与归类没有任何图型级教学实证；数轴/位置线是唯一 A 级。配额不是"少画"，
 * 是让有证据的形状先用满、没证据的形状每节课最多摆两次。
 */
export const FIGURE_KIND_EVIDENCE: Record<string, 'A' | 'B' | 'C' | 'D'> = {
  'position-line': 'A',
  matrix: 'B',
  grid: 'B',
  tree: 'B',
  compare: 'C',
  venn: 'C',
  cycle: 'C',
  ladder: 'D',
  bins: 'D',
  balance: 'D',
  bipartite: 'D',
  'range-bar': 'D',
  quadrant: 'D',
  bullseye: 'D',
  board: 'D',
};

/** 等级 → 每会话同图型上限。A 放宽到 4，D 收紧到 2。 */
const FIGURE_KIND_CAP_BY_GRADE: Record<'A' | 'B' | 'C' | 'D', number> = { A: 4, B: 4, C: 3, D: 2 };

/**
 * 某图型在本会话的上限。环境变量显式设置时以它为准（统一覆盖所有图型），
 * 否则按证据等级分配——这是唯一一处"理论落进配额"的地方。
 */
export function figureKindCap(kind: unknown, override = process.env.TEACHING_FIGURE_MAX_PER_KIND): number {
  if (override && String(override).trim() !== '') return resolveFigureMaxPerKind(override);
  const key = String(kind || 'position-line');
  const grade = FIGURE_KIND_EVIDENCE[key] || 'D';
  return FIGURE_KIND_CAP_BY_GRADE[grade];
}


/** 上一轮老师已经摆过位置线 → 本轮不再重复摆（判据天然带节奏）。 */
function lastAssistantHasFigure(messages: TeachingSessionMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === 'assistant');
  return Boolean(lastAssistant && Array.isArray(lastAssistant.figures) && lastAssistant.figures.length);
}

/**
 * 图的内容指纹（kind + 结构规格）。刻意不含 palette/caption，也不含 spec 里的 title/note：
 * 换配色、换说明句不是新图，仍是同一张画。
 */
function figureSignature(figure: unknown): string {
  const f = figure as {
    kind?: string;
    spec?: Record<string, unknown>;
    axis?: unknown;
    marks?: unknown;
    spans?: unknown;
    guides?: unknown;
  } | null;
  const spec = f?.spec && typeof f.spec === 'object' ? { ...f.spec } : f?.spec ?? null;
  if (spec && typeof spec === 'object') {
    delete (spec as Record<string, unknown>).note;
    delete (spec as Record<string, unknown>).title;
  }
  return JSON.stringify({
    kind: f?.kind ?? null,
    spec,
    axis: f?.axis ?? null,
    marks: f?.marks ?? null,
    spans: f?.spans ?? null,
    guides: f?.guides ?? null,
  });
}

/**
 * 本轮这张图该不该落库：与上一轮**完全同一张**（同 kind、同规格）就丢掉。
 *
 * 为什么需要：2026-10-19 实跑地理课，一节里同一张「三格归类表」连出两次——学生只补了一句
 * 措辞，图的内容一字未变。重复渲染不加信息，还让学生以为"老师又画了一遍"。
 * 只挡「完全相同」：内容变了的图照常出——逐步填满的归类表正是这类课的教具本身。
 */
/**
 * 形状指纹（粗指纹）：只留「这张图画的是什么骨架」，抹掉措辞与标点。
 *
 * 为什么需要它：精确指纹只比得出「一字不改的重画」。2026-10-20 实跑里同一节出现了三张 bins，
 * 第 2、3 张只是把「（挂起）」改成「(挂起)」、把两条挪成三条——精确比对放行了，学生看到的是
 * 「老师每轮都在摆同一张分类表」。所以对「标签即骨架」的图型（bins/compare/venn/ladder/cycle/tree），
 * 用去过标点、去空白后的结构标签比对；grid/matrix 的差别在格内文字，仍只做精确比对。
 */
function shapeSignature(figure: unknown): string | null {
  const f = figure as { kind?: string; spec?: Record<string, unknown> } | null;
  const kind = String(f?.kind || '');
  const shapely = ['bins', 'compare', 'venn', 'ladder', 'cycle', 'tree'];
  if (!shapely.includes(kind)) return null;
  // 只留汉字与 ASCII 字母数字：等价于「去标点、去空白」，但不用正则也不用字面量引号
  // ——本仓库的工具层会吃掉反斜杠与转义引号，正则写法落盘后会静默变成错误判据（踩过一次）。
  const norm = (v: unknown) => {
    let out = '';
    for (const ch of String(v ?? '').toLowerCase()) {
      const code = ch.charCodeAt(0);
      const isCjk = code >= 0x3400 && code <= 0x9fff;
      const isAscii = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
      if (isCjk || isAscii) out += ch;
    }
    return out;
  };
  const spec = (f?.spec || {}) as Record<string, any>;
  const parts: string[] = [kind];
  if (Array.isArray(spec.bins)) parts.push(...spec.bins.map((b: any) => norm(b?.label)));
  else if (spec.left && spec.right) parts.push(norm(spec.left.head), norm(spec.right.head));
  else if (Array.isArray(spec.nodes)) parts.push(...spec.nodes.map((n: any) => norm(n?.label)));
  else if (spec.center || spec.root) parts.push(norm(spec.center || spec.root));
  return parts.join('|');
}

/** 把标签拆成「汉字二元组」集合：换个说法（漏判（有信号没停） vs 漏判（该停没停））仍高度重叠。 */
function shapeBigrams(figure: unknown): Set<string> | null {
  const sig = shapeSignature(figure);
  if (!sig) return null;
  // 去掉图型前缀：所有 bins 都含「bins」三个字母，会虚抬任意两张 bins 的相似度
  const flat = sig.split('|').slice(1).join('').split('').filter((c) => c < '0' || c > '9').join('');
  const grams = new Set<string>();
  for (let i = 0; i < flat.length - 1; i += 1) grams.add(flat.slice(i, i + 2));
  return grams.size >= 4 ? grams : null;
}

function similarShape(a: unknown, b: unknown): boolean {
  const A = shapeBigrams(a);
  const B = shapeBigrams(b);
  if (!A || !B) return false;
  let inter = 0;
  for (const gram of A) if (B.has(gram)) inter += 1;
  const union = A.size + B.size - inter;
  // 0.45：2026-10-20 实跑语料里同一分类的改写版 Jaccard 落在 0.55~0.78，
  // 而换了一套分类轴的（力类依据 vs 运动状态依据）在 0.1 以下，阈值取中间。
  return union > 0 && inter / union >= 0.45;
}

/** 同一图型每会话最多三张：近义改写由相似度拦，剩下的名额留给真正换轴的那一张。 */
const FIGURE_MAX_PER_KIND = 3;

/**
 * 会话级去重：入参是**已落库的图**（库侧表），不是回合内存快照。
 * 2026-10-22 复核：内存版这道闸门在 744 张图里一次没触发，而同会话相似度 0.60 的图照旧渲染。
 */
export function shouldEmitFigureAmong(existingFigures: unknown[] | null | undefined, figure: unknown): boolean {
  if (!figure) return false;
  const list = Array.isArray(existingFigures) ? existingFigures : [];
  const previous = list.length ? list[list.length - 1] : null;
  if (previous && figureSignature(previous) === figureSignature(figure)) return false;
  // 同类数量上限
  const kind = String((figure as { kind?: string })?.kind || '');
  if (kind) {
    const sameKind = list.filter((item) => String((item as { kind?: string })?.kind || '') === kind).length;
    if (sameKind >= FIGURE_MAX_PER_KIND) return false;
  }
  // 全会话骨架去重：换个说法重画的（精确不等但高度相似）也拦
  const shape = shapeSignature(figure);
  if (shape) {
    for (const item of list) {
      if (shapeSignature(item) === shape) return false;
      if (similarShape(item, figure)) return false;
    }
  }
  return true;
}

/**
 * 「图只是把老师这段话抄进框里」判定（2026-10-23 外部视觉评审：86% 的图被判多余）。
 *
 * 判据（确定性，不看模型自述）：
 *  - 有连线/汇合结构（chain / nodes / edges / tree 分支 / cycle 节点）→ 不算复述，几何本身是新增信息；
 *  - 图里出现正文没有的数字 → 不算复述（新数据）；
 *  - 否则按二元组（bigram）比：图的措辞有 ≥65% 已经在正文里出现过 → 判为复述。
 * 短标签（二元组 < 12）不判，避免误伤。
 */
export function figureRestatesReply(figure: unknown, reply: string | null | undefined): boolean {
  const spec = (figure as { spec?: unknown })?.spec ?? figure;
  if (!spec || typeof spec !== 'object') return false;
  const text = String(reply ?? '');
  if (!text.trim()) return false;

  const hasEdges = (() => {
    const record = spec as Record<string, unknown>;
    const arr = (v: unknown) => Array.isArray(v) && v.length >= 1;
    const sides = [record.left, record.right].filter((v) => v && typeof v === 'object') as Record<string, unknown>[];
    return (
      arr(record.edges) ||
      arr(record.nodes) ||
      arr(record.branches) ||
      sides.some((side) => arr(side?.chain))
    );
  })();
  if (hasEdges) return false;

  const strings: string[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  walk(spec);
  const figureText = strings.join(' ');
  const figureNumbers = figureText.match(/\d+(?:\.\d+)?/g) || [];
  const replyNumbers = new Set(text.match(/\d+(?:\.\d+)?/g) || []);
  if (figureNumbers.some((n) => !replyNumbers.has(n))) return false;

  const bigrams = (value: string) => {
    const clean = value.replace(/[\s　-〿＀-￯]/g, '');
    const set = new Set<string>();
    for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
    return set;
  };
  const fig = bigrams(figureText);
  if (fig.size < 12) return false;
  const rep = bigrams(text);
  let novel = 0;
  for (const g of fig) if (!rep.has(g)) novel += 1;
  const novelty = novel / fig.size;
  return novelty < 0.35;
}

export function shouldEmitTeachingFigure(  messages: TeachingSessionMessage[] | null | undefined,
  figure: unknown,
): boolean {
  if (!figure) return false;
  const list = Array.isArray(messages) ? messages : [];
  const figures: unknown[] = [];
  for (const message of list) {
    if (Array.isArray(message?.figures)) figures.push(...message.figures);
  }
  return shouldEmitFigureAmong(figures, figure);
}

/** 上一轮已经出过任何视觉产物（figure 或 mermaid diagram）——模型做过选择了，本轮不再反复提示。 */
function lastAssistantHasVisual(messages: TeachingSessionMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === 'assistant');
  if (!lastAssistant) return false;
  return Boolean(
    (Array.isArray(lastAssistant.figures) && lastAssistant.figures.length) ||
      (Array.isArray(lastAssistant.diagrams) && lastAssistant.diagrams.length),
  );
}

/**
 * 算本轮的"结构图时机"（**代码裁决**，2026-09-23 建、2026-09-27 双通道重构）。
 *
 * 为什么由代码算、且要写进**本轮输入**：实测同一个 system prompt + 同一份输入，
 * 埋在 2 万字 prompt 里的规则（三档加码）全被忽略，而**把要求显式放进该轮输入**一次就生效。
 * 所以时机必须由代码判定后**显式送进去**，模型只负责"画什么"。
 *
 * 当前信号（S1，高精度）：**上一轮老师用字符画了结构**（ASCII 示意）——那正是"这里本来需要图"的证据。
 * owner 口径 2026-09-25 放开"每任务一次"后允许重复触发：只要**紧邻上一轮**又画了字符结构就再提示
 * （判据天然带节奏——不画结构的轮次不会触发）；总量仍由每会话上限兜底。
 *
 * 2026-09-27 重构要点：去向从"扩散生图（visual）"改为**确定性渲染（diagram/mermaid）**——
 * 字符画本身就是最精简的结构图，翻成扩散生图会丢语义精度（断口丢失事故）且图内不能标字；
 * mermaid 零乱码、图内可写中文标签、毫秒渲染零成本（owner 终审拍板双通道，设计文档 §七-§十）。
 */
export function buildVisualOpportunity(
  messages: TeachingSessionMessage[] | null | undefined,
  taskHint?: string | null,
): VisualOpportunity | null {
  if (!isTeachingVisualEnabled() && !isTeachingDiagramOpportunityEnabled()) return null;
  const list = Array.isArray(messages) ? messages : [];
  const lastAssistant = [...list].reverse().find((message) => message?.role === 'assistant');
  const figureCount = countTeachingFigures(list);
  const figureCapReached = figureCount >= resolveFigureMaxPerSession();
  const lastHasFigure = lastAssistantHasFigure(list);
  // 形状路由：按「任务标题 + 上一轮讲解」判这段内容该用哪种几何（靶盘/闭环/交集/二分/辐射/…）
  const kindHint = chooseFigureKind([taskHint, lastAssistant?.content].filter(Boolean).join('\n'));
  const kindHintLine = figureKindHintLine(kindHint);
  if (detectAsciiStructure(lastAssistant?.content)) {
    return {
      suggested: true,
      reason: 'ascii-structure',
      kindHint: kindHint?.kind ?? null,
      ruleWhy: '上一轮用箭头/方框字符在正文里画了结构',
      matched: matchAsciiCues(lastAssistant?.content),
      instruction:
        '上一轮你用了箭头/方框/字符在 reply 里"画"结构——那说明这里本来就需要一张图，而且**别再用字符画**。'
        + '**先判断**：若本轮正要布置「由学习者自己排出/画出这个结构」的练习（答案泄漏，2026-09-24 实测），'
        + '则本轮**不要**输出 diagram/figure，直接布置练习，把图留到学生完成后的下一轮总结印证时再用；'
        + '**再分流**：内容是**空间位置关系**（谁在前谁在后、朝哪走、隔多远、追及/相遇）→ 输出 `figure`（位置线图，'
        + '数值域 + 对象 + 朝向箭头 + 区间标注，mermaid 画不出位置）；内容是**二维表/对账/命中矩阵/象限**→ 输出 `figure`'
        + '（kind 用 grid 或 matrix，按图型选择表）；其余结构类（流程/层级/时序）→ 输出 `diagram`：'
        + 'engine 用 mermaid，把这段结构画成 flowchart（流程/层级/对比）或 sequenceDiagram（时序）——'
        + '**图内要写中文标签**（节点名、关键量、方向词），标签就是教学信息本身；'
        + 'caption 写一句给学生看的说明；reply 里不必再用字符画结构。'
        + kindHintLine + '\n'
        + (!figureCapReached ? FIGURE_KIND_GUIDE : ''),
    };
  }
  // 位置线时机（Scope B，2026-09-27 语料实证的"正当时机①：学生描述完 → 外化其描述以核验"）：
  // 学生上一轮在用文字描述位置关系（谁在前谁在后、朝哪走、隔多远）——那正是位置线该出场的时候。
  // 上一轮老师已摆过 / 本会话已达上限 → 不再触发（判据天然带节奏）。
  const lastUser = [...list].reverse().find((message) => message?.role === 'user');
  const positionCues = matchPositionCues(lastUser?.content);
  if (positionCues.length) {
    if (lastHasFigure) return null;
    if (figureCapReached) return null;
    return {
      suggested: true,
      reason: 'position-description',
      kindHint: 'position-line',
      ruleWhy: '学生在用文字描述空间位置关系，外化成一条线让他核验',
      matched: positionCues,
      instruction:
        '学生正在用文字描述**空间位置关系**（谁在前谁在后、朝哪走、隔多远）——把他说的话**摆成一条位置线**给他核验，'
        + '这是这类课的共同坐标系。**先判断**：若本轮正要布置「由学习者自己画/摆出这条位置线」的练习（答案泄漏），'
        + '则本轮**不要**输出 figure，直接布置练习；否则输出顶层块 `figure`（kind 用 position-line，'
        + 'marks 写学生的对象与朝向、spans 写他提到的距离、guides 写追及点/相遇点这类参考位置），'
        + '**图内标签写学科实指**（甲/乙/小明/追及点）；caption 一句给学生看的话；**不要**改用 mermaid（节点-边画不出位置）。'
        + 'reply 里不必再复述位置关系。',
    };
  }
  // 时间先后时机（2026-10-21 实跑补齐）：竞态/时序课里学生一个空间词都没有，只说「先发、后至、返回、覆盖」。
  // 这类描述的学习对象同样是一条线——只是那条线是**时间轴**：marks 是事件发生的时刻，spans 是时长/窗口。
  const timeCues = matchTimeOrderCues(lastUser?.content);
  if (timeCues.length) {
    if (lastHasFigure) return null;
    if (figureCapReached) return null;
    return {
      suggested: true,
      reason: 'time-order',
      kindHint: 'position-line',
      ruleWhy: '学生在描述事件的先后与返回顺序——学习对象是一条时间轴',
      matched: timeCues,
      instruction:
        '学生刚在描述**事件在时间上的先后**（谁先发出、谁先返回、谁覆盖谁）。把这条时间关系摆成一条**时间轴**给他核验：'
        + 'axis.unit 写时间单位（ms/秒），**至少三个时刻**（发出、返回、写回各算一个），marks 写事件名与方向，'
        + 'spans 只表示**时长或窗口**（「A 从发出到返回 250ms」），**不要**用 spans 表示「幅度/差值/差距」这类数值差——'
        + '那是另一种图（range-bar），画在时间轴上会被读成时间段。caption 一句给学生看的话。'
        + '**先判断**：若本轮正要布置学生自己画这条时间线，则本轮不要出图，留到下一轮印证。',
    };
  }
  // 任务级时机（2026-10-18）：**当前任务的标题/描述本身就是结构化关系**——
  // 这是最强的信号（任务决定这节课要处理哪种关系）。只在上一轮任何视觉产物都没出、
  // 且总量未到顶时给一次机会：模型可以选择用 diagram，做过选择后本轮就不再追问。
  if ((detectStructuralCue(taskHint, 1) || chooseFigureKind(taskHint)) && !lastAssistantHasVisual(list) && !figureCapReached) {
    return {
      suggested: true,
      reason: 'task-structure',
      kindHint: kindHint?.kind ?? null,
      ruleWhy: '当前任务本身就是一组结构化关系',
      matched: [...matchStructureCues(taskHint), ...(kindHint?.match ? [kindHint.match] : [])].slice(0, 6),
      instruction:
        '当前这个任务本身就在处理一组**结构化关系**（归属/对应/对比/对账/分层这类）。'
        + '如果这轮的内容已经可以用一张图讲清，就在 reply 之后输出顶层块 `figure`；'
        + '**先判断**：若本轮正要布置「由学生自己填这张表/排这组关系」的练习（答案泄漏），本轮**不要**输出，'
        + '留到学生完成后的下一轮印证；若确实是流程/时序，用 `diagram`（mermaid）。'
        + kindHintLine + '\n'
        + FIGURE_KIND_GUIDE,
    };
  }
  // 结构内容时机（2026-10-18 扩图型）：老师上一轮在讲二维/多对多/象限关系——
  // 这类课型本来就需要图，但模型不会主动请求 figure。只在"上一轮已摆过图"或"总量到顶"时退让。
  if (detectStructuralCue(lastAssistant?.content) || chooseFigureKind(lastAssistant?.content)) {
    if (lastHasFigure) return null;
    if (figureCapReached) return null;
    return {
      suggested: true,
      reason: 'structure-content',
      kindHint: kindHint?.kind ?? null,
      ruleWhy: '上一轮在讲一组结构化关系',
      matched: [...matchStructureCues(lastAssistant?.content), ...(() => {
        const hit = chooseFigureKind(lastAssistant?.content);
        return hit ? [hit.match] : [];
      })()].slice(0, 6),
      instruction:
        '上一轮你在讲一组**结构化关系**（对比/归类/对账/维度/映射这类）。把它摆成一张图，学生能比读段落更快看清关系。'
        + '**先判断**：若本轮正要布置「由学生自己填这张表/排这组关系」的练习（答案泄漏），本轮**不要**输出，'
        + '留到学生完成后的下一轮印证；若关系是纯流程/层级/时序，用 `diagram`（mermaid）而不是 figure；'
        + '若用一维先后就能说清（谁在前、隔多远），用 position-line。'
        + '**反向要求（2026-10-20 实跑教训）**：如果你这一轮是在**复述/收束学生刚说的内容、把它归成结构**'
        + '（出现「对，就是…」「这两层是…」「这部分拆成…」这类收束语），那就**必须**出图——'
        + '这种轮次不出图，学生拿走的就是一段听过就散的话。'
        + kindHintLine + '\n'
        + FIGURE_KIND_GUIDE,
    };
  }
  // 2026-10-23 停用「连续 N 轮无图强制补一张」（recap-cadence）：
  // 外部视觉评审逐张看下来，凑出来的图基本都是把老师的批改话/做题口诀画成卡片，
  // 学生学的是学科内容，图上却是「缺绳 vs 重写」。图只应出现在有学科关系可画、
  // 且画得比文字更省力的时刻；没有就不出。
  return null;
}

/** 结构图时机开关（新通道，默认开启；env 可关用于回放对照）。 */
export function isTeachingDiagramOpportunityEnabled(): boolean {
  return process.env.TEACHING_DIAGRAM_DISABLED !== '1';
}

export interface GenerateTeachingVisualDeps {
  /** 注入生图（测试用）；缺省走真实 provider 链。 */
  generate?: typeof generateImages;
  now?: () => Date;
}

/**
 * 同 prompt 去重（2026-09-26）：本会话已经生成过**一模一样 composed prompt** 的图就不再生成——
 * 生成约 12s 且计费，老师反复请求同一张图（学生没看懂再讲一遍）不应重复扣费。
 * 返回 null 是安全的：文本自洽原则（③）本就要求 reply 不依赖图。
 */
export function hasIdenticalVisualPrompt(
  messages: TeachingSessionMessage[] | null | undefined,
  prompt: string
): boolean {
  if (!Array.isArray(messages) || !prompt) return false;
  return messages.some((message) =>
    Array.isArray(message?.images) ? message.images.some((image) => image?.prompt === prompt) : false
  );
}

/** 瞬时失败有界重试（2026-09-26）：只重试"快速失败"的瞬错误，失败耗时超预算（≈真超时）不重试。 */
const VISUAL_RETRY_ELAPSED_BUDGET_MS = 15_000;
const RETRYABLE_IMAGE_CODES: ReadonlySet<ImageErrorCode> = new Set<ImageErrorCode>([
  'IMAGE_UPSTREAM_TIMEOUT',
  'IMAGE_UPSTREAM_UNAVAILABLE',
  'IMAGE_EMPTY_RESULT',
]);

function isRetryableImageError(error: unknown): boolean {
  if (!(error instanceof ImageError)) return false;
  if (RETRYABLE_IMAGE_CODES.has(error.code)) return true;
  // HTTP 错误只重试 5xx（上游抖动）；4xx 是请求本身的问题，重试必然复现
  return error.code === 'IMAGE_UPSTREAM_HTTP_ERROR' && (error.status === undefined || error.status >= 500);
}

export interface GenerateTeachingVisualInput {
  request: TeachingVisualRequest | null | undefined;
  /** 该会话**已落库**的消息（用于上限判定）。 */
  messages?: TeachingSessionMessage[] | null;
  signal?: AbortSignal;
  deps?: GenerateTeachingVisualDeps;
}

/**
 * 按闸门决定是否生成一张教学配图；**任何失败都返回 null，绝不抛**（课堂不能被图拖垮）。
 */
export async function generateTeachingVisual(input: GenerateTeachingVisualInput): Promise<TeachingImage | null> {
  if (!isTeachingVisualEnabled()) return null;
  const request = input.request;
  if (!isUsableVisualPrompt(request)) return null;

  const used = countTeachingVisuals(input.messages);
  // ① 每任务（= 本教学会话）硬闸门：默认 1 张——"同一任务最多配一次"不能只靠提示词
  const maxPerTask = resolveTeachingVisualMaxPerTask();
  if (used >= maxPerTask) {
    logger.info('[teaching-visual] 本任务已达配图上限，本轮跳过', { used, maxPerTask });
    return null;
  }
  // ② 每会话上限（外圈兜底）
  const max = resolveTeachingVisualMaxPerSession();
  if (used >= max) {
    logger.info('[teaching-visual] 已达每会话配图上限，本轮跳过', { used, max });
    return null;
  }

  const prompt = composeTeachingVisualPrompt(request as TeachingVisualRequest);
  // ③ 同 prompt 去重：本会话画过一模一样的图就不重复计费
  if (hasIdenticalVisualPrompt(input.messages, prompt)) {
    logger.info('[teaching-visual] 本会话已生成过同 prompt 配图，跳过（不重复计费）');
    return null;
  }
  const visualSpec = resolveTeachingVisualSpec(request?.kind, request?.prompt);
  const generate = input.deps?.generate ?? generateImages;
  const imageRequest = {
    prompt,
    n: 1,
    // 精确尺寸（主）+ 同向 ratio（兜底）：横向结构不再被压成方图
    size: visualSpec.size,
    ratio: visualSpec.ratio,
    responseFormat: 'url',
    purpose: 'classroom-visual-aid',
  } as const;
  const generateOptions = { signal: input.signal, timeoutMs: DEFAULT_TEACHING_VISUAL_TIMEOUT_MS };
  // 可注入时钟统一成毫秒数（deps.now 返回 Date；缺省 Date.now 返回 number——重试预算只做差值比较）
  const depsClock = (): number => {
    const value = (input.deps?.now ?? Date.now)();
    return value instanceof Date ? value.getTime() : value;
  };
  const attemptStartedAt = depsClock();
  try {
    let result;
    try {
      result = await generate(imageRequest, generateOptions);
    } catch (error) {
      // 瞬时失败（超时/上游不可用/空结果/5xx）且**失败得够快** → 有界重试一次。
      // 预算检查保证重试只发生在快速失败上（真超时 60s 的重试会把课堂拖到 2 分钟，绝不重试）。
      const elapsedMs = depsClock() - attemptStartedAt;
      if (!isRetryableImageError(error) || elapsedMs > VISUAL_RETRY_ELAPSED_BUDGET_MS) throw error;
      logger.warn('[teaching-visual] 配图瞬时失败，有界重试一次', {
        code: error instanceof ImageError ? error.code : undefined,
        elapsedMs,
      });
      result = await generate(imageRequest, generateOptions);
    }
    const first = result.images.find((image) => image?.url || image?.b64Json);
    const url = first?.url || (first?.b64Json ? `data:image/png;base64,${first.b64Json}` : '');
    if (!url) return null;
    const createdAt = (input.deps?.now?.() ?? new Date()).toISOString();
    logger.info('[teaching-visual] 课堂配图已生成', {
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      kind: request?.kind ?? null,
    });
    return {
      url,
      caption: String(request?.caption || '').trim() || null,
      prompt,
      provider: result.provider,
      model: result.model,
      kind: String(request?.kind || '').trim() || null,
      createdAt,
    };
  } catch (error) {
    logger.warn('[teaching-visual] 课堂配图生成失败（不阻断课堂）', {
      code: error instanceof ImageError ? error.code : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 图里的数字 vs 正文里的数字（2026-10-21 走查 #15）。
 *
 * 病根：图和正文是模型两处分别生成的，各写各的数——正文说 3.8/3.1，图上画 3.9/3.0，
 * 学生看到的是两块互相矛盾的黑板。这里做**确定性对账**：
 * 收集图内标签（marks/spans/guides 以及 spec 里的标题/条目）出现的数字，
 * 再看它们是否在本轮 reply 里出现过。全部都没出现 → 判为凭空编的数，不出图；
 * 部分缺失 → 只告警（轴端点等由代码推导的数不在正文里是正常的）。
 *
 * 只对标签文本取数，不取 axis.min/max（那是渲染域，不是教学事实），也不取 caption/note（整句说明）。
 */
export function collectFigureNumbers(figure: unknown): string[] {
  const numbers: string[] = [];
  const skipKeys = new Set(['caption', 'note', 'engine', 'kind', 'palette', 'why']);
  const walk = (value: unknown, key: string | null, depth: number): void => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (key && skipKeys.has(key)) return;
      for (const hit of value.match(/\d+(?:\.\d+)?/g) || []) numbers.push(hit);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === 'axis') continue;
        walk(v, k, depth + 1);
      }
    }
  };
  walk(figure, null, 0);
  return [...new Set(numbers)];
}

/** 本轮 reply 里出现过的数字集合（同一套取数口径）。 */
export function collectReplyNumbers(reply: string | null | undefined): Set<string> {
  return new Set(String(reply ?? '').match(/\d+(?:\.\d+)?/g) || []);
}

/**
 * 图文数字是否「各说各的」：图里有 ≥2 个数字、正文里也有 ≥2 个数字，
 * 但两边一个都不重合 → 判为编数（走查 #15 的判例）。
 * 轴端点这类由代码推导的数值不进对账（collectFigureNumbers 跳过 axis）。
 */
export function figureNumbersFightReply(figure: unknown, reply: string | null | undefined): boolean {
  const figureNumbers = collectFigureNumbers(figure);
  if (figureNumbers.length < 2) return false;
  const replyNumbers = collectReplyNumbers(reply);
  if (replyNumbers.size < 2) return false;
  return figureNumbers.every((n) => !replyNumbers.has(n));
}
