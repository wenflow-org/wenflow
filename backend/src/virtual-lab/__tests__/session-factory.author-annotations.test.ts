/**
 * 审计标注不进模拟学习者上下文（`session-factory.stripAuthorAnnotations`）。
 *
 * 背景：故事池的 `goalSeed` 新增了作者/评审侧标注（`primaryBlockType` / `blockTypeEvidence` /
 * `recurrence`）。它们**必须留在存储里**（供审计与后续分流），但**不得进入扮演者的上下文**——
 * 否则模型知道自己被标成 permission_process / emotion_relationship，可能改变表演，
 * 造成"观测影响被测对象"。
 */
import { stripAuthorAnnotations } from '../session-factory';

describe('stripAuthorAnnotations（作者侧标注对模拟者不可见）', () => {
  it('剥掉三个审计标注字段，保留其它 goalSeed 字段', () => {
    const goalSeed = {
      domain: '数字办公',
      surfaceGoal: '解锁 OA 账号并上传报名表',
      realProblem: '账号被管理员锁了，不知道该找谁开',
      primaryBlockType: 'permission_process',
      blockTypeEvidence: '系统提示账号已被锁定，需管理员解锁',
      recurrence: 'once',
      motivation: '不想被扣绩效',
    };

    const out = stripAuthorAnnotations(goalSeed);

    expect(out).toEqual({
      domain: '数字办公',
      surfaceGoal: '解锁 OA 账号并上传报名表',
      realProblem: '账号被管理员锁了，不知道该找谁开',
      motivation: '不想被扣绩效',
    });
    expect('primaryBlockType' in out).toBe(false);
    expect('blockTypeEvidence' in out).toBe(false);
    expect('recurrence' in out).toBe(false);
  });

  it('是纯函数：不改原对象（存储侧标注不受影响）', () => {
    const goalSeed = { surfaceGoal: 'x', primaryBlockType: 'capability' };
    const out = stripAuthorAnnotations(goalSeed);
    expect(goalSeed.primaryBlockType).toBe('capability');
    expect(out).not.toBe(goalSeed);
  });

  it('没有标注字段时逐字段原样返回', () => {
    const goalSeed = { surfaceGoal: 'x', realProblem: 'y' };
    expect(stripAuthorAnnotations(goalSeed)).toEqual({ surfaceGoal: 'x', realProblem: 'y' });
  });

  it('null / undefined / 非对象输入安全', () => {
    expect(stripAuthorAnnotations(null)).toBeNull();
    expect(stripAuthorAnnotations(undefined)).toBeNull();
    expect(stripAuthorAnnotations('oops' as unknown)).toBeNull();
    expect(stripAuthorAnnotations(42 as unknown)).toBeNull();
  });
});
