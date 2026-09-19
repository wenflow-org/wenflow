/**
 * `sanitizeUnderstanding` 对「阻塞类型诊断」字段的透传/清理口径。
 *
 * 背景：goal-conversation 提示词新增 understanding.primary_block_type / recurrence /
 * block_type_evidence（供 services/learning/response-triage.ts 做分诊）。
 * `sanitizeUnderstanding` 用 `...understanding` 透传未知键，只对显式列出的顶层键清占位，
 * 这里锁定新字段「保留有效值、清理占位值」的行为，防止以后收敛字段时被误删。
 */
import { sanitizeUnderstanding } from '../index';

describe('sanitizeUnderstanding · 阻塞类型诊断字段', () => {
  it('保留 primary_block_type / recurrence / block_type_evidence / support_need', () => {
    const out = sanitizeUnderstanding({
      real_problem: '一上坡就熄火，不敢开了',
      primary_block_type: 'capability',
      recurrence: 'recurring',
      block_type_evidence: '一想到上坡就手心出汗',
      support_need: 'emotional',
    });

    expect(out.primary_block_type).toBe('capability');
    expect(out.recurrence).toBe('recurring');
    expect(out.block_type_evidence).toBe('一想到上坡就手心出汗');
    expect(out.support_need).toBe('emotional');
    expect(out.real_problem).toBe('一上坡就熄火，不敢开了');
  });

  it('占位/空串一律清理（与既有顶层字段同口径）', () => {
    const out = sanitizeUnderstanding({
      real_problem: '写不出结论',
      primary_block_type: '待确认',
      recurrence: '',
      block_type_evidence: '未明确',
      support_need: '待确认',
    });

    expect(out.primary_block_type).toBeUndefined();
    expect(out.recurrence).toBeUndefined();
    expect(out.block_type_evidence).toBeUndefined();
    expect(out.support_need).toBeUndefined();
    expect(out.real_problem).toBe('写不出结论');
  });

  it('null 视为占位被清理，非字符串对象透传（交由分诊模块判未知）', () => {
    const out = sanitizeUnderstanding({
      primary_block_type: null,
      recurrence: { unexpected: true },
    });

    expect('primary_block_type' in out).toBe(false);
    expect(out.recurrence).toEqual({ unexpected: true });
  });
});
