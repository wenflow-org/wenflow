/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造 spec 载荷 */
/**
 * 本轮板书意图（2026-10-27）：先定这一轮问什么，再决定板上留什么。
 *
 * 验收点：
 *  1) 问法由图型/任务类型决定（对比→分叉、时间线→顺序、概念图→条件、复盘→迁移）；
 *  2) 换题信号要同时读**老师上一句**（老师主动换的数据）与**学生这一句**；
 *  3) 「要学生说的那句结论」按意图从板上撤掉，但材料与步骤一个不少。
 */
import { decideBoardIntent, applyBoardIntent, numbersOnBoard, describeIntentForTeacher, guardTitleAgainstContent, shouldSkipExampleRefresh, mergeCorrectionNotes, buildCorrectionDirective, collectTurnBoardFaceText, findUnmatchedBoardReferences, referencesBoardWithoutBoardAvailable } from '../board-intent';
import { deriveBoardFigure, openBoard, describeBoardForTeacher } from '../board-state';

const splitBoard = {
  left: { head: '常见错法', rows: [{ label: '60 ÷ 400 = 0.15', sub: '秒除以米' }] },
  right: { head: '正确做法', rows: [{ label: '400 m = 0.4 km', sub: '先换单位' }] },
  delta: { label: '分叉在第二步：直接除还是先换算', at: 2 },
  title: '配速换算：60 s 跑完 400 m 该得多少',
};
const conceptBoard = {
  nodes: [{ id: 'a', label: '液体密度 ρ液' }, { id: 'b', label: '浮力 F浮' }],
  edges: [{ from: 'a', to: 'b', label: '决定·正比' }],
  takeaway: '浮力由 ρ液 和 V排 决定；深度、重量不参与',
};

describe('board-intent：问法由图型与任务类型决定', () => {
  it('对比图 → 问分叉；时间线 → 问顺序；概念图 → 问条件；复盘课 → 问迁移', () => {
    expect(decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' }).askAbout).toBe('fork');
    // 控制变量对照（副驾/沙盘）不是找错，问「哪个条件变了」
    expect(decideBoardIntent({ kind: 'split-compare', taskType: 'acquire' }).askAbout).toBe('condition');
    expect(decideBoardIntent({ kind: 'state-strip', taskType: 'acquire' }).askAbout).toBe('order');
    expect(decideBoardIntent({ kind: 'concept-map', taskType: 'acquire' }).askAbout).toBe('condition');
    expect(decideBoardIntent({ kind: 'concept-map', taskType: 'consolidate' }).askAbout).toBe('mapping');
    expect(decideBoardIntent({ kind: 'position-line', taskType: 'acquire' }).askAbout).toBe('none');
  });

  it('换题信号读老师上一句：老师宣布的新数据也算新现场', () => {
    const board = numbersOnBoard(splitBoard);
    // 学生这句只是复述旧数据 → 不换
    expect(
      decideBoardIntent({
        kind: 'split-compare',
        taskType: 'diagnose',
        boardNumbers: board,
        studentText: '400 米要先变成 0.4 千米，所以 60 ÷ 0.4 = 150',
        lastTeacherText: '先看左栏最后那行',
      }).exampleChange,
    ).toBe('none');
    // 老师上一轮宣布 90 秒跑完 300 米 → 这一轮必须换板
    const byTeacher = decideBoardIntent({
      kind: 'split-compare',
      taskType: 'diagnose',
      boardNumbers: board,
      studentText: '好，我先换算',
      lastTeacherText: '换一组数：90 秒跑完 300 米。你会先动哪一步？',
    });
    expect(byTeacher.exampleChange).toBe('variant');
    expect(byTeacher.newNumbers).toEqual(expect.arrayContaining(['90', '300']));
  });

  it('换液体/换物体算换场景，与单纯换数字区分开', () => {
    const board = numbersOnBoard(conceptBoard);
    const scene = decideBoardIntent({
      kind: 'concept-map',
      taskType: 'acquire',
      boardNumbers: board,
      studentText: '那把铁球挪到水银里呢？',
      lastTeacherText: '同一块铁块完全浸在水里时受到的浮力是 8 N',
    });
    expect(scene.exampleChange).toBe('scene');
  });

  it('换液体但没给新数字，也算换场景（板不能停在旧液体上）', () => {
    const board = numbersOnBoard(conceptBoard);
    const scene = decideBoardIntent({
      kind: 'concept-map',
      taskType: 'acquire',
      boardNumbers: board,
      studentText: '那酒精里呢？',
      lastTeacherText: '同一块铁块，原先浸没在水里，现在整块挪到酒精里，浸入的体积跟原来一样。',
    });
    expect(scene.exampleChange).toBe('scene');
    expect(scene.newNumbers).toEqual([]);
    // 换现场时，旧现场的前提不得沿用（水里的「全浸」抄到水银里会变成错误前提）
    expect(scene.instruction).toContain('不得沿用');
  });

  it('换物件的定语写法也算换场景（「换成同体积的木块」）', () => {
    const scene = decideBoardIntent({
      kind: 'concept-map',
      taskType: 'acquire',
      boardNumbers: ['5', '15'],
      studentText: '那木块呢？',
      lastTeacherText: '把这块铁换成同体积的木块，浸没在同一杯水里，浮力变不变？',
    });
    expect(scene.exampleChange).toBe('scene');
  });

  it('「同一块铁、同一杯水」是在描述现状，不算换场景', () => {
    const same = decideBoardIntent({
      kind: 'concept-map',
      taskType: 'acquire',
      boardNumbers: ['5', '15'],
      studentText: '好',
      lastTeacherText: '甲和乙，连的都是同一块铁、也都浸在同一杯水里。哪一个量变了？',
    });
    expect(same.exampleChange).toBe('none');
  });

  it('语言类课堂没有数字，靠「拿掉/换成」也能识别换例子', () => {
    const variant = decideBoardIntent({
      kind: 'split-compare',
      taskType: 'diagnose',
      boardNumbers: ['400', '60'],
      studentText: '好',
      lastTeacherText: '把 yesterday 拿掉，只说 I ___ my homework. 这时 finished 和 have finished 都能填吗？',
    });
    expect(variant.exampleChange).toBe('variant');
    expect(variant.newNumbers).toEqual([]);

    // 只是换个说法，不是换例子
    const rephrase = decideBoardIntent({
      kind: 'split-compare',
      taskType: 'diagnose',
      boardNumbers: ['400', '60'],
      studentText: '好',
      lastTeacherText: '换句话说，单位没有换，只是写法变了。',
    });
    expect(rephrase.exampleChange).toBe('none');
  });
});

describe('board-intent：结论句按意图收口', () => {
  it('问分叉时撤掉 delta 横幅（那句话正是要学生说的）', () => {
    const intent = decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' });
    const out = applyBoardIntent(splitBoard, intent) as any;
    expect(out.delta).toBeUndefined();
    expect(out.left.rows).toHaveLength(1);
    expect(out.right.rows[0].sub).toBe('先换单位'); // 材料与副标注一个不少
    expect(out.title).toBe('配速换算：60 s 跑完 400 m 该得多少');
  });

  it('问条件时撤掉 takeaway 判词；迁移轮保留（那是参照物）', () => {
    const condition = applyBoardIntent(conceptBoard, decideBoardIntent({ kind: 'concept-map', taskType: 'acquire' })) as any;
    expect(condition.takeaway).toBeUndefined();
    expect(condition.edges).toHaveLength(1);

    const mapping = applyBoardIntent(conceptBoard, decideBoardIntent({ kind: 'concept-map', taskType: 'consolidate' })) as any;
    expect(mapping.takeaway).toBe('浮力由 ρ液 和 V排 决定；深度、重量不参与');
  });

  it('不设问时不收口（纯讲解的板可以带结论）', () => {
    const out = applyBoardIntent(conceptBoard, decideBoardIntent({ kind: 'position-line', taskType: 'acquire' })) as any;
    expect(out.takeaway).toBeDefined();
  });

  it('意图进入老师可见描述：说明本轮问什么、结论为什么不在板上', () => {
    const intent = decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose', lastTeacherText: '换一组数：90 秒跑完 300 米' });
    const board = openBoard('t', { kind: 'split-compare', spec: splitBoard }, { conceal: 'none', intent });
    const text = describeBoardForTeacher(board);
    expect(text).toContain('本轮意图');
    expect(text).toContain('分叉');
    expect(text).toContain('未上板');
    expect(text).not.toContain('分叉在第二步：直接除还是先换算');
    expect(describeIntentForTeacher(intent)).toContain('板面已按此裁剪');
  });

  it('full 口径不受意图影响（做题区仍走挖空 + 揭晓）', () => {
    const intent = decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' });
    const f = deriveBoardFigure({ kind: 'split-compare', spec: splitBoard }, { conceal: 'full', intent });
    expect((f.maskedSpec as any).right.rows[0].label).toBe('？');
    expect(f.slots).toBeGreaterThan(0);
  });

  it('副标注里的判断句按意图清掉，纯单位说明保留（b1 实拍）', () => {
    const spec = {
      title: '配速换算',
      left: {
        head: '0.15 的算法',
        rows: [
          { label: '0.15 s/m', sub: '秒每米' },
          { label: '0.15 min/km', sub: '数字照搬，单位写成 min/km' },
        ],
      },
      right: { head: '配速的算法', rows: [{ label: '150 s/km', sub: '秒每千米' }] },
    };
    const fork = applyBoardIntent(spec, decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' })) as any;
    expect(fork.left.rows[0].sub).toBe('秒每米');
    expect(fork.left.rows[1].sub).toBeUndefined();

    // 迁移轮保留结论与副标注（参照物）
    const mapping = applyBoardIntent(spec, decideBoardIntent({ kind: 'concept-map', taskType: 'consolidate' })) as any;
    expect(mapping.left.rows[1].sub).toBe('数字照搬，单位写成 min/km');
  });

  it('副标注出现「把…当成…」也按剧透清掉（iter1 b1 盲评）', () => {
    const spec = {
      title: '配速换算',
      left: {
        head: '常见错法',
        tone: 'warn',
        rows: [
          { label: '60 ÷ 400 = 0.15', sub: '把秒算出的数当成分钟' },
          { label: '0.15 分钟/千米', sub: '单位：分钟/千米' },
        ],
      },
      right: { head: '正确做法', rows: [{ label: '400 m = 0.4 km' }, { label: '60 ÷ 0.4 = 150' }] },
    };
    const fork = applyBoardIntent(spec, decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' })) as any;
    expect(fork.left.rows[0].sub).toBeUndefined();
    expect(fork.left.rows[1].sub).toBe('单位：分钟/千米');
  });

  it('正确栏倒数第二行已经算出结果时，挖的是算式结果而不是尾行占位（iter1 b1 盲评）', () => {
    const spec = {
      left: { head: '错法', tone: 'warn', rows: [{ label: '240 ÷ 800 = 0.3' }, { label: '0.3 分/千米' }] },
      right: {
        head: '正解',
        tone: 'ok',
        rows: [
          { label: '800 m = 0.8 km' },
          { label: '240 ÷ 0.8 = 300', sub: '秒每千米' },
          { label: '?' },
        ],
      },
    };
    const fork = applyBoardIntent(spec, decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' })) as any;
    expect(fork.right.rows[1].label).toBe('240 ÷ 0.8 = ?');
    expect(fork.right.rows[1].sub).toBeUndefined();
    expect(fork.right.rows[2].label).toBe('?');
  });

  it('纠错轮栏头里的「填 have finished」不留在标题上（iter1 c2 盲评）', () => {
    const spec = {
      left: { head: 'since this morning 这一句：填 have finished', tone: 'warn', rows: [{ label: 'A' }, { label: 'B' }] },
      right: { head: '填 finished', tone: 'ok', rows: [{ label: 'C' }, { label: 'D' }] },
    };
    const fork = applyBoardIntent(spec, decideBoardIntent({ kind: 'split-compare', taskType: 'refine' })) as any;
    expect(fork.left.head).toBe('since this morning 这一句');
    expect(fork.right.head).toBe('待判断');
  });

  it('把顺序倒过来的假设句会触发换板（iter1 b3 盲评）', () => {
    const intent = decideBoardIntent({
      kind: 'state-strip',
      taskType: 'explain',
      studentText: '为什么不信任官府？',
      lastTeacherText: '假如这道顺序被倒过来——先颁《垦草令》硬推下去，等各县闹起来了，才回头补做「立木为信」。会怎样？',
    });
    expect(intent.exampleChange).toBe('variant');
    expect(intent.instruction).toContain('假设');
  });

  it('时间线题只要出现「假设」就判反事实，不再要求搭配固定词（iter3c 实拍）', () => {
    const intent = decideBoardIntent({
      kind: 'state-strip',
      taskType: 'acquire',
      lastTeacherText: '换个条件推一推：假设南门那个人真把木头搬走了，官府却没按承诺给五十金，或者只随便给一点。',
    });
    expect(intent.hypothetical).toBe(true);
    // 非时间线题不因一句普通条件句就把整块板标成假设
    const plain = decideBoardIntent({
      kind: 'split-compare',
      taskType: 'diagnose',
      lastTeacherText: '如果不理解就问我，先自己看两栏的单位。',
    });
    expect(plain.hypothetical).toBeUndefined();
  });

  it('「把顺序倒过来试试：假设…」语序颠倒也能判反事实（iter3b 实拍）', () => {
    const intent = decideBoardIntent({
      kind: 'state-strip',
      taskType: 'acquire',
      lastTeacherText: '那我们把这个顺序倒过来试试：假设商鞅先把第一次变法的条文贴满城门，立木的事放到后面再补办。',
    });
    expect(intent.hypothetical).toBe(true);
  });

  it('没有「假设」二字、但写的是没发生的走法，也判反事实（iter3 b3 实拍）', () => {
    const intent = decideBoardIntent({
      kind: 'state-strip',
      taskType: 'acquire',
      lastTeacherText: '换一个情况看看。立木那天，木头搬到北门，官府却只取出五金，说国库一时拿不出五十金。',
    });
    expect(intent.hypothetical).toBe(true);
    const other = decideBoardIntent({
      kind: 'state-strip',
      taskType: 'acquire',
      lastTeacherText: '换个现场试：假设魏国照抄这一套，南门立木、当场兑现五十金。',
    });
    expect(other.hypothetical).toBe(true);
  });

  it('反事实板：假设帧加「假设 ·」前缀，标题标「假设推演」（iter2 盲评）', () => {
    const spec = {
      title: '商鞅变法推行',
      frames: [
        { label: '前356年 · 南门立木', items: ['徙木者予五十金'] },
        { label: '前356年 · 太子犯法', items: ['太子驷犯法', '商鞅未加处罚'] },
      ],
    };
    const intent = decideBoardIntent({
      kind: 'state-strip',
      taskType: 'explain',
      lastTeacherText: '假如这道顺序被倒过来——先颁《垦草令》，才回头补「立木为信」。',
    });
    expect(intent.hypothetical).toBe(true);
    const out = applyBoardIntent(spec, intent) as any;
    expect(out.title).toBe('假设推演｜商鞅变法推行');
    expect(out.frames[0].label).toBe('前356年 · 南门立木');
    expect(out.frames[1].label).toBe('假设 · 前356年 · 太子犯法');
  });

  it('纠错轮把正确栏最后一行挖成 ?，错法栏保留（答案由学生补）', () => {
    const spec = {
      left: { head: '错法', tone: 'warn', rows: [{ label: '60 ÷ 400' }, { label: '0.15 min/km' }] },
      right: { head: '正解', tone: 'ok', rows: [{ label: '400 m = 0.4 km' }, { label: '0.15 s/m', sub: '秒每米' }] },
    };
    const fork = applyBoardIntent(spec, decideBoardIntent({ kind: 'split-compare', taskType: 'diagnose' })) as any;
    expect(fork.right.rows[1].label).toBe('?');
    expect(fork.right.rows[1].sub).toBeUndefined();
    expect(fork.left.rows[1].label).toBe('0.15 min/km');
  });

  it('标题点名了板面没有的实体 → 撤掉标题（b2「深度与自重」实拍）', () => {
    const bad = {
      title: '浮力大小：深度与自重的条件对照',
      nodes: [{ id: 'a', label: '液体密度 ρ液' }, { id: 'b', label: '排开液体体积 V排' }],
      edges: [{ from: 'a', to: 'b' }],
    };
    expect(guardTitleAgainstContent(bad).title).toBeUndefined();

    const good = {
      title: '浮力大小：密度与排开体积的条件对照',
      nodes: [{ id: 'a', label: '液体密度 ρ液' }, { id: 'b', label: '排开液体体积 V排' }],
      edges: [],
    };
    expect(guardTitleAgainstContent(good).title).toBe('浮力大小：密度与排开体积的条件对照');
  });
});

/* ────────────── 换例重绘守门（2026-11-13 修复批 4b，BOARD_MISMATCH major×3） ────────────── */

describe('board-intent：changeSignal 记录换例信号的来源档位', () => {
  const base = { kind: 'split-compare', taskType: 'model', boardNumbers: ['400', '60'] };

  it('显式换词 → variant-words；换液体 → scene；反事实 → hypothetical', () => {
    expect(decideBoardIntent({ ...base, studentText: '好', lastTeacherText: '把 800 米换成 400 米试试' }).changeSignal).toBe('variant-words');
    expect(decideBoardIntent({ ...base, studentText: '好', lastTeacherText: '把液体换成酒精再看一次' }).changeSignal).toBe('scene');
    expect(decideBoardIntent({ ...base, studentText: '好', lastTeacherText: '假设把顺序倒过来，先发货后付钱' }).changeSignal).toBe('hypothetical');
  });

  it('只提到板上没有的数字（同例深挖的常见形态）→ variant-numbers；无信号 → none', () => {
    expect(decideBoardIntent({ ...base, studentText: '好', lastTeacherText: '那我们再看 300 万这处怎么记' }).changeSignal).toBe('variant-numbers');
    expect(decideBoardIntent({ ...base, studentText: '好', lastTeacherText: '先看左栏最后那行' }).changeSignal).toBe('none');
  });
});

describe('shouldSkipExampleRefresh（换例重绘守门，修复批 4b）', () => {
  // u04 实证板面：右栏「付出货款 0 元/成本是存货」被换数触发重绘成「付现 60 万」——与教师开场打架
  const financeBoard = {
    left: { head: '利润表（权责发生制）', rows: [{ label: '营业成本 60 万', sub: '1 月发货' }] },
    right: { head: '现金流水（收付实现制）', rows: [{ label: '付出货款 0 元', sub: '成本是存货，非本期付现' }] },
  };

  it('换数触发 + 老师本句仍在引用旧板两处内容 → 抑制重绘（同例深挖，不是换例）', () => {
    const result = shouldSkipExampleRefresh({
      intent: { changeSignal: 'variant-numbers' },
      boardSpec: financeBoard,
      teacherReply: '注意成本是存货，非本期付现，所以这里付出货款 0 元，现金还没动。',
    });
    expect(result.skip).toBe(true);
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
  });

  it('换数触发 + 老师在讲全新例子（旧板内容几乎不出现）→ 放行重绘', () => {
    const result = shouldSkipExampleRefresh({
      intent: { changeSignal: 'variant-numbers' },
      boardSpec: financeBoard,
      teacherReply: '我们换到第二笔生意：3 月下单、4 月交付，看看这两张表又各记多少。',
    });
    expect(result.skip).toBe(false);
  });

  it('旧板内容只命中 1 处 → 放行（单一词面重叠不构成「仍在讲旧例」）', () => {
    const result = shouldSkipExampleRefresh({
      intent: { changeSignal: 'variant-numbers' },
      boardSpec: financeBoard,
      teacherReply: '成本是存货这一点记住就行，我们看下个月的新单子。',
    });
    expect(result.skip).toBe(false);
  });

  it('显式换词（variant-words/scene）一律放行：老师明说要换，重绘是他要的动作', () => {
    for (const changeSignal of ['variant-words', 'scene', 'hypothetical', 'none'] as const) {
      const result = shouldSkipExampleRefresh({
        intent: { changeSignal },
        boardSpec: financeBoard,
        teacherReply: '成本是存货，非本期付现；付出货款 0 元。现在把它换成酒精。',
      });
      expect(result.skip).toBe(false);
    }
  });

  it('老师本句为空 → 不判（放行，不因脏数据误抑制）', () => {
    expect(shouldSkipExampleRefresh({
      intent: { changeSignal: 'variant-numbers' },
      boardSpec: financeBoard,
      teacherReply: '',
    }).skip).toBe(false);
  });
});

/* ────────────── 纠正语境（修复批 7，板书固化学员已纠错误 critical×2） ────────────── */

describe('mergeCorrectionNotes / buildCorrectionDirective（纠正语境，修复批 7）', () => {
  const MIS = { conceptKey: '核对试用期限档位', hypothesis: '学生误以为一年整的合同试用期上限按一个月算' };

  it('误解假设并入名单（cap 5、按假设去重）', () => {
    const prior = Array.from({ length: 5 }, (_, i) => ({ conceptKey: `k${i}`, hypothesis: `旧${i}`, turn: i }));
    const merged = mergeCorrectionNotes(prior, [MIS], 10);
    expect(merged).toHaveLength(5);
    // 最旧的被挤出，新的在尾部
    expect(merged.some((note) => note.hypothesis === MIS.hypothesis)).toBe(true);
    expect(merged.some((note) => note.hypothesis === '旧0')).toBe(false);
  });

  it('同假设重复上报不重复入名单；空误解返回原名单', () => {
    const first = mergeCorrectionNotes([], [MIS], 4);
    const second = mergeCorrectionNotes(first, [{ ...MIS, conceptKey: '改名' }], 6);
    expect(second).toHaveLength(1);
    expect(mergeCorrectionNotes(first, [], 8)).toBe(first);
  });

  it('清除禁令含假设原文与「不得保留错误版本」', () => {
    const directive = buildCorrectionDirective([MIS].map((m) => ({ ...m, turn: 4 })));
    expect(directive).toContain('一个月');
    expect(directive).toContain('不得保留');
  });

  it('无纠正记录 → 空禁令（不加重无谓 token）', () => {
    expect(buildCorrectionDirective([])).toBe('');
    expect(buildCorrectionDirective(undefined)).toBe('');
  });
});

/* ────────────── 修复批 10（交流体验专项）：复发升级 + 板面答案暴露 ────────────── */

describe('mergeCorrectionNotes 复发升级 / buildCorrectionDirective（修复批 10-D4）', () => {
  const MIS = { conceptKey: 'b与d的判别', hypothesis: '学生把「有人主动清除」和「没人管过期」混为一谈' };

  it('同一错形再次命中 → hits +1（留痕，不再只是静默去重）', () => {
    const first = mergeCorrectionNotes([], [MIS], 4);
    expect(first[0].hits).toBe(1);
    const second = mergeCorrectionNotes(first, [{ ...MIS }], 13);
    expect(second).toHaveLength(1);
    expect(second[0].hits).toBe(2);
    expect(second[0].turn).toBe(4);
  });

  it('不同错形首次出现 → hits=1；空误解仍返回原数组（身份不变）', () => {
    const first = mergeCorrectionNotes([], [MIS], 4);
    const second = mergeCorrectionNotes(first, [{ conceptKey: 'x', hypothesis: '另一个新错形' }], 6);
    expect(second).toHaveLength(2);
    expect(second.every((note) => note.hits === 1)).toBe(true);
    expect(mergeCorrectionNotes(first, [], 8)).toBe(first);
  });

  it('hits ≥2 → 指令含升级条款（不得直接给答案，先问思路让学员产出判别）', () => {
    const recurred = mergeCorrectionNotes(mergeCorrectionNotes([], [MIS], 4), [{ ...MIS }], 13);
    const directive = buildCorrectionDirective(recurred);
    expect(directive).toContain('不得直接给出答案');
    expect(directive).toContain('怎么想的');
  });

  it('首犯（hits=1）→ 无升级条款（普通清除禁令即可）', () => {
    const directive = buildCorrectionDirective([{ ...MIS, turn: 4, hits: 1 }]);
    expect(directive).not.toContain('不得直接给出答案');
  });
});

describe('collectTurnBoardFaceText（修复批 10-D1：布题轮板面答案暴露扫描源）', () => {
  it('抽取 figures 的 spec 文本；无 spec 时回退 maskedSpec/fullSpec', () => {
    const text = collectTurnBoardFaceText([
      { kind: 'board', spec: { title: '四支现金流', rows: [{ label: '净占用现金', sub: '830 万元' }] } },
      { kind: 'board', maskedSpec: { rows: [{ label: '合同负债', sub: '占住' }] } },
    ]);
    expect(text).toContain('净占用现金');
    expect(text).toContain('830');
    expect(text).toContain('合同负债');
  });

  it('非数组/空数组/无文本 figure → 空串（不参与扫描）', () => {
    expect(collectTurnBoardFaceText(null)).toBe('');
    expect(collectTurnBoardFaceText(undefined)).toBe('');
    expect(collectTurnBoardFaceText([])).toBe('');
    expect(collectTurnBoardFaceText([{ kind: 'board' }])).toBe('');
  });
});

/* ────────────── 修复批 13-①：指认-板面交叉核对 ────────────── */

describe('findUnmatchedBoardReferences（指认落空判定）', () => {
  it('病历单形态命中：看板上「X」/标着「X」的那条线，板面无该文本', () => {
    expect(findUnmatchedBoardReferences({
      reply: '你先看板上「离职后补偿 → 条款效力」那条线，标着「先行给付」的那条线就是它。',
      boardText: '竞业限制范围 竞业限制条款效力 条件期限',
    }).misses.length).toBeGreaterThan(0);
    expect(findUnmatchedBoardReferences({
      reply: '标着「先行给付」的那条线就是关键。',
      boardText: '范围 效力 条件期限',
    }).misses).toContain('先行给付');
  });

  it('豁免：引号文本在板面上存在 → 不命中', () => {
    expect(findUnmatchedBoardReferences({
      reply: '看板上「净占用现金」那一行，就是三支合起来的结果。',
      boardText: '应收账款 存货 应付账款 净占用现金 830 万元',
    }).misses).toEqual([]);
  });

  it('豁免：引号文本是引用此前教师说过的话（引对话） → 不命中', () => {
    expect(findUnmatchedBoardReferences({
      reply: '就像刚才说的「钱还没付出去，所以放出来」这条口径，再看板上。',
      boardText: '应付账款 放出 330',
      priorTeacherText: '钱还没付出去，所以放出来——这就是应付账款的判断。',
    }).misses).toEqual([]);
  });

  it('短引号（<4 归一字）与无指认语境的引号 → 不判', () => {
    expect(findUnmatchedBoardReferences({
      reply: '这个「对」字用得好。我们把「期限」讲完。',
      boardText: '期限格 补偿格',
    }).misses).toEqual([]);
    expect(findUnmatchedBoardReferences({ reply: '', boardText: '' }).misses).toEqual([]);
  });
});

/* ────────────── 修复批 15-②：无板面时的板面指认检测 ────────────── */

describe('referencesBoardWithoutBoardAvailable（无板面指认判定）', () => {
  it('病历单形态命中：无板面课教师说「直接拿刚才那个词」「板上那份」', () => {
    expect(referencesBoardWithoutBoardAvailable(
      '你直接看板上那份合同原文，拿刚才那个词来对。',
    )?.snippet).toContain('板上');
    expect(referencesBoardWithoutBoardAvailable(
      '屏幕上这份对照表里，第8条就是红线。',
    )).not.toBeNull();
  });

  it('豁免：否定句（「不用写在板上」）不判', () => {
    expect(referencesBoardWithoutBoardAvailable(
      '这题不需要写在板上，你口头把判断说给我听就行。',
    )).toBeNull();
  });

  it('无板面指认词的回复 → 不判', () => {
    expect(referencesBoardWithoutBoardAvailable('你把第8条的原句读出来，我们逐字对。')).toBeNull();
    expect(referencesBoardWithoutBoardAvailable('')).toBeNull();
  });
});
