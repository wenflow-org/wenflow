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
  if (kind === 'split-compare') return 'fork';
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
    '那句话就是本轮要学生说的。',
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
  // 换场景**不要求出现新数字**：老师常说「同一块铁块，现在整块挪到酒精里，浸入体积不变」——
  // 现场已经换了，一个数都没给。若仍以「有新数字」为前提，板会一直停在旧液体上。
  const exampleChange: ExampleChange = sceneChanged ? 'scene' : fresh.length ? 'variant' : 'none';

  const askAbout = defaultAskAbout(kind, taskType);
  const reasonParts: string[] = [`图型 ${kind || '?'}/${taskType || '?'} → 问「${askAbout}」`];
  if (exampleChange === 'variant') reasonParts.push(`老师宣布了新数据 ${fresh.slice(0, 4).join('/')} → 同结构换数`);
  if (exampleChange === 'scene') reasonParts.push(`出现新条件（换液体/换物体）→ 换场景`);

  // 换现场时最容易出的事故：把旧现场的「前提」原样抄到新现场
  // （水里的「全部浸没 → V排=V石」抄到水银里，就变成错误前提）。
  const instruction =
    exampleChange === 'scene'
      ? `${INSTRUCTION[askAbout]}本轮换了现场：与旧现场绑定的前提（浸没状态、体积关系、温度、溶解度等）` +
        '**不得沿用**——按新现场重写，或留空让学生自己判断。'
      : INSTRUCTION[askAbout];

  return {
    askAbout,
    exampleChange,
    newNumbers: [...new Set(fresh)].slice(0, 8),
    instruction,
    reason: reasonParts.join('；'),
  };
}

/**
 * 按意图对**已归一化**的板面收口：把「本轮要学生说出口的那句话」从板上撤掉。
 *
 * 只动结论句（概念图 takeaway / 对照图 delta / 时间线 note），不动材料与步骤——
 * 材料属于减负，结论属于学生。`mapping`/`none` 两档保留结论（迁移需要参照物、无问不需要藏）。
 */
export function applyBoardIntent<T extends Record<string, unknown>>(spec: T, intent: BoardIntent): T {
  if (intent.askAbout === 'mapping' || intent.askAbout === 'none') return spec;
  const out: Record<string, unknown> = { ...spec };
  delete out.takeaway;
  delete out.delta;
  delete out.note;
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
