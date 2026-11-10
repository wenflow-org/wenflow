/**
 * 「这块该不该画板」的两个确定性判据（2026-11-02 实测驱动）。
 *
 * 背景：一节「在 6 个真实句子上标出时间标志词」的课，白板被画成 6 格
 * 「1 报告已完成 / 2 工作未决定 / 3 住上海…」，英文原句在副标注里被截成
 * 「I have already finish…」。学生既读不到句子、又白拿了结论——板子对这节课是负价值。
 */
import {
  declinesParaphrasedMaterialBoard,
  resolveBoardDesignerOutput,
} from '../board-designer.service';
import type { TeachingFigure } from '../../../skills/teaching-turn';

const SIX_SENTENCES_TASK =
  '下面 6 个句子取自考试题干，每句都藏着决定时态的信号：'
  + '1. I have already finished the report, so we can send it out now. '
  + "2. She hasn't decided yet whether to take the job. "
  + '3. He has lived in Shanghai since 2019. '
  + '4. They worked in that factory for three years before it closed. '
  + '5. We visited the museum last Friday. '
  + '6. Look! The kids are playing football in the yard. '
  + '逐句标出时间标志词，用一句话判断这个动作是持续、完成还是一次性。';

/** 实测那块板（截取自 teaching_session_messages 的 spec） */
const REAL_PARAPHRASE_BOARD = {
  kind: 'concept-map',
  spec: {
    nodes: [
      { id: 'judge', label: '时态判断', sub: '标志词 + 动作性质' },
      { id: 's1', label: '1 报告已完成', sub: 'I have already finish…' },
      { id: 's2', label: '2 工作未决定', sub: "She hasn't decided ye…" },
      { id: 's3', label: '3 住上海', sub: 'He has lived in Shang…' },
      { id: 's4', label: '4 工厂关闭前工作', sub: 'They worked in that f…' },
      { id: 's5', label: '5 上周参观博物馆', sub: 'We visited the museum…' },
      { id: 's6', label: '6 孩子们正在踢球', sub: 'Look! The kids are pl…' },
    ],
  },
} as unknown as TeachingFigure;

describe('resolveBoardDesignerOutput', () => {
  it('{"figure":null,"reason":…} → declined（不重试、交给正文）', () => {
    expect(resolveBoardDesignerOutput({ figure: null, reason: '材料是要读的句子' }))
      .toEqual({ outcome: 'declined', reason: '材料是要读的句子' });
  });

  it('{"figure":null} 无 reason → declined 带默认理由', () => {
    expect(resolveBoardDesignerOutput({ figure: null })).toEqual({
      outcome: 'declined',
      reason: 'board-designer declined',
    });
  });

  it('标准 {figure:{…}} → figure', () => {
    const figure = { kind: 'matrix', spec: {} };
    expect(resolveBoardDesignerOutput({ figure })).toEqual({ outcome: 'figure', figure });
  });

  it('模型直接给顶层 kind/spec（无 figure 包裹）→ 原样作 figure', () => {
    const bare = { kind: 'matrix', spec: {} };
    expect(resolveBoardDesignerOutput(bare)).toEqual({ outcome: 'figure', figure: bare });
  });
});

describe('declinesParaphrasedMaterialBoard', () => {
  it('实测那块「6 格结论短语」的板 → 拒绝', () => {
    expect(declinesParaphrasedMaterialBoard(SIX_SENTENCES_TASK, REAL_PARAPHRASE_BOARD)).toBe(true);
  });

  it('板面真的带上材料原文（编号格里有原句）→ 放行', () => {
    const verbatim = {
      kind: 'concept-map',
      spec: {
        nodes: [
          { id: 's1', label: '1 I have already finished the report' },
          { id: 's2', label: '2 She has not decided yet whether to take the job' },
          { id: 's3', label: '3 He has lived in Shanghai since 2019' },
        ],
      },
    } as unknown as TeachingFigure;
    expect(declinesParaphrasedMaterialBoard(SIX_SENTENCES_TASK, verbatim)).toBe(false);
  });

  it('普通讲解板（任务描述里没有成组编号材料）→ 放行', () => {
    const lecture = '讲解浮力与排开液体的关系：密度决定浮沉。';
    const board = {
      kind: 'concept-map',
      spec: { nodes: [{ label: '1 密度' }, { label: '2 浮力' }, { label: '3 体积' }] },
    } as unknown as TeachingFigure;
    expect(declinesParaphrasedMaterialBoard(lecture, board)).toBe(false);
  });

  it('编号格不足 3 个 → 放行', () => {
    const board = {
      kind: 'concept-map',
      spec: { nodes: [{ label: '1 甲' }, { label: '2 乙' }] },
    } as unknown as TeachingFigure;
    expect(declinesParaphrasedMaterialBoard(SIX_SENTENCES_TASK, board)).toBe(false);
  });

  it('没有板（figure=null）→ 放行（交给出图侧其它判据）', () => {
    expect(declinesParaphrasedMaterialBoard(SIX_SENTENCES_TASK, null)).toBe(false);
  });
});
