/**
 * 任务材料自足性：判断「承诺给学习者具体材料，但描述里没有材料本体」的悬空引用。
 *
 * 背景（2026-11-02 真实课堂实测，路径 lp_1793609520322_a52ld7g 首课）：
 * 任务标题/描述写着「在 6 个句子上指认时间标志词与动作性质」「给你 6 个句子（含 already、
 * since 2020、yesterday…）」，但 6 个句子**从未被写出来**——描述里只有 6 个特征词。
 * 下游课堂拿不到材料：老师只能说「材料是 6 个句子」，白板退化成一张 6×3 的空壳矩阵
 * （18 格全 hit、零文本），学生看到一屏 ✓ 却读不出任何内容。
 *
 * 这是 stage-designer 既有规则（R4「示范题/例题/真题引用必须自带题面」、f1–f10「禁止
 * 空壳准备课」、108「数据来源显式化」）的漏网形态：那几条按**关键词**触发（例句/真题/配方/
 * 原始数据），而「给你 N 个句子」既不是"题"也不是"数据"，于是整条规则没被激活。
 *
 * 本模块把这条规则做成**确定性判据**（高精度、宁可漏判不误判）：
 *   1. 描述里出现「N 个/道/条/行 … 句子/题/样本/…」这类**材料承诺**（N ≥ 2）；
 *   2. 且描述里没有任何材料本体的迹象：没有 materialRefs、没有编号列表、没有 ≥2 处引号原文；
 *   3. 且不属于规则 108 允许的两种合法来源：学习者手头已有 / 前序任务或阶段产出。
 * 命中即视为悬空引用，交给 stage-designer 的软校验带反馈重试一次。
 */

/** 材料承诺：数字 + 量词 + 具体材料名词（限制名词表，避免把「3 个阶段」「2 个要点」当材料） */
const MATERIAL_PROMISE_RE =
  /(\d+)\s*(?:个|道|条|行|组|种|套)\s*(?:句子|语句|例句|句子样本|题|题目|问题|数据|数|样本|样例|例子|案例|配方|清单|表格|行数据|数据行)/;

/** 规则 108 允许的来源：学习者手头已有（写明了来源，不算悬空） */
const LEARNER_OWNED_RE = /(你手头|你手上的|你已有的|你现有的|你自备|手边有|你那份|你手上的那份)/;

/** 规则 108 允许的来源：前序任务/阶段产出 */
const PRIOR_OUTPUT_RE =
  /((任务|阶段)\s*\d+[^。；\n]{0,16}(产出|输出|结果|生成)|上次[^。；\n]{0,12}(产出|输出|结果)|前一步[^。；\n]{0,12}(产出|输出|结果))/;

/** 编号列表迹象：行首 1. / 1、 / （1） / ① / - / • */
const NUMBERED_LIST_RE = /(^|\n)\s*(?:\d{1,2}\s*[.、)）]|[（(]\s*\d{1,2}\s*[)）]|[①-⑩]|[-*•])\s+/g;

/** 引号原文迹象：「…」 / “…” / "…" */
const QUOTED_TEXT_RE = /「([^」]{2,})」|“([^”]{2,})”|"([^"]{2,})"/g;

/**
 * 「这段引号像是材料本体」的判据（不是术语）：
 * 带句末标点 / 含拉丁字母（外语例句）/ 足够长（≥20 字）。
 * 反例：实测描述里的「持续 / 已完成 / 一次性发生」「先看信号再定形式」都是术语，不算材料。
 */
function looksLikeMaterialText(text: string): boolean {
  return (
    /[。！？!?]/.test(text)
    || /[A-Za-z]{2,}/.test(text)
    || text.replace(/\s/g, '').length >= 20
  );
}

/** 像句子的英文片段（未加引号的材料也要能认出来，如 "She has already finished her homework."） */
const ASCII_SENTENCE_RE = /[A-Za-z][^.!?\n]{6,}[.!?]/g;

function countMaterialQuotes(text: string): number {
  const re = new RegExp(QUOTED_TEXT_RE.source, 'g');
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const inner = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (inner && looksLikeMaterialText(inner)) count += 1;
  }
  return count;
}

export interface SubtaskMaterialCompletenessInput {
  title?: string;
  description?: string;
  acceptanceHint?: string;
  /** 已通过逐字核对的任务级资料引用（非空即视为有来源） */
  materialRefs?: unknown;
}

export interface SubtaskMaterialCompleteness {
  /** 是否命中材料承诺 */
  promisesMaterial: boolean;
  /** 承诺的材料数量（取第一个匹配） */
  promisedCount: number;
  /** 是否有材料本体/合法来源 */
  satisfied: boolean;
  /** 不满足时的可读说明（可直接进纠错提示） */
  reason?: string;
}

function countMatches(text: string, re: RegExp): number {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let count = 0;
  while (global.exec(text) !== null) count += 1;
  return count;
}

/**
 * 判定单个任务是否「承诺了材料却没给本体」。
 *
 * 纯函数、无 IO，供生成侧软校验与审计脚本共用。
 */
export function assessSubtaskMaterialCompleteness(
  task: SubtaskMaterialCompletenessInput,
): SubtaskMaterialCompleteness {
  const text = [task.title, task.description, task.acceptanceHint].filter(Boolean).join('\n');
  const match = MATERIAL_PROMISE_RE.exec(text);
  if (!match) return { promisesMaterial: false, promisedCount: 0, satisfied: true };

  const promisedCount = Number(match[1]);
  // 单件材料（「给你 1 个句子」）不构成"一批材料"，不判
  if (!Number.isFinite(promisedCount) || promisedCount < 2) {
    return { promisesMaterial: false, promisedCount: 0, satisfied: true };
  }

  // 合法来源：已核对通过的资料引用 / 学习者手头已有 / 前序产出
  if (Array.isArray(task.materialRefs) && task.materialRefs.length > 0) {
    return { promisesMaterial: true, promisedCount, satisfied: true };
  }
  if (LEARNER_OWNED_RE.test(text) || PRIOR_OUTPUT_RE.test(text)) {
    return { promisesMaterial: true, promisedCount, satisfied: true };
  }

  // 材料本体迹象（任一即可）：
  //   · 编号列表 ≥2 行（逐条列出题面/句子/数值的标准写法）
  //   · ≥2 处「句子级」引号原文（术语引号不算，见 looksLikeMaterialText）
  //   · ≥2 句像句子的英文片段（未加引号的材料）
  const numbered = countMatches(text, NUMBERED_LIST_RE);
  const quoted = countMaterialQuotes(text);
  const asciiSentences = countMatches(text, ASCII_SENTENCE_RE);
  if (numbered >= 2 || quoted >= 2 || asciiSentences >= 2) {
    return { promisesMaterial: true, promisedCount, satisfied: true };
  }

  return {
    promisesMaterial: true,
    promisedCount,
    satisfied: false,
    reason:
      `任务承诺了 ${promisedCount} 份具体材料（「${match[0]}」），但 description 里没有材料本体：` +
      '既没有逐条列出题面/句子/数值，也没有可核对的 materialRefs，也没有写明来自学习者手头或前序产出。',
  };
}

export interface StageMaterialCompletenessResult {
  valid: boolean;
  failureReason?: string;
  violations?: string[];
}

/**
 * 阶段级软校验（stage-designer 用）：逐任务判定，汇总成一次纠错重试的失败原因。
 *
 * 与 materialRefs 覆盖度同口径：**只判缺失、不代写**——绝不替模型编出材料本体。
 */
export function assessStageMaterialCompleteness(
  subtasks: Array<SubtaskMaterialCompletenessInput & { title?: string }>,
): StageMaterialCompletenessResult {
  const missing = (Array.isArray(subtasks) ? subtasks : [])
    .map((task, index) => {
      const result = assessSubtaskMaterialCompleteness(task);
      if (result.satisfied) return null;
      return `任务 ${index + 1}「${String(task.title || '未命名').trim()}」：${result.reason}`;
    })
    .filter((item): item is string => !!item);

  if (missing.length === 0) return { valid: true };
  return {
    valid: false,
    failureReason: `MATERIAL_BODY_MISSING_STAGE: 有 ${missing.length} 个任务承诺了具体材料却没给材料本体`,
    violations: missing,
  };
}