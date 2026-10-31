/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造 spec 载荷 */
/**
 * 本轮板书意图（2026-10-27）：先定这一轮问什么，再决定板上留什么。
 *
 * 验收点：
 *  1) 问法由图型/任务类型决定（对比→分叉、时间线→顺序、概念图→条件、复盘→迁移）；
 *  2) 换题信号要同时读**老师上一句**（老师主动换的数据）与**学生这一句**；
 *  3) 「要学生说的那句结论」按意图从板上撤掉，但材料与步骤一个不少。
 */
import { decideBoardIntent, applyBoardIntent, numbersOnBoard, describeIntentForTeacher, guardTitleAgainstContent } from '../board-intent';
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
