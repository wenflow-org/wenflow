/**
 * 本轮板书意图（2026-10-27 改造）：在画板**之前**，先由代码决定「这一轮老师要让学生产出什么」。
 *
 * 为什么必须先定：板书层先于教学层执行。如果画板时不知道这一轮要问什么，绘图员就会把
 * 推导终局（最终得数、结论横幅、因果判词）一并画上板；老师再问，就成了「答案已经印在
 * 黑板上，老师还假装问学生」——外部盲评把这类判为「结论前置（preAnswer）」。
 *
 * 同时解决「换题慢半拍」：老师上一轮已经宣布了新数据（"换一组数：90 秒跑完 300 米"），
 * 下一轮画板时如果不读老师上一句，就永远拿学生这句话当唯一信号——老师主动换题时板不动。
 *
 * 本模块只做确定性判断：输入是任务类型、图型、学生这句话、老师上一句、当前板面；
 * 不调模型。产出用于两处：① 拼进 board-designer 的输入；② 对已归一化 spec 做收口。
 */

export type BoardAskAbout =
  /** 让学生指出分叉/错在哪一步（正误对比的经典问法） */
  | 'fork'
  /** 让学生说清两个条件哪个变了、哪个没变（对照实验） */
  | 'condition'
  /** 让学生说出顺序/因果为什么这样（时间线） */
  | 'order'
  /** 让学生把结论搬到新情境（复盘/迁移） */
  | 'mapping'
  /** 本轮不设问（纯讲解） */
  | 'none';

/** 老师这一轮是否换了例子：variant = 只换数字（同一方法），scene = 换了对象/条件 */
export type ExampleChange = 'none' | 'variant' | 'scene';

export interface BoardIntent {
  askAbout: BoardAskAbout;
  exampleChange: ExampleChange;
  /**
   * 换例信号的来源（2026-11-13 修复批 4b，BOARD_MISMATCH 聚类 major×3）：
   * 同为 exampleChange='variant'，「老师明说了换成/改成/假设」（variant-words/hypothetical）
   * 与「只是提到了板上还没有的数字」（variant-numbers）可信度完全不同——后者常是**同例深挖**
   * 的正常信号（老师讲到例子里还没上板的数），拿它当换题信号会让绘图员把同一例子的板
   * 重绘成自相矛盾的变体（实证：财务课 rev2「付出货款 0 元」被重绘成「付现 60 万」，
   * 与教师开场口述打架）。shouldSkipExampleRefresh 据此只拦最弱的那档触发。
   */
  changeSignal: 'scene' | 'variant-words' | 'hypothetical' | 'variant-numbers' | 'none';
  /** 本轮是「把顺序/条件倒过来」的反事实推演（板面必须标假设，不能写成史实） */
  hypothetical?: boolean;
  /** 本轮新出现的数据（用于画板时直接摆上新现场） */
  newNumbers: string[];
  /** 给绘图员的一句话：这一轮板面画到哪里为止 */
  instruction: string;
  reason: string;
}

export interface IntentSignals {
  /** 七档任务类型：acquire/deconstruct/model/execute/diagnose/refine/consolidate */
  taskType?: string | null;
  /** 当前板书图型 */
  kind?: string | null;
  /** 学生这一轮说的话 */
  studentText?: string | null;
  /** 老师上一轮说的话（换题信号的主要来源） */
  lastTeacherText?: string | null;
  /** 当前板面上的数字集合（由调用方给出，缺省则不判换题） */
  boardNumbers?: ReadonlyArray<string> | null;
}

const SCENE_WORDS =
  /(水银|酒精|盐水|油的|煤油|液体换|换一种液体|换液体|温度|电压|电流|换(?:成)?[^，。？！；]{0,6}(?:铁|铝|铜|木|冰)|挪到|放到(?:水|酒精|水银))/;

/**
 * 没有数字、也没有「换液体」这类现场词，但老师确实换了例子/条件——
 * 文科与语言类课堂的常见形态：「把 yesterday 拿掉」「换成 last night」「假设他迟到了」。
 * 这类换题不触发换板，板会一直停在上一个例句上。
 */
const VARIANT_WORDS = /(换成|改成|改为|拿掉|去掉|删掉|变成|再试|反过来|假设|假如|要是|换一(?:个|种|场)|变化后的?现场|另一种(?:情况|情形))/;
const NOT_EXAMPLE_CHANGE = /(换个说法|换一种说法|换句话说|换(?:一)?个(?:角度|思路)|从另一个角度)/;
/**
 * 「把顺序倒过来」这类反事实：不是新例子，但也绝不是「板面不用动」。
 * 只认带顺序/流程语境的假设句，避免「如果有不懂就问我」把板换掉。
 */
// 反事实的两种说法：①「假设/如果 + 倒过来/顺序」；② 直接写没发生的走法（只给十金/未处罚）。
// 模型会把语序倒过来（「把顺序倒过来试试：假设…」），所以不按固定顺序匹配，按线索计数。
const HYPOTHETICAL_LEAD = /(假如|如果|要是|倘若|假设)/;
const HYPOTHETICAL_SHAPE = /(倒过来|反过来|顺序|先[^。？！]{0,12}(?:再|才|然后)|照抄|换一(?:个|种))/;
const COUNTERFACTUAL_DETAIL = /(只给|只取|只发|实发|仅发|少给|未加|没给|不认账|没兑现)/;

const numbersIn = (s: string): string[] => {
  const out: string[] = [];
  for (const m of s.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(m[0].replace(/,/g, ''));
  return out;
};

/** 从板面 spec 里抽数字，交给 decideBoardIntent 判「有没有新数据」 */
export function numbersOnBoard(spec: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof spec === 'number') return [String(spec)];
  if (typeof spec === 'string') return numbersIn(spec);
  if (Array.isArray(spec)) return spec.flatMap((v) => numbersOnBoard(v, depth + 1));
  if (spec && typeof spec === 'object') {
    return Object.values(spec as Record<string, unknown>).flatMap((v) => numbersOnBoard(v, depth + 1));
  }
  return [];
}

/** 按图型/任务类型定「这一轮问什么」 */
function defaultAskAbout(kind: string, taskType: string): BoardAskAbout {
  // 对照图有两类问法：诊所（纠错）问「分叉在哪一步」；副驾/沙盘（控制变量）问「哪个条件变了」。
  // 一律按 fork 会让 b2 这类「水 vs 酒精」的对照被当成找错，且 fork 会去挖正确栏的答案。
  if (kind === 'split-compare') return taskType === 'diagnose' || taskType === 'refine' ? 'fork' : 'condition';
  if (kind === 'state-strip') return 'order';
  if (taskType === 'consolidate') return 'mapping';
  if (kind === 'concept-map') return 'condition';
  if (taskType === 'diagnose' || taskType === 'refine') return 'fork';
  return 'none';
}

const INSTRUCTION: Record<BoardAskAbout, string> = {
  fork:
    '这一轮老师要学生指出「分叉在哪一步、错在哪」。板面画到分叉那一步为止：' +
    '两栏的步骤、单位、副标注全部写全，但**不要把最终得数圈出来**，也不要写「分叉在第 n 步」这类结论横幅——' +
    '那句话就是本轮要学生说的。错法栏只放老师本轮点名的那个具体错误：如果两条路径最后得到同一个答案，' +
    '就不是正误对照，不要硬拆成两栏；学生本轮要比较的关键词/条件（时间状语、单位、对象）必须原样留在板面，不能省略成「无」。',
  condition:
    '这一轮老师要学生说清「哪个条件变了、哪个没变」。板面把两个条件的具体数值并排摆全' +
    '（如 浸入 5 cm / 15 cm、排开体积都是 V铁），但**不要写「决定/无关」这类判断词**，' +
    '也不要在底部写总结句——判词留给学生说。',
  order:
    '这一轮老师要学生说出「为什么是这个顺序」。板面把每个阶段的具体事件、时间摆全，' +
    '但标题与帧名只用中性事件名（如「变法前夕 · 南门立木」），**不要出现「取信」「成功」这类结论词**，' +
    '也不要在底部写因果总结。',
  mapping:
    '这一轮老师要学生把结论搬到新情境。板面可以给完整结构 + 结论句（这是迁移的参照物），' +
    '但**不要把这个新情境的答案预先画上去**。',
  none: '本轮不设问，板面按完整参考板画：材料、步骤、副标注写全，不留问号。',
};

/**
 * 裁决本轮板书意图。
 *
 * 换题信号以**老师上一句**为准，老师没说数字时才退回学生这句：
 * 决定用哪组例子的是老师，而学生话里的数字多半是**他自己算出来的结果**
 * （"60 ÷ 0.4 = 150" 里的 150 不是新条件）——拿它当换题信号会让板面跟着学生的得数乱跳。
 */
export function decideBoardIntent(signals: IntentSignals): BoardIntent {
  const kind = String(signals.kind ?? '');
  const taskType = String(signals.taskType ?? '');
  const student = String(signals.studentText ?? '');
  const teacher = String(signals.lastTeacherText ?? '');
  const boardNums = new Set(signals.boardNumbers ?? []);

  const source = teacher.trim() ? teacher : student;
  const fresh = numbersIn(source).filter((n) => !boardNums.has(n));
  // 现场词看**两个人**：数字只认老师（学生话里的数是他的得数），但「挪到水银里」这类
  // 现场变化常常先由学生提出，老师这一句只是在复述旧现场——只看老师会让板落后一轮。
  const sceneChanged = SCENE_WORDS.test(teacher) || SCENE_WORDS.test(student);
  // 时间线题里「假设/假如」本身就足够强：模型会用各种说法包裹它（只随便给一点/换个条件推一推），
  // 继续按搭配词匹配只会漏。非时间线题仍要求「假设 + 形状」两个信号。
  const hypotheticalOrder =
    (kind === 'state-strip' && (COUNTERFACTUAL_DETAIL.test(teacher) || HYPOTHETICAL_LEAD.test(teacher))) ||
    (HYPOTHETICAL_LEAD.test(teacher) && HYPOTHETICAL_SHAPE.test(teacher));
  const variantChanged =
    !NOT_EXAMPLE_CHANGE.test(source) && (VARIANT_WORDS.test(teacher) || hypotheticalOrder);
  // 换场景不要求出现新数字；换例子也可以只靠「改成/拿掉」这类词（语言类课堂没有数字）
  const exampleChange: ExampleChange = sceneChanged
    ? 'scene'
    : fresh.length || variantChanged
      ? 'variant'
      : 'none';
  // 换例信号的来源档位（修复批 4b）：显式换词 > 反事实 > 纯新数字 > 无。shouldSkipExampleRefresh
  // 只对最弱的 variant-numbers 做二次确认——它最容易把「同例深挖」误判成换例。
  // 反事实排在显式换词之前：「假设…倒过来」里的「假设」也命中换词表，但反事实是更具体的信号。
  const changeSignal: BoardIntent['changeSignal'] = sceneChanged
    ? 'scene'
    : hypotheticalOrder
      ? 'hypothetical'
      : VARIANT_WORDS.test(teacher) && !NOT_EXAMPLE_CHANGE.test(source)
        ? 'variant-words'
        : fresh.length
          ? 'variant-numbers'
          : 'none';

  const askAbout = defaultAskAbout(kind, taskType);
  const reasonParts: string[] = [`图型 ${kind || '?'}/${taskType || '?'} → 问「${askAbout}」`];
  if (exampleChange === 'variant') {
    reasonParts.push(
      fresh.length ? `老师宣布了新数据 ${fresh.slice(0, 4).join('/')} → 同结构换数` : '老师换了例子（无新数值）→ 同结构改写',
    );
  }
  if (exampleChange === 'scene') reasonParts.push(`出现新条件（换液体/换物体）→ 换场景`);
  if (hypotheticalOrder) reasonParts.push('老师提出反事实顺序 → 需要并排画假设路径');

  // 换现场时最容易出的事故：把旧现场的「前提」原样抄到新现场
  // （水里的「全部浸没 → V排=V石」抄到水银里，就变成错误前提）。
  let instruction =
    exampleChange === 'scene'
      ? `${INSTRUCTION[askAbout]}本轮换了现场：与旧现场绑定的前提（浸没状态、体积关系、温度、溶解度等）` +
        '**不得沿用**——按新现场重写，或留空让学生自己判断。'
      : INSTRUCTION[askAbout];
  if (hypotheticalOrder) {
    // 反事实不是史实：板面必须让「假设」可见，否则学生会把反向流程当成真实发生过的顺序。
    instruction +=
      '本轮老师提出的是**假设顺序**（把顺序倒过来/换一种走法）：保留事实帧，另加一层并排画假设路径，' +
      '并在该层标题或帧名里写明「假设」；不要把假设写成史实，也不要用事实板的旧结论回答这个假设。';
  }

  return {
    askAbout,
    exampleChange,
    changeSignal,
    ...(hypotheticalOrder ? { hypothetical: true } : {}),
    newNumbers: [...new Set(fresh)].slice(0, 8),
    instruction,
    reason: reasonParts.join('；'),
  };
}

/* ────────── 换例重绘守门（2026-11-13 修复批 4b，BOARD_MISMATCH 聚类 major×3） ──────────
 * 课堂评审三个 major 的共同链路：换例信号最弱一档（老师只是提到板上还没有的数字）被当成
 * 换题 → designBoard 把同一例子的板重绘成编造的变体 → 板面与教师开场口述/旧板自相矛盾，
 * 老师再照着新板讲，整课口径翻车（财务课「付出货款 0 元 → 付现 60 万」）。
 *
 * 可复算口径（纯函数）：换数触发（changeSignal==='variant-numbers'，即老师没说换成/改成/
 * 假设这类显式换词）且**老师本句仍在引用旧板内容**——旧板 ≥2 个不同字段的文本片段
 * （归一后 ≥2 字）在本句逐字出现 → 老师在深挖同一例子，不是换例 → 本轮抑制重绘、保持旧板。
 * 显式换词（variant-words/scene/hypothetical）一律放行：老师明说要换，重绘是他要的动作。
 */
const BOARD_TEXT_KEYS = new Set(['label', 'sub', 'head', 'title', 'name', 'text', 'note', 'item']);

const normBoardText = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[\s，。、；：！？,.;:!?（）()【】[\]"'“”‘’—-]/g, '');

/** 收集板面 spec 里的文本片段（label/sub/head 等内容字段；id/kind/palette 等元数据不参与） */
export function collectSpecTextFragments(spec: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (Array.isArray(spec)) return spec.flatMap((v) => collectSpecTextFragments(v, depth + 1));
  if (spec && typeof spec === 'object') {
    return Object.entries(spec as Record<string, unknown>).flatMap(([k, v]) => {
      if (!BOARD_TEXT_KEYS.has(k) && typeof v === 'string') return [];
      return collectSpecTextFragments(v, depth + 1);
    });
  }
  if (typeof spec === 'string') return spec.trim() ? [normBoardText(spec)] : [];
  return [];
}

export interface ExampleRefreshGuardInput {
  intent: Pick<BoardIntent, 'changeSignal'>;
  /** 当前板的 spec（maskedSpec，即老师输入里看到的那份现场） */
  boardSpec: unknown;
  /** 老师本句回复 */
  teacherReply: string | null | undefined;
}

export function shouldSkipExampleRefresh(
  input: ExampleRefreshGuardInput,
): { skip: boolean; reason: string; hits: string[] } {
  if (input.intent?.changeSignal !== 'variant-numbers') {
    return { skip: false, reason: `changeSignal=${input.intent?.changeSignal ?? 'none'}（非换数触发，不拦）`, hits: [] };
  }
  const reply = normBoardText(input.teacherReply);
  if (!reply) return { skip: false, reason: '老师本句为空，不判', hits: [] };
  // 去重后按**不同片段值**计数：两行不同 label 各被引用 = 2 处（仍在引用旧板的现场）；
  // 同一行 label+sub 被引用通常也产生 ≥2 个不同片段——都指向「同例深挖」。
  const hits = [...new Set(
    collectSpecTextFragments(input.boardSpec)
      .map((fragment) => fragment.trim())
      .filter((fragment) => fragment.length >= 2 && reply.includes(fragment)),
  )];
  if (hits.length >= 2) {
    return { skip: true, reason: `换数触发但老师本句仍在引用旧板 ${hits.length} 处内容（同例深挖，不是换例）`, hits };
  }
  return { skip: false, reason: `旧板内容命中 ${hits.length} 处（<2），放行重绘`, hits };
}

/* ────────── 纠正语境（2026-11-13 修复批 7，BOARD_MISMATCH critical×2：板书固化学员已纠错误） ──────────
 * 实证（批 D u01 badf3f77）：教师 turn4 纠正试用期档位（analysis.misconceptions 带可复算信号：
 * 「学生误以为一年整落在『三个月以上不满一年』档，试用期上限按一个月算」），但常规意图当轮不刷，
 * rev 停在 2；后续 rev3/rev4 刷新时设计器**盲重建**（不收当前板面），把学员错版又抄回板上，
 * 「上限一个月，正好到顶」一直挂到课终，正落在本课核心边界点上。
 *
 * 两个可复算件（纯函数）：
 *   - mergeCorrectionNotes：误解假设持久化名单（teachingState.lastCorrectionNotes，cap 5、按假设去重）
 *     ——纠正语境跨轮可用，后续任何刷新轮都带着它；
 *   - buildCorrectionDirective：给绘图员的清除禁令（含假设原文——设计器据此知道**哪句话**不得再现）。
 */
export interface BoardCorrectionNote {
  conceptKey: string;
  hypothesis: string;
  turn: number;
  /** 同一错形在本课的累计出现次数（首次=1）；≥2 即「复发」，触发升级指令（修复批 10-D4） */
  hits?: number;
}

const CORRECTION_NOTES_CAP = 5;

export function mergeCorrectionNotes(
  prior: BoardCorrectionNote[] | undefined | null,
  turnMisconceptions: Array<{ conceptKey?: unknown; hypothesis?: unknown }>,
  turnIndex: number,
): BoardCorrectionNote[] {
  const base = Array.isArray(prior) ? prior : [];
  const fresh = (Array.isArray(turnMisconceptions) ? turnMisconceptions : [])
    .map((m) => ({
      conceptKey: String(m?.conceptKey ?? '').slice(0, 40),
      hypothesis: String(m?.hypothesis ?? '').trim().slice(0, 120),
      turn: turnIndex,
    }))
    .filter((note) => note.hypothesis);
  if (fresh.length === 0) return base;
  const seen = new Set(base.map((note) => note.hypothesis));
  // 复发升级（修复批 10-D4，交流体验评审 §19.2#6 同一错误复发时干预降级）：本课已纠过的
  // 错形再次命中时不再只是去重跳过——hits +1 留痕，buildCorrectionDirective 据此出升级指令
  //（复发处禁止直接给答案，改问思路 + 让学员自己产出判别）。
  const recurring = fresh.filter((note) => seen.has(note.hypothesis));
  const novel = fresh.filter((note) => !seen.has(note.hypothesis));
  if (recurring.length === 0) {
    return [...base, ...novel.map((note) => ({ ...note, hits: 1 }))].slice(-CORRECTION_NOTES_CAP);
  }
  const bumped = base.map((note) => (
    recurring.some((r) => r.hypothesis === note.hypothesis)
      ? { ...note, hits: (Number(note.hits) || 1) + 1 }
      : note
  ));
  return [...bumped, ...novel.map((note) => ({ ...note, hits: 1 }))].slice(-CORRECTION_NOTES_CAP);
}

export function buildCorrectionDirective(notes: BoardCorrectionNote[] | undefined | null): string {
  const list = Array.isArray(notes) ? notes.filter((note) => note?.hypothesis) : [];
  if (list.length === 0) return '';
  const escalated = list.some((note) => (Number(note?.hits) || 1) >= 2);
  return '老师此前已纠正过学生的错误理解：' + list.map((note) => `「${note.hypothesis}」`).join('；')
    + '。板面凡与学生被纠正前说法一致的表述（数值、档位、结论、标签），必须按老师纠正后的口径写；'
    + '**不得保留学生的错误版本**。'
    + (escalated
      ? '其中**同一错形已纠正过仍复发**：本轮不得直接给出答案——先让学生说说他是怎么想的，'
        + '再让他自己产出判别办法（这个判断各盯哪个词/怎么验），老师只做确认与补缺口。'
      : '');
}

/**
 * 本轮随消息下发的板面/配图可见文本（修复批 10-D1，答案提前暴露）：布题轮若板面上挂着
 * 本题答案键（u04 实证：板书挂「净占用现金 830」而教师四轮追问「报净额」），题就是走过场。
 * 引擎把这段文本并入复述问扫描源（isCheckpointAnswerAlreadyGiven），board 源单独命中打遥测。
 */
export function collectTurnBoardFaceText(figures: unknown): string {
  if (!Array.isArray(figures)) return '';
  const parts: string[] = [];
  for (const figure of figures) {
    if (!figure || typeof figure !== 'object') continue;
    const spec = (figure as { spec?: unknown }).spec
      ?? (figure as { maskedSpec?: unknown }).maskedSpec
      ?? (figure as { fullSpec?: unknown }).fullSpec
      ?? null;
    const fragments = collectSpecTextFragments(spec);
    if (fragments.length > 0) parts.push(fragments.join(' '));
  }
  return parts.join('\n');
}

/**
 * 副标注里的「剧透判断」：`sub` 本来是写单位/俗称/一句话解释的，
 * 但绘图员会把「数字照搬」「单位写错了」这类判断写进去——它同样是替学生把结论说了。
 * 结构化撤键管不到自由文本，这里按词表清掉；只清带判断词的 sub，单位说明保留。
 */
const JUDGMENT_SUB =
  /(错了|错在|照搬|没换|未换|写成|误把|误用|当成|当作|算成|误当|应该|不该|漏了|漏写|正确做法|错误做法)/;

function stripJudgmentSubs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => stripJudgmentSubs(v));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'sub' && typeof v === 'string' && JUDGMENT_SUB.test(v)) continue;
    out[k] = stripJudgmentSubs(v);
  }
  return out;
}

/** 标题里点名了某个实体、而板面正文里根本没有它 → 撤掉标题（宁可没标题，也不留错标题） */
const ENTITY_WORDS = [
  '深度', '自重', '重力', '密度', '体积', '温度', '电流', '电压', '浓度', '速度',
  '时间', '长度', '面积', '质量', '压强', '浮力', '压力', '溶解度', '电阻', '功率', '热量',
];

export function guardTitleAgainstContent<T>(spec: T): T {
  const s = spec as Record<string, unknown> | null | undefined;
  if (!s || typeof s !== 'object' || typeof s.title !== 'string') return spec;
  const title = s.title;
  const rest = JSON.stringify({ ...s, title: '' });
  const named = ENTITY_WORDS.filter((w) => title.includes(w));
  const orphans = named.filter((w) => !rest.includes(w));
  // 题名里的实体**全部**在板面上找不到，才算标题与内容不符；
  // 只缺一个（比如主题词「浮力」不在节点里）不撤——主题可以比板面宽。
  if (!named.length || orphans.length < named.length) return spec;
  const out = { ...s };
  delete out.title;
  return out as T;
}

/**
 * 纠错轮（fork）把「正确栏的最后一行」挖成 ?：这一行正是老师要学生自己改出来的答案。
 * 错法栏保留原样——对照的语义还在；只把答案从板上拿掉，不把整张图变成卷子。
 * 只在 split-compare 上生效；正确栏按 tone 判断（ok / 非 warn）。
 */
/** split-compare 单栏（left/right）的最小形状视图 */
interface BoardSideSpec {
  head?: unknown;
  tone?: unknown;
  rows?: unknown;
}

/** maskForkAnswer / neutraliseForkHeads 需要读写的最小形状视图 */
interface BoardForkSpec {
  left?: BoardSideSpec | null;
  right?: BoardSideSpec | null;
  [key: string]: unknown;
}

function maskForkAnswer<T extends Record<string, unknown>>(spec: T): T {
  const s = spec as BoardForkSpec;
  if (!s?.left?.rows || !s?.right?.rows) return spec;
  const leftRows = Array.isArray(s.left.rows) ? (s.left.rows as Array<Record<string, unknown>>) : [];
  const rightRows = Array.isArray(s.right.rows) ? (s.right.rows as Array<Record<string, unknown>>) : [];
  const correctKey = s.right.tone === 'warn' && s.left.tone !== 'warn' ? 'left' : 'right';
  const rows = correctKey === 'right' ? rightRows : leftRows;
  if (rows.length < 2) return spec;

  // 只挖最后一行不够：模型常把「240 ÷ 0.8 = 300」放在倒数第二行、最后一行留一个 ?，
  // 答案仍然在板上。尾行是占位时，先把最后一条算式的**结果**挖掉（保留算式骨架）。
  const lastIsPlaceholder = /^[?？]\s*$/.test(String(rows[rows.length - 1]?.label ?? ''));
  const eqAt = !lastIsPlaceholder
    ? -1
    : (() => {
        for (let i = rows.length - 2; i >= 0; i -= 1) {
          const label = String(rows[i]?.label ?? '');
          if (label.lastIndexOf('=') > 0) return i;
        }
        return -1;
      })();
  let nextRows = rows;
  if (eqAt >= 0) {
    const label = String(rows[eqAt].label);
    const eq = label.lastIndexOf('=');
    const next: Record<string, unknown> = { ...rows[eqAt], label: `${label.slice(0, eq + 1).trimEnd()} ?` };
    delete next.sub;
    nextRows = rows.map((r, i) => (i === eqAt ? next : r));
    return { ...s, [correctKey]: { ...s[correctKey], rows: nextRows } } as T;
  }

  const last = nextRows[nextRows.length - 1];
  if (!last || last.label === '?' || last.label === '？' || /=\s*\?$/.test(String(last.label))) {
    return { ...s, [correctKey]: { ...s[correctKey], rows: nextRows } } as T;
  }
  const masked: Record<string, unknown> = { ...last, label: '?' };
  delete masked.sub;
  return {
    ...s,
    [correctKey]: {
      ...s[correctKey],
      rows: [...nextRows.slice(0, -1), masked],
    },
  } as T;
}

/**
 * 栏头里直接写「填 have finished」等于把答案放在标题上——挖行挖不到。
 * 只在 fork 轮清理「填 X」这个片段；清理后太短就保留原栏头（避免把栏头清空）。
 */
function neutraliseForkHeads<T extends Record<string, unknown>>(spec: T): T {
  const s = spec as BoardForkSpec;
  if (!s?.left || !s?.right) return spec;
  const FILL = /(?:应该?|应|请)?填\s*[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)*/;
  const strip = (head: unknown): unknown => {
    if (typeof head !== 'string' || !FILL.test(head)) return head;
    const next = head.replace(FILL, '').replace(/[：:]\s*$/, '').trim();
    // 整个栏头就是「填 X」时不能留空（空栏头会让学生不知道这一栏在比什么）
    return next.length >= 2 ? next : '待判断';
  };
  const left = strip(s.left.head);
  const right = strip(s.right.head);
  if (left === s.left.head && right === s.right.head) return spec;
  return { ...s, left: { ...s.left, head: left }, right: { ...s.right, head: right } } as unknown as T;
}

/**
 * 按意图对**已归一化**的板面收口：把「本轮要学生说出口的那句话」从板上撤掉。
 *
 * 只动结论句（概念图 takeaway / 对照图 delta / 时间线 note）、带判断词的副标注，
 * 以及纠错轮正确栏的最后一行；不动材料与步骤——材料属于减负，结论属于学生。
 * `mapping`/`none` 两档保留结论（迁移需要参照物、无问不需要藏）。
 */
export function applyBoardIntent<T extends Record<string, unknown>>(spec: T, intent: BoardIntent): T {
  if (intent.askAbout === 'mapping' || intent.askAbout === 'none') return spec;
  const out: Record<string, unknown> = { ...spec };
  delete out.takeaway;
  delete out.delta;
  delete out.note;
  const stripped = stripJudgmentSubs(out) as Record<string, unknown>;
  const marked = intent.hypothetical ? markHypothetical(stripped) : stripped;
  if (intent.askAbout !== 'fork') return marked as T;
  return neutraliseForkHeads(maskForkAnswer(marked)) as T;
}

/**
 * 反事实板必须自带「假设」标记：盲评两次都指出，假设帧与史实帧同格式时，
 * 学生单看板会把「未加处罚/实发二十五金」当成真发生过。
 * 只给带反事实线索的帧加前缀；整块板再在标题上标一次（帧都没命中时也有兜底）。
 */
const HYPOTHETICAL_CUE = /(未加|未受|只发|实发|仅发|假设|假如|倒过来|反过来|并非|没给|不认账)/;

function markHypothetical<T extends Record<string, unknown>>(spec: T): T {
  const s = spec as Record<string, unknown>;
  if (!s || typeof s !== 'object') return spec;
  const out: Record<string, unknown> = { ...s };
  if (Array.isArray(out.frames)) {
    out.frames = (out.frames as Array<Record<string, unknown>>).map((frame) => {
      if (!frame || typeof frame !== 'object') return frame;
      const label = String(frame.label ?? '');
      const text = `${label} ${Array.isArray(frame.items) ? frame.items.join(' ') : ''}`;
      if (!HYPOTHETICAL_CUE.test(text)) return frame;
      return { ...frame, label: /^假设/.test(label) ? label : `假设 · ${label || '推演'}` };
    });
  }
  if (typeof out.title === 'string' && out.title && !/^假设(?:推演)?[｜|]/.test(out.title)) {
    out.title = `假设推演｜${out.title}`;
  }
  return out as T;
}

/** 给老师可见描述的补充：这一轮板面为什么画到这里为止 */
export function describeIntentForTeacher(intent: BoardIntent): string {
  const ask: Record<BoardAskAbout, string> = {
    fork: '本轮要学生指出分叉/错在哪一步',
    condition: '本轮要学生说清哪个条件变了、哪个没变',
    order: '本轮要学生说出顺序/因果为什么这样',
    mapping: '本轮要学生把结论搬到新情境',
    none: '本轮不设问',
  };
  return `【本轮意图】${ask[intent.askAbout]}（${intent.reason}）。板面已按此裁剪：属于学生要说的结论不在板上。`;
}

/* ──────────── 指认-板面交叉核对（修复批 13-①，BOARD_MISMATCH 指认落空形态可复算杠杆） ────────────
 * 病历单形态（批 L u01/批 M u01）：教师让学习者看板上「离职后补偿 → 条款效力」、标着
 * 「先行给付」的那条线、「右栏第二行摆着两个比对对象」——但被指认的连线/行在当轮可见 rev
 * 里不存在，学习者按指认看板对不上，关键判断口径无法定位。
 * 判定（可复算）：reply 中带**板面指认语境**的引号片段（指认词在前：看板上「X」/板面「X」；
 * 或指认词在后：标着「X」的那条线）→ 归一 ≥4 字后必须命中当轮板面文本；未命中且也不是
 * 引用此前教师说过的话（引对话豁免）→ 记 miss。引擎据此带修复指令重调一次。
 */
const BOARD_REF_QUOTE_BEFORE
  = /「([^「」]{1,40})」[^。！？?！]{0,10}的那?(?:条线|格|行|帧|支|栏|边|块|部分|节点|一处|一行)/g;

const normRefText = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[\s，。、；：！？,.;:!?（）()【】[\]"'"“”‘’—→⇒-]/g, '');

export function findUnmatchedBoardReferences(input: {
  reply: string | null | undefined;
  boardText: string | null | undefined;
  priorTeacherText?: string | null;
}): { misses: string[] } {
  const reply = String(input?.reply ?? '');
  if (!reply) return { misses: [] };
  const boardNorm = normRefText(input?.boardText);
  const priorNorm = normRefText(input?.priorTeacherText);
  const misses: string[] = [];
  const check = (raw: string) => {
    const norm = normRefText(raw);
    if (norm.length < 4 || misses.length >= 3) return;
    if (boardNorm.includes(norm)) return;
    if (priorNorm && priorNorm.includes(norm)) return; // 引对话豁免：教师在引用此前说过的话
    misses.push(raw.trim().slice(0, 40));
  };
  // 形态一：指认词在前——看板上「X」/右栏「X」
  for (const match of reply.matchAll(/((?:(?:看)?板上|板面|白板|右栏|左栏|那格|那一格|那一行|那一帧|那一支|那条线|那一条线|节点)[^「」]{0,8})「([^「」]{1,40})」/g)) {
    check(match[2]);
  }
  // 形态二：指认词在后——标着「X」的那条线
  for (const match of reply.matchAll(BOARD_REF_QUOTE_BEFORE)) {
    check(match[1]);
  }
  return { misses };
}

/**
 * 无板面时的板面指认检测（修复批 15-②，BOARD_DANGLING_TRACE 批 14 critical：板面快照缺失
 * 而教师话语隐含指代可视化材料——「直接拿刚才那个词」「第8条」）。本课当前没有板面（board
 * 为空）而 reply 用板面指认词说话 → 学习者面对的是不存在的参照物。同一句含否定（「不用写在
 * 板上」）时豁免。
 */
const BOARD_REF_MARKER = /(?:看)?板上|板面|白板|右栏|左栏|屏幕上这份|那一帧|那份图/;
const BOARD_REF_NEGATION = /不(会|要|用|需|是)[^。！？?！]{0,6}(?:放|写|画|摆|呈现在?)?\s*(?:在)?\s*(?:看)?板上|板面|白板/;

export function referencesBoardWithoutBoardAvailable(
  reply: string | null | undefined,
): { referenced: true; snippet: string } | null {
  const text = String(reply ?? '');
  if (!text) return null;
  const match = text.match(BOARD_REF_MARKER);
  if (!match) return null;
  // 否定句豁免：命中标记所在的句子若含「不用写在板上」类表述，不算指认
  const sentence = text.split(/(?<=[。！？?！])/).find((part) => BOARD_REF_MARKER.test(part)) ?? text;
  if (BOARD_REF_NEGATION.test(sentence)) return null;
  return { referenced: true, snippet: sentence.trim().slice(0, 120) };
}

/* ──────────── 板面数字-指标绑定一致性守卫（修复批 36-②，BOARD-001 u04 reeval29 critical 实证） ────────────
 * 病历单：T6 教师明言「腾讯净利润是 2298 亿」，后续板面 frame 却把 2298 写进「营业收入」行
 * （营收应远大于净利），学习者可见至课终——数字被绑到错误指标上。
 * 两件纯函数：
 *   - extractTeacherNumberBindings：从教师文本提取「(指标)是/为/达(数字)亿」绑定；
 *   - maskMismatchedBoardNumberLabels：板面文本字段里「指标 + 同数字」组合若与教师绑定冲突
 *     （同数字被绑到别的指标、且没有任何绑定支持本指标），把数字挖成 ?（答案不上板纪律：
 *     让学习者按教师口径自己填，而不是错着抄）。
 * 宁窄勿宽：只处理亿级 ≥3 位数字；指标词取自数字前紧邻的中文段；无绑定支持冲突时不动作。
 */
export interface TeacherNumberBinding {
  metric: string;
  number: string;
}

const METRIC_MIN_LENGTH = 2;

export function extractTeacherNumberBindings(texts: ReadonlyArray<string | null | undefined>): TeacherNumberBinding[] {
  const out: TeacherNumberBinding[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    // 引号是指标段的定界符（「资产负债表"资产总计"是 28527 亿」），先剥掉让指标段连续
    const source = String(text ?? '').replace(/[“”「」'""]/g, '');
    if (!source) continue;
    for (const match of source.matchAll(/([\u4e00-\u9fa5]{2,12})(?:是|为|达|达到|高达)\s*([\d,]+(?:\.\d+)?)\s*亿/g)) {
      const metric = match[1].replace(/^(说|的|那|这|其)/, '');
      const number = match[2].replace(/,/g, '');
      if (metric.length < METRIC_MIN_LENGTH || number.replace(/\./g, '').length < 3) continue;
      const key = `${metric}|${number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ metric, number });
    }
  }
  return out;
}

const BOARD_NUMBER_LABEL = /([\u4e00-\u9fa5A-Za-z]{2,10})\s*([\d,]+(?:\.\d+)?)\s*亿/;

export function maskMismatchedBoardNumberLabels<T>(spec: T, bindings: ReadonlyArray<TeacherNumberBinding>): { spec: T; masked: string[] } {
  const masked: string[] = [];
  if (bindings.length === 0) return { spec, masked };
  const byNumber = new Map<string, string[]>();
  for (const binding of bindings) {
    const list = byNumber.get(binding.number) ?? [];
    list.push(binding.metric);
    byNumber.set(binding.number, list);
  }
  const walk = (value: any, depth: number): any => {
    if (depth > 6) return value;
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = walk(item, depth + 1);
      return out;
    }
    if (typeof value !== 'string') return value;
    return value.replace(BOARD_NUMBER_LABEL, (whole, metricRaw: string, number: string) => {
      const normalized = number.replace(/,/g, '');
      if (normalized.replace(/\./g, '').length < 3) return whole;
      const supported = byNumber.get(normalized);
      if (!supported) return whole; // 教师没绑定过这个数字：不动
      const metric = metricRaw.replace(/^(说|的|那|这|其)/, '');
      if (supported.some((bound) => metric.includes(bound) || bound.includes(metric))) return whole;
      masked.push(whole.trim().slice(0, 40));
      return `${metric} ? 亿`;
    });
  };
  const next = walk(spec, 0);
  return { spec: next as T, masked };
}
