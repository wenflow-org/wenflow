/**
 * 共享白板（2026-10-27 白板改造）：把「图」从一次性消息附件，升级为任务级持久板书。
 *
 * 定位（2026-10-27 用户定调，一句话：「白板解决的是纯文字认知压力过大的问题，不是做题区」）：
 * 白板是学生的**外部工作记忆**——把多步对比、多变量结构、长背景材料一次摊开，替对话框减负。
 * 因此默认**不靠挖空提问**：材料完整上板，只有「结论句」留给对话（老师问、学生说）。
 * 挖空（conceal:'full'）降级为一种场景专用口径（检索练习），不再当默认。
 *
 * 要解决的问题（V8 报告里的三大死结）：
 *  1. 图教合一 → 老师在同一次模型调用里既写话术又凑 spec，话里的图与真实 spec 不一致
 *     （「右列有两个对象」而图上只有一个）。修法：先定板、再由老师看着**已归一化**的真实板书
 *     说话（见 board-controller 与运行时的两段式调用）。
 *  2. 静态卡片 → 「要么泄题、要么永远残缺」。修法：结论句与材料分离——材料常驻板上，
 *     结论句由对话产生；需要检索时用 reveal 补上（见 conceal 模式说明）。
 *  3. 每轮重画 → 会话配额、同骨架去重这些闸门只是为了压制刷屏。白板共享后，
 *     同骨架不再是「重复发图」，而是「同一块板上 focus / update」。
 *
 * 本模块只做纯计算（给定规范化的 figure → 各模式下的板面 + 老师可读的画面描述），不碰 IO、不调模型。
 */

import { maskFigureAnswers, stripInLessonAnnotations } from './teaching-visual.service';
import { applyBoardIntent, describeIntentForTeacher, type BoardIntent } from './board-intent';

/** 白板阶段：搭骨架（提问态）→ 等待学生（仍提问态）→ 揭晓（完整态） */
export type BoardStage = 'setup' | 'awaiting' | 'revealed';

/**
 * 白板的「藏」到什么程度——这是 2026-10-27 用户定调后的核心开关：
 *
 * 白板的本职是**替学生的文字工作记忆减负**（外化对比、结构、背景），不是做题区。
 * 所以默认不再是「挖空考学生」，而是把材料完整摆出来：
 *   none      全部展示（材料 + 副标注 + 结论句）——纯参考板
 *   takeaway  材料与副标注全展示，只把**结论句**留给对话（老师问、学生说）——推荐默认
 *   full      旧口径：挖答案位 + 撤副标注 + 藏结论（做题区；保留给「检索练习」场景）
 *
 * 为什么还留 full：白板在教学里有两个用途，减负（讲解、推演、背景）与检索（让学生回忆），
 * 后者才需要遮蔽。两者共用一个渲染器、共用一块板，只是 `conceal` 不同。
 */
export type BoardConcealMode = 'none' | 'takeaway' | 'full';

export interface BoardFigureState {
  /** 图型（与 render.ts 的 kind 同一套） */
  kind: string;
  /** 完整 spec：揭晓态下发给前端的形态（含答案与结论） */
  fullSpec: Record<string, unknown>;
  /** 实际下发给学生的 spec：随 conceal 模式不同（none=同 fullSpec） */
  maskedSpec: Record<string, unknown>;
  /** 被藏起来的结论（概念图 takeaway / 对照图 delta / 注），null 表示没有结论项或没藏 */
  hiddenTakeaway: string | null;
  /** 待填槽位数（0 = 这张板没有留白，可直接完整展示） */
  slots: number;
  /** 这张板用的是哪种藏法 */
  conceal: BoardConcealMode;
  /** 本轮板书意图（先定问什么，再决定结论上不上板）；null 表示未裁决 */
  intent?: BoardIntent | null;
  stage: BoardStage;
  /** 老师本轮指向的锚点（行/帧/节点），前端据此高亮；null 表示不指 */
  focusId?: string | null;
}

export interface BoardState {
  taskId: string;
  figure: BoardFigureState | null;
  /** 递增版本号：前端据此判断「白板有没有变」 */
  revision: number;
  /** 上一轮揭晓了什么（给老师的话术用，避免「你答对了」之后无所指） */
  lastReveal?: { revision: number; summary: string } | null;
}

interface TextRef {
  path: string;
  text: string;
}

/** 按路径收集 spec 里的字符串（数组用 [i]），用于槽位计数与两态 diff */
function collectText(value: unknown, path: string, out: TextRef[], depth = 0): void {
  if (depth > 6 || out.length > 200) return;
  if (typeof value === 'string') {
    out.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectText(item, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectText(v, path ? `${path}.${k}` : k, out, depth + 1);
    }
  }
}

const isBlankSlot = (text: string) => /^[?？]$/.test(text.trim());

/**
 * 提问态只留骨架：副标注（sub）整片撤掉，揭晓时补回。
 *
 * 为什么连「事实侧」的 sub 也要撤：实测模型会把结论写进副标注——
 *   split-compare 左栏 sub「秒没换成分钟，还除成了每米」（正是要学生自己说的诊断）
 *   concept-map 节点 sub「深度变，F浮 不变」（正是要学生自己判断的答案）
 * 只挖 label 不挖 sub，白板照样泄题（白板盲评 v3：泄题 75%）。
 * 骨架（label/帧名/节点名）足够让学生看懂「这块板在讨论什么」，解释性文字属于答案面。
 */
function stripSecondaryAnnotations<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => stripSecondaryAnnotations(x)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'sub') continue;
      out[k] = stripSecondaryAnnotations(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** 数提问态里有几个待填槽（学生要产出的量） */
export function countBoardSlots(spec: unknown): number {
  const refs: TextRef[] = [];
  collectText(spec, '', refs);
  return refs.filter((r) => isBlankSlot(r.text)).length;
}

/** 取该图型「被藏起来的结论」：概念图 takeaway / 对照图 delta / 注 */
export function extractHiddenConclusion(figure: { kind?: string; spec?: unknown }): string | null {
  const spec = (figure?.spec ?? {}) as Record<string, unknown>;
  const kind = String(figure?.kind ?? '');
  if (kind === 'concept-map' && typeof spec.takeaway === 'string' && spec.takeaway.trim()) {
    return spec.takeaway.trim();
  }
  if (kind === 'split-compare') {
    const delta = spec.delta as Record<string, unknown> | undefined;
    if (delta && typeof delta.label === 'string' && delta.label.trim() && !isBlankSlot(delta.label)) {
      return delta.label.trim();
    }
  }
  if (typeof spec.note === 'string' && spec.note.trim()) return spec.note.trim();
  return null;
}

/**
 * 减负模式下把模型自己留的占位行删掉（2026-10-27 实拍：none 模式下绘图员仍在
 * 左栏末尾补了一行「？」，等于白板又变成考卷）。
 *
 * 规则：数组里凡是「本身就是空槽字符串」或「label 是空槽」的元素整条去掉；
 * 并在 spec 上打 `placeholder:'none'`，渲染侧据此不再为「另一侧缺行」补虚线空框。
 */
function prunePlaceholderRows<T>(value: T): T {
  const isSlot = (v: unknown) => typeof v === 'string' && /^[?？]$/.test(v.trim());
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v
        .filter((item) => {
          if (isSlot(item)) return false;
          if (item && typeof item === 'object' && isSlot((item as Record<string, unknown>).label)) return false;
          return true;
        })
        .map(walk);
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  const pruned = walk(value) as Record<string, unknown>;
  if (pruned && typeof pruned === 'object') pruned.placeholder = 'none';
  return pruned as T;
}

/**
 * 由一份**已归一化**的 figure 构造板书。
 * @param figure 归一化后的 figure（engine 已做过 stripInLessonAnnotations 也可以重复调用，幂等）
 * @param options.conceal 藏到什么程度，默认 'full'（与既有行为一致）；新默认建议 'takeaway'
 * @param options.intent 本轮板书意图：非 mapping/none 时把「本轮要学生说的那句结论」从板上撤掉
 */
export function deriveBoardFigure(
  figure: { kind?: string; spec?: unknown },
  options: { conceal?: BoardConcealMode; intent?: BoardIntent | null } = {},
): BoardFigureState {
  const conceal = options.conceal ?? 'full';
  const intent = options.intent ?? null;
  const deReviewed = stripInLessonAnnotations(figure as Record<string, unknown>) as {
    kind?: string;
    spec?: unknown;
  };
  const fullSpec = ((deReviewed.spec && typeof deReviewed.spec === 'object'
    ? { ...(deReviewed.spec as Record<string, unknown>) }
    : {}) as Record<string, unknown>);
  const hiddenTakeaway = extractHiddenConclusion({ kind: deReviewed.kind, spec: fullSpec });

  // 减负模式（none / takeaway）：材料、步骤、副标注一律照发——它们正是替学生省力的部分
  // 旧口径（full）：挖答案位 + 撤副标注 + 藏结论，供「检索练习」用
  let maskedSpec: Record<string, unknown>;
  if (conceal === 'none' || conceal === 'takeaway') {
    maskedSpec = prunePlaceholderRows({ ...fullSpec });
  } else {
    const maskedFigure = maskFigureAnswers({ kind: deReviewed.kind, spec: fullSpec });
    maskedSpec = stripSecondaryAnnotations(
      maskedFigure ? ((maskedFigure.spec as Record<string, unknown>) ?? fullSpec) : fullSpec,
    );
  }

  // 结论句是唯一在减负口径里也要留在对话里的东西：
  // 板面负责「材料与结构」，结论由老师问、学生说。
  // 两档都要藏：takeaway 一律藏；none（全展示）在「本轮要学生说结论」时由意图收口再藏一次。
  let hideConclusion = conceal !== 'none';
  if (intent) {
    const beforeKeys = ['takeaway', 'delta', 'note'].filter((k) => k in maskedSpec).length;
    maskedSpec = applyBoardIntent(maskedSpec, intent) as Record<string, unknown>;
    const afterKeys = ['takeaway', 'delta', 'note'].filter((k) => k in maskedSpec).length;
    // 意图撤掉了结论句（且不是 mapping/none 档）→ describe 时按「未上板」说
    if (afterKeys < beforeKeys) hideConclusion = true;
  }
  if (hideConclusion && hiddenTakeaway) {
    delete maskedSpec.takeaway;
    delete maskedSpec.delta;
  }

  const slots = conceal === 'full' ? countBoardSlots(maskedSpec) : 0;
  return {
    kind: String(deReviewed.kind ?? ''),
    fullSpec,
    maskedSpec,
    hiddenTakeaway: hideConclusion ? hiddenTakeaway : null,
    slots,
    conceal,
    intent,
    stage: slots > 0 ? 'setup' : 'revealed',
    focusId: null,
  };
}

/** 建板：按模式上板（有留白 → awaiting；无留白 / 减负模式 → revealed） */
export function openBoard(
  taskId: string,
  figure: { kind?: string; spec?: unknown },
  options: { conceal?: BoardConcealMode; intent?: BoardIntent | null } = {},
): BoardState {
  const derived = deriveBoardFigure(figure, options);
  return {
    taskId,
    figure: { ...derived, stage: derived.slots > 0 ? 'awaiting' : 'revealed' },
    revision: 1,
    lastReveal: null,
  };
}

/** 揭晓：同一块板从提问态切到完整态（这是「答对后补上」的动作，不新建图） */
export function revealBoard(board: BoardState, summary?: string): BoardState {
  if (!board.figure) return board;
  const next: BoardState = {
    ...board,
    figure: { ...board.figure, stage: 'revealed' },
    revision: board.revision + 1,
    lastReveal: {
      revision: board.revision + 1,
      summary: summary ?? board.figure.hiddenTakeaway ?? '白板补上了刚才留空的部分',
    },
  };
  return next;
}

/** 移动焦点（老师指向某一行/帧/节点），不改内容、不增版本语义上的「新内容」 */
export function focusBoard(board: BoardState, focusId: string | null): BoardState {
  if (!board.figure) return board;
  return { ...board, figure: { ...board.figure, focusId }, revision: board.revision + 1 };
}

/**
 * 换板：老师换了例子/条件（800 m 4 min、铁块从水挪到酒精），同结构的板换成新数据。
 *
 * 这是减负模式的核心动作——白板要「永远替学生记住当前在讨论什么现场」。
 * 旧口径里没有这个动作，只能靠 reveal 或干脆不动，于是出现「老师讲新题、板上还是旧题」。
 */
export function updateBoard(
  board: BoardState,
  figure: { kind?: string; spec?: unknown },
  summary?: string,
  intent?: BoardIntent | null,
): BoardState {
  const conceal = board.figure?.conceal ?? 'takeaway';
  const derived = deriveBoardFigure(figure, { conceal, intent: intent ?? board.figure?.intent ?? null });
  return {
    ...board,
    figure: { ...derived, stage: 'revealed', focusId: board.figure?.focusId ?? null },
    revision: board.revision + 1,
    lastReveal: summary ? { revision: board.revision + 1, summary } : null,
  };
}

/** 当前应该下发给前端的 spec：随 conceal 模式与阶段而定（老师可见的同一份） */
export function boardSpecForRender(board: BoardState): Record<string, unknown> | null {
  const f = board.figure;
  if (!f) return null;
  return visibleSpec(f);
}

/** 白板可下发的最小 figure 形态（前端 TeachingFigure 直接用） */
export function boardFigureForRender(board: BoardState): { kind: string; spec: Record<string, unknown> } | null {
  const spec = boardSpecForRender(board);
  if (!spec || !board.figure) return null;
  return { kind: board.figure.kind, spec };
}

/**
 * 老师可见画面的**文本描述**——这是「图教分离」的关键输入。
 *
 * 设计要点：只描述**板上真实可见**的内容（经归一化裁剪、经脱敏挖空之后的），
 * 并且明确标出空槽与未揭晓的结论。老师在提示词里看到的就是学生在白板上看到的东西，
 * 因此不可能再指着不存在的东西说话（V8 的 #15/#16/#27 病灶）。
 */
/** 老师此刻看到的那份 spec：与下发给学生的完全一致 */
function visibleSpec(f: BoardFigureState): Record<string, unknown> {
  if (f.conceal === 'full') return f.stage === 'revealed' ? f.fullSpec : f.maskedSpec;
  return f.maskedSpec;
}

export function describeBoardForTeacher(board: BoardState): string {
  const f = board.figure;
  if (!f) return '【白板】本任务暂无板书。请纯用语言推进，不要提及或假设任何图。';

  const spec = visibleSpec(f);
  const title = typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : '';
  const stageCN =
    f.conceal !== 'full'
      ? '完整板书'
      : f.stage === 'revealed'
        ? '已揭晓'
        : f.slots > 0
          ? '提问态（有留白）'
          : '提问态';
  const lines: string[] = [
    `【白板｜${stageCN}】图型 ${f.kind}${title ? `，标题「${title}」` : ''}`,
  ];

  const perKind = describeByKind(f.kind, spec);
  if (perKind.length) lines.push(...perKind);
  else {
    const refs: TextRef[] = [];
    collectText(spec, '', refs);
    const texts = refs.map((r) => (isBlankSlot(r.text) ? '（空槽）' : r.text)).filter(Boolean).slice(0, 14);
    if (texts.length) lines.push(`板上文字（按顺序）：${texts.join(' / ')}`);
  }

  // 结论到底在不在板上，以「实际下发的那份 spec」为准——意图收口后可能被撤掉
  const conclusionOnBoard = 'takeaway' in spec || 'delta' in spec || 'note' in spec;
  if (f.hiddenTakeaway && !conclusionOnBoard) {
    const why = f.conceal === 'full' && f.stage !== 'revealed' ? '未揭晓（学生答对后再补上）' : '**未上板**（这条要留给学生说，不要替他说出来）';
    lines.push(`底部结论：${why}`);
  } else if (f.hiddenTakeaway) {
    lines.push(`底部结论（已上板）：${f.hiddenTakeaway}`);
  }
  if (f.focusId) lines.push(`本轮焦点：${f.focusId}`);

  if (f.conceal === 'full') {
    lines.push(
      f.slots > 0 && f.stage !== 'revealed'
        ? `共 ${f.slots} 个空槽待学生补。规则：只谈板上已有的内容与空槽，不要替学生补空槽，不要描述图的画法。`
        : '规则：只谈板上已有的内容，不要描述图的画法。',
    );
  } else {
    lines.push(
      '规则（减负模式）：板面已经把背景、数据与结构完整摆出来了，它就是学生的外部工作记忆。' +
        '严禁用文字复述板上已有的内容（不要念列表、念步骤、念数值），也不要描述图的画法；' +
        '直接引用板上的标签/行号/帧号，一次只说 2~3 句，把「为什么」「下一步」留给学生。',
    );
  }
  if (f.intent) lines.push(describeIntentForTeacher(f.intent));
  return lines.join('\n');
}

/** 按图型把可见内容分行描述（尽量保留「哪一栏/哪一帧/哪个节点」的结构） */
function describeByKind(kind: string, spec: Record<string, unknown>): string[] {
  const out: string[] = [];
  const show = (v: unknown) => (isBlankSlot(String(v ?? '')) ? '（空槽）' : String(v ?? ''));
  const joinItems = (items: unknown) =>
    Array.isArray(items) ? items.map((x) => show(x)).join(' / ') : '';

  if (kind === 'split-compare') {
    for (const side of ['left', 'right'] as const) {
      const panel = spec[side] as Record<string, unknown> | undefined;
      if (!panel) continue;
      const rows = Array.isArray(panel.rows) ? (panel.rows as Array<Record<string, unknown>>) : [];
      const cells = rows.map((r, i) => `${i + 1}.${show(r.label)}${r.sub ? `（${String(r.sub)}）` : ''}`).join(' ');
      out.push(`- ${side === 'left' ? '左栏' : '右栏'}「${String(panel.head ?? '')}」：${cells || '（空）'}`);
    }
    const delta = spec.delta as Record<string, unknown> | undefined;
    if (delta) out.push(`- 底部结论：${isBlankSlot(String(delta.label ?? '')) ? '未揭晓' : show(delta.label)}`);
    return out;
  }

  if (kind === 'state-strip') {
    const frames = Array.isArray(spec.frames) ? (spec.frames as Array<Record<string, unknown>>) : [];
    frames.forEach((f, i) => {
      out.push(`- 第 ${i + 1} 帧「${String(f.label ?? '')}」：${joinItems(f.items) || '（空）'}`);
    });
    return out;
  }

  if (kind === 'concept-map') {
    const nodes = Array.isArray(spec.nodes) ? (spec.nodes as Array<Record<string, unknown>>) : [];
    const edges = Array.isArray(spec.edges) ? (spec.edges as Array<Record<string, unknown>>) : [];
    out.push(`- 节点：${nodes.map((n) => String(n.label ?? '')).filter(Boolean).join(' / ')}`);
    if (edges.length) {
      out.push(
        `- 边：${edges
          .map((e) => `${String(e.from)}→${String(e.to)}${isBlankSlot(String(e.label ?? '')) ? '（关系名空槽）' : `「${String(e.label)}」`}`)
          .join(' ')}`,
      );
    }
    if (typeof spec.takeaway === 'string' && spec.takeaway.trim()) out.push(`- 结论：${spec.takeaway.trim()}`);
    return out;
  }

  if (kind === 'cartesian-plot') {
    const axis = (a: unknown, name: string) => {
      const o = (a ?? {}) as Record<string, unknown>;
      return `${name}∈[${o.min ?? '?'},${o.max ?? '?'}]${o.label ? `（${String(o.label)}）` : ''}`;
    };
    out.push(`- 坐标：${axis(spec.x, 'x')} ${axis(spec.y, 'y')}${spec.y2 ? `，右轴∈[${(spec.y2 as any).min},${(spec.y2 as any).max}]` : ''}`);
    const series = Array.isArray(spec.series) ? (spec.series as Array<Record<string, unknown>>) : [];
    if (series.length) out.push(`- 曲线：${series.map((s) => String(s.name ?? '')).join(' / ')}`);
    const marks = Array.isArray(spec.marks) ? (spec.marks as Array<Record<string, unknown>>) : [];
    if (marks.length) out.push(`- 标注点：${marks.map((m) => show(m.label)).join(' ')}`);
    const guides = Array.isArray(spec.guides) ? (spec.guides as Array<Record<string, unknown>>) : [];
    if (guides.length) out.push(`- 辅助线：${guides.map((g) => show(g.label) || `${String(g.axis)}=${String(g.at)}`).join(' ')}`);
    return out;
  }

  return out;
}

/**
 * 两态差异：揭晓时白板上会「补上什么」。
 * 用于 reveal 轮的老师话术（「你答对了，板上现在补上了…」），也让评审能量化「藏了多少」。
 */
export function diffBoardStages(figure: BoardFigureState): Array<{ path: string; before: string; after: string }> {
  const before: TextRef[] = [];
  const after: TextRef[] = [];
  collectText(figure.maskedSpec, '', before);
  collectText(figure.fullSpec, '', after);
  const byPath = new Map(after.map((r) => [r.path, r.text]));
  const out: Array<{ path: string; before: string; after: string }> = [];
  for (const b of before) {
    const a = byPath.get(b.path);
    if (a !== undefined && a !== b.text) out.push({ path: b.path, before: b.text, after: a });
  }
  if (figure.hiddenTakeaway) out.push({ path: 'takeaway', before: '（未揭晓）', after: figure.hiddenTakeaway });
  return out;
}
