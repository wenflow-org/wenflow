/**
 * statusText.ts 本地化字典测试：
 * 已知枚举必须命中中文映射；未知值原样回退；空值不崩溃
 */
import { describe, expect, it } from 'vitest';
import { statusText, stageText, categoryText, actionText, targetTypeText } from '../statusText';

describe('statusText', () => {
  it('核心状态映射', () => {
    expect(statusText('completed')).toBe('已完成');
    expect(statusText('success')).toBe('成功');
    expect(statusText('error')).toBe('错误');
    expect(statusText('timeout')).toBe('超时');
    expect(statusText('failed')).toBe('失败');
    expect(statusText('active')).toBe('进行中');
    expect(statusText('draft')).toBe('草稿');
    expect(statusText('published')).toBe('已发布');
  });

  it('大小写不敏感（后端枚举混杂 snake_case）', () => {
    expect(statusText('Completed')).toBe('已完成');
    expect(statusText('IN_PROGRESS')).toBe('进行中');
  });

  it('未知值原样返回（不丢信息）', () => {
    expect(statusText('unknown-state')).toBe('unknown-state');
  });

  it('空值返回空串', () => {
    expect(statusText(null)).toBe('');
    expect(statusText(undefined)).toBe('');
  });
});

describe('stageText（Goal 会话阶段）', () => {
  it('五阶段映射', () => {
    expect(stageText('understanding')).toBe('澄清中');
    expect(stageText('proposal')).toBe('方案收敛中');
    expect(stageText('planning')).toBe('规划中');
    expect(stageText('completed')).toBe('已完成');
    expect(stageText('failed')).toBe('失败');
  });

  it('未知值回退原文', () => {
    expect(stageText('archived')).toBe('archived');
  });
});

describe('categoryText（Skill 类别）', () => {
  it('核心类别映射', () => {
    expect(categoryText('analysis')).toBe('分析');
    expect(categoryText('generation')).toBe('生成');
    expect(categoryText('teaching')).toBe('教学');
    expect(categoryText('simulation')).toBe('模拟');
  });
});

describe('actionText（审计动作）', () => {
  it('审计动作映射', () => {
    expect(actionText('user-create')).toBe('创建用户');
    expect(actionText('admin-login')).toBe('管理员登录');
    expect(actionText('session-revoke')).toBe('强制下线会话');
  });

  it('未知动作回退原文', () => {
    expect(actionText('mystery-action')).toBe('mystery-action');
  });
});

describe('targetTypeText（审计目标类型）', () => {
  it('已知类型映射', () => {
    expect(targetTypeText('user')).toBe('用户');
    expect(targetTypeText('session')).toBe('会话');
  });

  it('空值 → —', () => {
    expect(targetTypeText('')).toBe('—');
    expect(targetTypeText(null)).toBe('—');
  });

  it('未知类型回退原文', () => {
    expect(targetTypeText('skill')).toBe('skill');
  });
});
