/**
 * 检查点失败分类回归（走查 P2）：
 * 「已经提交过了」必须与「真的提交失败」区分开，否则重复提交会被误报成失败。
 */
import { describe, expect, it } from 'vitest';
import { isCheckpointAlreadyHandled } from '../checkpoint';

describe('utils/checkpoint', () => {
  it('404 → 视为「已提交过」（后端：理解检查不存在或已处理）', () => {
    expect(
      isCheckpointAlreadyHandled({
        response: { status: 404, data: { error: { message: '理解检查不存在或已处理' } } },
      })
    ).toBe(true);
  });

  it('文案命中「已处理/不存在」时即使没有 status 也视为已提交过', () => {
    expect(isCheckpointAlreadyHandled({ message: '理解检查不存在或已处理' })).toBe(true);
    expect(isCheckpointAlreadyHandled({ response: { data: { error: { message: '检查点不存在' } } } })).toBe(true);
  });

  it('其它失败（网络断开 / 5xx / revision 冲突）不得被误判为「已提交过」', () => {
    expect(isCheckpointAlreadyHandled({ response: { status: 500 } })).toBe(false);
    expect(isCheckpointAlreadyHandled({ response: { status: 409, data: { error: { message: 'revision 冲突' } } } })).toBe(false);
    expect(isCheckpointAlreadyHandled(new Error('Network Error'))).toBe(false);
    expect(isCheckpointAlreadyHandled(null)).toBe(false);
    expect(isCheckpointAlreadyHandled(undefined)).toBe(false);
  });
});
