import { buildCheckpointAction, type VisibleCheckpoint } from '../blackbox-checkpoint'

const CHECKPOINT: VisibleCheckpoint = {
  id: 'cp1',
  type: 'single_choice',
  question: '哪个是条件类型？',
  options: [
    { id: 'A', text: 'T extends U' },
    { id: 'B', text: 'Array<T>' },
  ],
  allowSkip: true,
}

describe('buildCheckpointAction（黑盒检查点作答动作）', () => {
  it('单选：取合法选项且只取一个', () => {
    const action = buildCheckpointAction(CHECKPOINT, { selectedOptionIds: ['B', 'A'] });
    expect(action).toEqual({
      type: 'submit_answer',
      answer: 'B. Array<T>',
      checkpointId: 'cp1',
      selectedOptionIds: ['B'],
    });
  });

  it('多选：保留全部合法选项，丢弃不存在的 id', () => {
    const multi: VisibleCheckpoint = { ...CHECKPOINT, type: 'multi_choice' };
    const action = buildCheckpointAction(multi, { selectedOptionIds: ['A', 'Z', 'B'] });
    expect(action).toMatchObject({ type: 'submit_answer', checkpointId: 'cp1', selectedOptionIds: ['A', 'B'] });
  });

  it('简答：草案文本作为作答', () => {
    const short: VisibleCheckpoint = { id: 'cp2', type: 'short_answer', question: '说说为什么' };
    const action = buildCheckpointAction(short, { answerText: '  因为类型会被擦除  ' });
    expect(action).toEqual({ type: 'submit_answer', answer: '因为类型会被擦除', checkpointId: 'cp2' });
  });

  it('无草案且允许跳过 → 走检查点提交接口的 skip（不是任务级 skip）', () => {
    const action = buildCheckpointAction(CHECKPOINT, null);
    expect(action).toEqual({ type: 'submit_answer', answer: '（跳过这个检查点）', checkpointId: 'cp1', skip: true });
  });

  it('无草案且不允许跳过 → 退化为第一个选项（不卡死链路）', () => {
    const noSkip: VisibleCheckpoint = { ...CHECKPOINT, allowSkip: false };
    const action = buildCheckpointAction(noSkip, undefined);
    expect(action).toEqual({
      type: 'submit_answer',
      answer: 'A. T extends U',
      checkpointId: 'cp1',
      selectedOptionIds: ['A'],
    });
  });

  it('草案里的非法选项 id 不参与判定（不误当作作答）', () => {
    const action = buildCheckpointAction(CHECKPOINT, { selectedOptionIds: ['ZZZ'] });
    // 非法 id 被丢弃 → 落到"允许跳过"分支
    expect(action).toMatchObject({ type: 'submit_answer', checkpointId: 'cp1', skip: true });
  });
});
