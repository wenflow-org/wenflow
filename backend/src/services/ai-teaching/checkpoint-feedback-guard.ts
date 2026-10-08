/**
 * 检查点反馈硬门（拍板 #5 切口1，2026-10-08）。
 *
 * 背景（DECISION-BRIEF-2026-10-08 #5）：老师反馈话术与判分脱钩——库内存证
 * 「同概念最后一次 code 判错 → 终态 mastered」83 会话；影响链实测（仓库自带 FSRS-6 引擎）：
 * 一次虚高在第二次复习就把间隔抬 ~99 天。b52576b4 已把代码裁决注入教学输入（提示词软约束），
 * 但从未度量。本模块把「judgedBy=code & passed=false 的回合，回复不得出现肯定语」
 * 落成代码可检出的确定性约束（与 A3 答案泄漏筛查同一思路：命中即剥离，绝不阻塞课堂）。
 *
 * 设计（精度优先，误剥伤害大于漏剥）：
 * - 只在**句子级**操作（按 。！!？?\n 切分，保留分隔符），不跨句重组、不动非命中句；
 * - 命中肯定语模式的句子，若含疑问/否定/转折/接近语（吗？/差一点/但/不过…）则跳过——
 *   「差一点就对了」「答对了吗」这类非肯定句不误杀；「不错」是肯定语
 *   （做得不错/回答得不错），blocklist 里的「错」用 (?<!不) 负向断言与它区分；
 * - 全部句子都被命中、或剥离后残余过短（< REPLY_FLOOR_CHARS）时**不剥**——
 *   回复不能被剥空，只返回命中清单供遥测（flagged-only）。
 *
 * 返回 { reply, stripped, applied }：stripped=命中句子（遥测样本），applied=是否实际改写。
 * 遥测口径（切口2 判分-反馈一致性落库计数）：stripped.length>0 即记一次
 * MODEL_AFFIRMATION_MISMATCH——分子=该事件数，分母=learner_evidence 里 judgedBy='code'
 * 且 passed=false 的 checkpoint:result 行（audit-judge-agreement 同源口径）。
 */

/** 剥离后回复的最短存活长度（字符）：低于它宁可整句不剥，只打遥测 */
const REPLY_FLOOR_CHARS = 10;

/**
 * 肯定语模式（句子级命中即剥）。
 * 直接夸赞词收窄到对学生作答的夸法（很棒/满分…），不收「厉害/漂亮」这类
 * 也会形容方法/思路的教学语，避免误剥教学内容。
 */
const AFFIRMATION_PATTERNS: RegExp[] = [
  // 作答判对：答对了/回答正确/选对了/判断正确
  /(?:答|回答|选|判断|填)(?:对|正确)(?:了|啦)/,
  // 「得/的」称赞结构：答得对/做得不错/回答得非常好/理解得到位
  /(?:答|回答|选|做|说|填|理解|思路)(?:得|的)(?:完全|非常|十分|很|太|挺|相当)?(?:对|正确|不错|好|棒|到位|准确|清楚|完整)/,
  // 强化肯定：完全正确/完全对/非常正确
  /(?:完全|非常|十分)(?:正确|对)/,
  // 直接夸赞（对学生）
  /(?:很棒|真棒|太棒|棒极了|好样的|干得漂亮|满分|优秀)/,
  // 肯定语开头的短句（很好，我们继续 → 同样在给错误答案盖章）：逗号前段即命中
  /^(?:很好|非常好|真棒|很棒|太棒了?|不错|好极了|对的|正确)[，,、]/,
  // 独句短夸（归一去列表符与尾标点后整段匹配）：很好！/非常好。/不错！
  /^(?:很好|非常好|太好了|真棒|很棒|太棒了|不错|对的|正确|好极了)[！!。～~]*$/,
];

/** 否决词：句子含任一则不算肯定语（疑问/否定/转折/接近语），不剥 */
const AFFIRMATION_SENTENCE_BLOCKLIST =
  /[？?]|[吗呢么]\s*[?？!！。]*$|差一点|就差|接近|几乎|还差|不够|不太|还没|没答|没写|漏了|少了|缺了|有误|不对|(?<!不)错|再想想|再试|重新|但是|不过|可是|然而|其实|虽然|可惜|下次|要注意|需要再/;
// 「不错」是肯定语（做得不错），(?<!不)错 的负向断言保证它不被误当否定——该正则语义由单测钉死。

/** 去列表符/序号与首尾空白（模式匹配用；不改写原文） */
function normalizeForMatch(sentence: string): string {
  return sentence
    .trim()
    .replace(/^[\s\-—•·*>#]+\s*(?:\d+[.、)）])?\s*/, '');
}

function isAffirmativeSentence(sentence: string): boolean {
  if (!sentence.trim()) return false;
  if (AFFIRMATION_SENTENCE_BLOCKLIST.test(sentence)) return false;
  const normalized = normalizeForMatch(sentence);
  if (!normalized) return false;
  return AFFIRMATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export interface AffirmationStripResult {
  /** 处理后的回复（applied=false 时与入参同值） */
  reply: string;
  /** 命中肯定语、被（或本应被）剥离的句子（遥测样本） */
  stripped: string[];
  /** 是否实际改写了回复（false=只命中不剥：整句全中/残余过短，保底放行原文） */
  applied: boolean;
}

/**
 * 对「code 判错」回合的老师回复做肯定语句子级剥离（纯函数，供单测）。
 * 输入非字符串/空白回复一律原样返回（applied=false）。
 */
export function stripAffirmationsOnFailedVerdict(reply: unknown): AffirmationStripResult {
  const value = typeof reply === 'string' ? reply : '';
  if (!value.trim()) return { reply: value, stripped: [], applied: false };
  // 句子切分：lookbehind 保留分隔符；列表符/序号随命中句一起消失（教学回复不依赖编号连续性）
  const parts = value.split(/(?<=[。！!？?\n])/);
  const kept: string[] = [];
  const stripped: string[] = [];
  for (const part of parts) {
    if (isAffirmativeSentence(part)) {
      stripped.push(part.trim());
    } else {
      kept.push(part);
    }
  }
  if (stripped.length === 0) return { reply: value, stripped, applied: false };
  const remaining = kept.join('').replace(/\n{3,}/g, '\n\n').trim();
  if (remaining.length < REPLY_FLOOR_CHARS) {
    return { reply: value, stripped, applied: false };
  }
  return { reply: remaining, stripped, applied: true };
}
