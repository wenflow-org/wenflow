/**
 * 共享白板（2026-10-27 白板改造）：把「图」从一次性消息附件，升级为任务级持久板书。
 *
 * 要解决的问题（V8 报告里的三大死结）：
 *  1. 图教合一 → 老师在同一次模型调用里既写话术又凑 spec，话里的图与真实 spec 不一致
 *     （「右列有两个对象」而图上只有一个）。修法：先定板、再由老师看着**已归一化、已脱敏**的
 *     真实板书说话（见 board-controller 与运行时的两段式调用）。
 *  2. 静态卡片 → 「要么泄题、要么永远残缺」：提问时把答案画上=泄题，挖成 ? 后又不复原=残缺。
 *     修法：同一份 spec 存**两态**（maskedSpec / fullSpec），学生答对后由 reveal 补上，
 *     原本被当病灶删掉的结论（takeaway / delta）变成「闯关奖励」。
 *  3. 每轮重画 → 会话配额、同骨架去重这些闸门只是为了压制刷屏。白板共享后，
 *     同骨架不再是「重复发图」，而是「同一块板上 focus / reveal」。
 *
 * 本模块只做纯计算（给定规范化的 figure → 两态 + 老师可读的画面描述），不碰 IO、不调模型。
 */

import { maskFigureAnswers, stripInLessonAnnotations } from './teaching-visual.service';

/** 白板阶段：搭骨架（提问态）→ 等待学生（仍提问态）→ 揭晓（完整态） */
export type BoardStage = 'setup' | 'awaiting' | 'revealed';

export interface BoardFigureState {
  /** 图型（与 render.ts 的 kind 同一套） */
  kind: string;
  /** 完整 spec：揭晓态下发给前端的形态（含答案与结论） */
  fullSpec: Record<string, unknown>;
  /** 提问态 spec：答案位为 ?、结论未上板；不可安全挖空的图型时与 fullSpec 相同 */
  maskedSpec: Record<string, unknown>;
  /** 被藏到揭晓态的结论（概念图 takeaway / 对照图 delta / 注），null 表示该图无结论项 */
  hiddenTakeaway: string | null;
  /** 待填槽位数（0 = 这张板没有留白，可直接完整展示） */
  slots: number;
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
 * 由一份**已归一化**的 figure 构造两态板书。
 * @param figure 归一化后的 figure（engine 已做过 stripInLessonAnnotations 也可以重复调用，幂等）
 */
export function deriveBoardFigure(figure: { kind?: string; spec?: unknown }): BoardFigureState {
  const deReviewed = stripInLessonAnnotations(figure as Record<string, unknown>) as {
    kind?: string;
    spec?: unknown;
  };
  const fullSpec = ((deReviewed.spec && typeof deReviewed.spec === 'object'
    ? { ...(deReviewed.spec as Record<string, unknown>) }
    : {}) as Record<string, unknown>);
  const hiddenTakeaway = extractHiddenConclusion({ kind: deReviewed.kind, spec: fullSpec });

  // 提问态：能安全挖就挖，挖不动（该图型没有答案位结构）就退化为完整展示——
  // 宁可展示完整，也不要因为「挖空失败」让白板变成一张空白框
  const maskedFigure = maskFigureAnswers({ kind: deReviewed.kind, spec: fullSpec });
  // 提问态 = 骨架 + 空槽：副标注一律归揭晓项（见 stripSecondaryAnnotations 的注释）
  const maskedSpec = stripSecondaryAnnotations(
    maskedFigure ? ((maskedFigure.spec as Record<string, unknown>) ?? fullSpec) : fullSpec,
  );

  // 结论属于「揭晓项」：从提问态整条移除（只留一个 '?' 的横幅没有信息量），
  // 揭晓态由 fullSpec 原样补回——这正是「负面红灯变闯关奖励」的机制
  if (hiddenTakeaway) {
    delete (maskedSpec as Record<string, unknown>).takeaway;
    delete (maskedSpec as Record<string, unknown>).delta;
  }

  const slots = countBoardSlots(maskedSpec);
  return {
    kind: String(deReviewed.kind ?? ''),
    fullSpec,
    maskedSpec,
    hiddenTakeaway,
    slots,
    stage: slots > 0 ? 'setup' : 'revealed',
    focusId: null,
  };
}

/** 建板：以提问态上板（有留白 → awaiting；无留白 → 直接 revealed） */
export function openBoard(taskId: string, figure: { kind?: string; spec?: unknown }): BoardState {
  const derived = deriveBoardFigure(figure);
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

/** 当前应该下发给前端的 spec：提问态发 maskedSpec，揭晓态发完整 spec */
export function boardSpecForRender(board: BoardState): Record<string, unknown> | null {
  const f = board.figure;
  if (!f) return null;
  return f.stage === 'revealed' ? f.fullSpec : f.maskedSpec;
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
export function describeBoardForTeacher(board: BoardState): string {
  const f = board.figure;
  if (!f) return '【白板】本任务暂无板书。请纯用语言推进，不要提及或假设任何图。';

  const spec = f.stage === 'revealed' ? f.fullSpec : f.maskedSpec;
  const title = typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : '';
  const stageCN = f.stage === 'revealed' ? '已揭晓' : f.slots > 0 ? '提问态（有留白）' : '提问态';
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

  if (f.stage !== 'revealed' && f.hiddenTakeaway) {
    lines.push('底部结论：未揭晓（学生答对后再补上）');
  } else if (f.stage === 'revealed' && f.hiddenTakeaway) {
    lines.push(`底部结论（已揭晓）：${f.hiddenTakeaway}`);
  }
  if (f.focusId) lines.push(`本轮焦点：${f.focusId}`);
  lines.push(
    f.slots > 0 && f.stage !== 'revealed'
      ? `共 ${f.slots} 个空槽待学生补。规则：只谈板上已有的内容与空槽，不要替学生补空槽，不要描述图的画法。`
      : '规则：只谈板上已有的内容，不要描述图的画法。',
  );
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
