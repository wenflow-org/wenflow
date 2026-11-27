/**
 * 板书 × 课堂阶段协议（2026-11-26 课堂重设计）。
 *
 * 定位：板书是学生的**外部工作记忆**，不是做题区，也不是每轮重画的配图。
 * 一节任务课里板书只有一块，开课时按材料一次设计完整（带分段标记），之后：
 *   点名部件 → 只有骨架（行列名，格子为空）
 *   分段建构 → 讲一段露一行（轴冻结：行列名一经确定不再改）
 *   整合之后 → 全图
 *
 * 与 board-state.ts 的分工：那边是板书的纯计算基础（两态、挂载、老师可读描述），
 * 这里只放「板书如何随课堂阶段变化」的部分，避免 board-state.ts 继续变长。
 * 同样是纯函数：无 IO、无模型调用。
 */
import type { BoardState } from './board-state';

/**
 * 开课设计整块板时的附加指令。与绘图员自己的「画完整形态、一个 ? 都不要留」同向：
 * 内容一次画全，露多少由系统按阶段决定。
 */
export const BOARD_LESSON_PLAN_INSTRUCTION
  = '这是一节任务课的整块板书：开课一次画完整，之后系统会按教学段逐段露出，行列不再改动。'
  + '① 板面内容以 task.material（课件/讲义原文）为准：材料里的表格，就把表头写进 colLabels、'
  + '把每个单元格的内容写进 cells[].t（一行一格一个短语，≤24 字，不要用 ✓/— 代替内容）；'
  + '② 用 rowSegments（matrix，逐行）或 frameSegments（state-strip，逐帧）给每一行/每一帧标上所属教学段：'
  + '1~4 的整数，按讲解先后排列；系统讲一段露一行；'
  + '③ 行列名用学科真名（如「第二阶段 柠檬酸循环」「线粒体基质」），一经确定本课不再更改；'
  + '④ 判断、口诀、结论句不要上板——那些留给老师问、学生说。';

/**
 * 整课板书模式下绘图员的图型契约。
 *
 * 逐轮配图用的 FIGURE_KIND_GUIDE 在这里不能用：它的「留白关（只给 ? 或空槽）」「对账格留 ? 让学生填」
 * 「表格写正文、不要做成图」与整课板书「一次画完整、不留 ?、对照表就是板」正面冲突——两份规则一起给，
 * 弱一些的模型会各听一半（实录：画出一屏勾叉、或把表格塞回正文）。所以本模式下换成这一份。
 * 字段上限与 skills/teaching-turn 的归一化器一致（超了会被整图拒绝）。
 */
export const BOARD_LESSON_KIND_GUIDE = [
  '【整课板书模式 · 图型契约】本节覆盖上面所有「本轮留白 / 留 ? / 换现场 / 表格写正文不要画」的规则：这块板开课一次画完整、整节课不重画，由系统按教学段逐段露出。板上不留 ?、不留空槽——要学生做的判断在对话里，不在板上。',
  '按「材料怎么组织」选图型，只用下面六种：',
  '- matrix（默认，首选）：材料能整理成「几个对象 × 几个属性」就用它——阶段表、人物观点表、年代流派表、概念辨析表、步骤对照表。'
  + '{"title":"有氧呼吸三个阶段","rowLabels":["第一阶段 糖酵解","第二阶段 柠檬酸循环"],"colLabels":["场所","反应物","产物","能量"],'
  + '"cells":[{"r":0,"c":0,"t":"细胞质基质","tone":"key"},{"r":0,"c":1,"t":"C₆H₁₂O₆"},{"r":0,"c":2,"t":"2 丙酮酸 + 4[H]"}],"rowSegments":[1,2]}',
  '  · 行 2~8、列 2~8；行列名 ≤18 字；每格 t ≤24 字，写材料里的内容本身（术语、数值+单位、短语），不要用 ✓/— 代替内容；'
  + '材料里确实没有的格子不给（不要写「无」）；tone 只用来标少量关键格（"key"），不要全表同一个 tone；',
  '  · rowSegments 与 rowLabels 等长：每一行一个 1~4 的整数，按讲解先后给段号，同一段讲的行给同一个号；行的顺序就是讲解顺序——学生是从上到下一段一段看到它出现的。',
  // 2026-11-26 B8 实录：升档模型把一句转述拆成「转述」「转述（续）」两列，同一维度裂开，
  // 学生按列读对不上；列本身必须是同一个维度。
  '  · 列是同一个维度：不要把一句话拆成「转述」「转述（续）」这类补列——一句话放一格，太长就压成短语；每一列各行的粒度要一致。',
  '- state-strip：真有先后的过程（步骤、阶段推进、历史分期）。'
  + '{"title":"…","frames":[{"label":"第①步 糖酵解","items":["场所：细胞质基质","产物：2 丙酮酸"]}],"frameSegments":[1,2]}'
  + '——2~8 帧、每帧 items ≤3 条、每条 ≤18 字；frameSegments 与 frames 等长（1~4）；并列的分类不要用条带。',
  '- cycle：首尾相接的循环（3~6 个节点；label ≤18 字、sub ≤22 字）。{"center":"…","nodes":[{"label":"…","sub":"…"}]}',
  '- tree：一个主题下的分类层级（2~6 个分支，每支 items ≤2 条、每条 ≤26 字）。{"root":{"label":"…"},"branches":[{"label":"…","items":["…","…"]}]}',
  '- venn：两个概念的重叠与独有（每侧 items ≤4 条、每条 ≤26 字）。{"left":{"head":"…","items":["…"]},"right":{"head":"…","items":["…"]},"overlap":{"head":"…","items":["…"]}}',
  '- concept-map：要素之间「谁产生谁 / 谁决定谁」的机制结构（≤10 个节点、≤14 条边；每条边必须有关系名，≤10 字；不要写 takeaway）。'
  + '{"nodes":[{"id":"a","label":"…","sub":"…"}],"edges":[{"from":"a","to":"b","label":"产生"}]}',
  '通用：标题只点题、不写结论（≤42 字）；标签用学科真名（写「线粒体基质」，不写「那个地方」）；化学式用 Unicode 下标（H₂O、CO₂）；'
  + '判断句、口诀、「所以…」一律不上板；拿不准的事实不要上板（宁可少一格，不要写错一格）。',
].join('\n');

const BOARD_MATERIAL_MAX_CHARS = 6000;
/**
 * 一节课里板书最多设计几次：首轮 1 次，没画出来（调用失败/契约不成立）时点名与建构阶段每回合可再试 1 次。
 * 绘图员明确「这课不该画板」不算失败、不重试——那是判断，不是故障。
 */
export const BOARD_DESIGN_MAX_ATTEMPTS = 3;

/**
 * 绘图员的材料入口（材料回退链）。
 *
 * 实录里绘图员只拿到 `task.material = null`（path-task-design 没写 materialPayload 时 sidecar 缺失），
 * 于是画出一屏勾叉。同一个任务其实有材料：教师侧早已拿到章节原文窗口（activeTaskMaterialExcerpts）
 * 与路径资料投影（materials），只是没有一并送给绘图员。顺序：材料本体 → 章节原文 → 资料投影。
 */
export function resolveBoardMaterial(input: {
  taskMaterialPayload?: string | null;
  excerpts?: Array<{ materialName?: string | null; sectionTitle?: string | null; excerpt?: string | null }> | null;
  materials?: Array<{ title?: string | null; tldr?: string | null; keyPoints?: Array<{ text?: string | null }> | null }> | null;
  maxChars?: number;
}): string | null {
  const maxChars = input.maxChars ?? BOARD_MATERIAL_MAX_CHARS;
  const clip = (text: string) => (text.length > maxChars ? `${text.slice(0, maxChars)}…` : text);
  const direct = String(input.taskMaterialPayload || '').trim();
  if (direct) return clip(direct);

  const excerptBlocks = (input.excerpts || [])
    .map((item) => {
      const body = String(item?.excerpt || '').trim();
      if (!body) return '';
      const heading = [item?.materialName, item?.sectionTitle].filter(Boolean).join(' · ');
      return `【${heading || '资料'}】\n${body}`;
    })
    .filter(Boolean);
  if (excerptBlocks.length > 0) return clip(excerptBlocks.join('\n\n'));

  const materialBlocks = (input.materials || [])
    .map((item) => {
      const points = (item?.keyPoints || []).map((point) => String(point?.text || '').trim()).filter(Boolean);
      const body = [String(item?.tldr || '').trim(), ...points].filter(Boolean).join('\n');
      return body ? `【${String(item?.title || '资料')}】\n${body}` : '';
    })
    .filter(Boolean);
  if (materialBlocks.length > 0) return clip(materialBlocks.join('\n\n'));
  return null;
}

type MatrixLikeSpec = {
  rowLabels?: unknown;
  colLabels?: unknown;
  cells?: unknown;
  frames?: unknown;
};

/**
 * 空壳矩阵判定（纯函数，对 figure；board-state.isDegenerateFirstBoard 是它的首版包装）。
 *
 * 「空壳」= 板上没有任何可读内容，只有状态符号。三种形态都算（实录里出现过前两种）：
 *  - 格子稀疏且无文字（4×4 只打了 4 个勾）：它是一张答案键，不是板书；
 *  - 铺满整格、全部同一种 tone（18 格全 hit / 全 key）：信息量为零；
 *  - `key` 占比 > 40%：`key` 的原义是「关键」，学生读到的却是一屏 ≡。
 * 有任一格带文字（cells[].t）即视为有内容，不判退化。
 */
export function isDegenerateMatrixFigure(figure: { kind?: string; spec?: unknown } | null | undefined): boolean {
  if (!figure || figure.kind !== 'matrix') return false;
  const spec = (figure.spec ?? {}) as MatrixLikeSpec;
  const rows = Array.isArray(spec.rowLabels) ? spec.rowLabels.length : 0;
  const cols = Array.isArray(spec.colLabels) ? spec.colLabels.length : 0;
  if (!rows || !cols) return false;
  const cells = Array.isArray(spec.cells) ? (spec.cells as Array<{ tone?: unknown; t?: unknown }>) : [];
  if (cells.some((cell) => typeof cell?.t === 'string' && cell.t.trim())) return false;
  if (cells.length < rows * cols) return true;
  const tones = cells.map((cell) => String(cell?.tone ?? ''));
  if (tones.length === 0) return true;
  const keyRatio = tones.filter((tone) => tone === 'key').length / tones.length;
  return tones.every((tone) => tone === tones[0]) || keyRatio > 0.4;
}

/** 教学段总数（板书分了几段）；没有分段信息时为 0。 */
export function boardSegmentCount(spec: Record<string, unknown> | null | undefined): number {
  if (!spec) return 0;
  const map = Array.isArray(spec.rowSegments)
    ? spec.rowSegments
    : Array.isArray(spec.frameSegments)
      ? spec.frameSegments
      : null;
  if (!map) return 0;
  // 按「不同段号」计数并与 normalizeSegmentMap 的上限对齐（2026-11-26 工程外审）：
  // 旧实现取最大值——段号带洞（[1,1,3,3]）时会算成 3 段，而教学段只有 2 段，
  // 第 3 段永远等不到露出。段号在上游已重映射为连续 1..N，这里只做防御性封顶。
  const distinct = new Set(
    map
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => Number.isInteger(value) && value >= 1),
  );
  return Math.min(4, distinct.size);
}

/**
 * 板书露出到第 `level` 段（0 = 只有骨架）。不改 fullSpec，只改本轮下发的 maskedSpec。
 *
 * 版本号编码为「内容版本 × 10 + 露出段数」：同一块内容不同露出程度必须是不同版本，
 * 否则「板没变不重发」的守卫（getLastSentBoardRevision）会把新一轮的露出当成没变而不下发。
 * 露出只增不减，所以编码单调递增；没有分段信息的板原样返回（由调用方决定骨架态要不要出板）。
 */
export function revealBoardTo(board: BoardState, level: number): BoardState {
  const figure = board.figure;
  if (!figure) return board;
  const spec = figure.maskedSpec as Record<string, unknown>;
  const safeLevel = Math.max(0, Math.trunc(level));
  if (Array.isArray(spec.rowSegments)) {
    const segments = spec.rowSegments as number[];
    const revealed = segments.map((segment) => segment <= safeLevel);
    const cells = Array.isArray(spec.cells) ? spec.cells : [];
    return {
      ...board,
      figure: {
        ...figure,
        maskedSpec: {
          ...spec,
          rowRevealed: revealed,
          cells: cells.filter((cell) => revealed[Number((cell as { r?: unknown }).r)] === true),
        },
      },
      revision: board.revision * 10 + safeLevel,
    };
  }
  if (Array.isArray(spec.frameSegments)) {
    const segments = spec.frameSegments as number[];
    const frames = Array.isArray(spec.frames) ? spec.frames as Array<Record<string, unknown>> : [];
    const revealed = segments.map((segment) => segment <= safeLevel);
    return {
      ...board,
      figure: {
        ...figure,
        maskedSpec: {
          ...spec,
          frameRevealed: revealed,
          // 骨架态保留帧名（学生先认识「有哪几步」），帧内状态快照讲到才出现
          frames: frames.map((frame, index) => (revealed[index] ? frame : { ...frame, items: [] })),
        },
      },
      revision: board.revision * 10 + safeLevel,
    };
  }
  return board;
}

/**
 * 换板/纠错刷新后的板与原板「轴」是否一致（轴冻结，只增不改）。
 * matrix：行列名逐字相同；state-strip：帧数与帧名相同；其它图型：图型与首层键集合相同。
 * 不一致时调用方保持旧板——实录里 8 个版本换了 6 次轴，学生每轮都要重新找参照物。
 */
export function isAxisCompatible(
  previous: { kind?: string; spec?: unknown } | null | undefined,
  next: { kind?: string; spec?: unknown } | null | undefined,
): boolean {
  if (!previous || !next) return true;
  if (String(previous.kind) !== String(next.kind)) return false;
  const before = (previous.spec ?? {}) as MatrixLikeSpec;
  const after = (next.spec ?? {}) as MatrixLikeSpec;
  if (previous.kind === 'matrix') {
    return JSON.stringify(before.rowLabels) === JSON.stringify(after.rowLabels)
      && JSON.stringify(before.colLabels) === JSON.stringify(after.colLabels);
  }
  if (previous.kind === 'state-strip') {
    const names = (frames: unknown) => (Array.isArray(frames) ? frames as Array<{ label?: unknown }> : []).map((frame) => String(frame?.label ?? ''));
    return JSON.stringify(names(before.frames)) === JSON.stringify(names(after.frames));
  }
  // 其它图型：「轴」= 首层的结构键。结论句、标题、图例、焦点都是可以随讲解变的内容，不算轴。
  const keys = (spec: Record<string, unknown>) => Object.keys(spec)
    .filter((key) => !['title', 'note', 'focus', 'takeaway', 'delta', 'legend'].includes(key))
    .sort();
  return JSON.stringify(keys(before as Record<string, unknown>)) === JSON.stringify(keys(after as Record<string, unknown>));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 指称修正（指称完整性）：老师把「列」说成「行」、把「行」说成「列」时按板上的标签原文改回。
 *
 * 实录：老师两次说「「[H] 由谁产生」那一行」，而它是列；学生按「行」去找找不到，
 * 指《 signalling 高亮不够，是"指称对象对不上"——这一步可以确定性修掉，不必重调模型。
 * 只改「「标签原文」+ 那这/一 + 行/列」这一种明确形态，不做泛化的语义改写。
 */
export function fixBoardAxisDeixis(
  reply: string,
  board: BoardState | null | undefined,
): { reply: string; fixed: string[] } {
  const text = String(reply ?? '');
  const figure = board?.figure;
  if (!text.trim() || !figure || figure.kind !== 'matrix') return { reply: text, fixed: [] };
  const spec = figure.maskedSpec as MatrixLikeSpec;
  const rowLabels = (Array.isArray(spec.rowLabels) ? spec.rowLabels : []).map((item) => String(item ?? '').trim()).filter((label) => label.length >= 2);
  const colLabels = (Array.isArray(spec.colLabels) ? spec.colLabels : []).map((item) => String(item ?? '').trim()).filter((label) => label.length >= 2);
  const rowSet = new Set(rowLabels);
  const colSet = new Set(colLabels);
  let out = text;
  const fixed: string[] = [];
  const swap = (labels: string[], wrongAxis: string, rightAxis: string) => {
    for (const label of labels) {
      // 既是行名又是列名（如「场所」）→ 指称本身有歧义，不改
      if (rowSet.has(label) && colSet.has(label)) continue;
      const pattern = new RegExp(`「${escapeRegExp(label)}」(\\s*(?:那|这)?一?)${wrongAxis}`, 'g');
      const before = out;
      out = out.replace(pattern, (_match, prefix: string) => `「${label}」${prefix}${rightAxis}`);
      if (out !== before) fixed.push(`${label}：${wrongAxis}→${rightAxis}`);
    }
  };
  // 列名被叫成「行」→ 改成「列」；行名被叫成「列」→ 改成「行」
  swap(colLabels, '行', '列');
  swap(rowLabels, '列', '行');
  return { reply: out, fixed };
}

/** matrix 可见内容的逐行描述（给老师看的 boardContext 用）。 */
export function describeMatrixRows(spec: Record<string, unknown>): string[] {
  const rowLabels = (Array.isArray(spec.rowLabels) ? spec.rowLabels : []).map((item) => String(item ?? ''));
  const colLabels = (Array.isArray(spec.colLabels) ? spec.colLabels : []).map((item) => String(item ?? ''));
  const revealed = Array.isArray(spec.rowRevealed) ? spec.rowRevealed as boolean[] : null;
  const cells = Array.isArray(spec.cells) ? spec.cells as Array<{ r?: number; c?: number; tone?: string; t?: string }> : [];
  const glyph = (tone: string) => (tone === 'hit' ? '✓' : tone === 'miss' ? '—' : tone === 'dup' ? '叠' : tone === 'key' ? '关键' : '');
  return rowLabels.map((rowLabel, r) => {
    if (revealed && revealed[r] === false) return `- 行「${rowLabel}」：还没讲到，板上这一行是空的`;
    const parts = colLabels.map((colLabel, c) => {
      const cell = cells.find((item) => Number(item.r) === r && Number(item.c) === c);
      if (!cell) return null;
      const value = String(cell.t || '').trim() || glyph(String(cell.tone ?? ''));
      return value ? `${colLabel}=${value}` : null;
    }).filter((part): part is string => !!part);
    return `- 行「${rowLabel}」：${parts.length > 0 ? parts.join('｜') : '（空）'}`;
  });
}
