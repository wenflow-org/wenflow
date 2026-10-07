import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropLegacyRecentGoalsStorage,
  getRecentGoalsStorage,
  LEGACY_RECENT_GOALS_KEY,
  recentGoalsKey,
  clearGoalConversationStorage,
  removeRecentGoalsStorage,
  setRecentGoalsStorage,
} from '../sessionCleanup';
import {
  forgetRecentGoalForUser,
  loadRecentGoalsForUser,
  rememberRecentGoalForUser,
  withoutResumedEntry,
} from '../recentGoals';

const entryA = { id: 'gc_a', preview: 'A goal', at: 100 };
const entryB = { id: 'gc_b', preview: 'B goal', at: 200 };

beforeEach(() => localStorage.clear());

describe('最近会话缓存按账号隔离', () => {
  it('两个账号读写互不串用', () => {
    expect(recentGoalsKey('user-a')).toBe('wf_goal_recent:user-a');
    expect(rememberRecentGoalForUser('user-a', entryA)).toEqual([entryA]);
    expect(rememberRecentGoalForUser('user-b', entryB)).toEqual([entryB]);

    expect(JSON.parse(getRecentGoalsStorage('user-a') || '[]')).toEqual([entryA]);
    expect(JSON.parse(getRecentGoalsStorage('user-b') || '[]')).toEqual([entryB]);
    expect(loadRecentGoalsForUser('user-a')).toEqual([entryA]);
    expect(loadRecentGoalsForUser('user-b')).toEqual([entryB]);
  });

  it('身份缺失时不读、不写任何账号列表', () => {
    setRecentGoalsStorage('user-a', JSON.stringify([entryA]));
    expect(loadRecentGoalsForUser(null)).toEqual([]);
    expect(rememberRecentGoalForUser(null, entryB)).toEqual([]);
    expect(localStorage.length).toBe(1);
  });

  it('共享旧键不导入，并能单独丢弃', () => {
    localStorage.setItem(LEGACY_RECENT_GOALS_KEY, JSON.stringify([entryA]));
    expect(loadRecentGoalsForUser('user-a')).toEqual([]);
    dropLegacyRecentGoalsStorage();
    expect(localStorage.getItem(LEGACY_RECENT_GOALS_KEY)).toBeNull();
  });

  it('写入时去重并最多保留最近五条', () => {
    for (let i = 0; i < 6; i += 1) {
      rememberRecentGoalForUser('user-a', { id: `gc_${i}`, preview: `goal ${i}`, at: i });
    }
    const recent = loadRecentGoalsForUser('user-a');
    expect(recent).toHaveLength(5);
    expect(recent.map(({ id }) => id)).toEqual(['gc_5', 'gc_4', 'gc_3', 'gc_2', 'gc_1']);
    expect(rememberRecentGoalForUser('user-a', { ...entryA, at: 300 })).toEqual([
      { ...entryA, at: 300 }, ...recent.filter((item) => item.id !== entryA.id),
    ].slice(0, 5));
  });

  it('只移除指定账号的失效会话，不影响其他账号的同 ID 记录', () => {
    setRecentGoalsStorage('user-a', JSON.stringify([entryA, entryB]));
    setRecentGoalsStorage('user-b', JSON.stringify([entryA]));
    expect(forgetRecentGoalForUser('user-a', entryA.id)).toEqual([entryB]);
    expect(loadRecentGoalsForUser('user-a')).toEqual([entryB]);
    expect(loadRecentGoalsForUser('user-b')).toEqual([entryA]);
    removeRecentGoalsStorage('user-a');
    expect(getRecentGoalsStorage('user-a')).toBeNull();
    expect(getRecentGoalsStorage('user-b')).not.toBeNull();
  });

  it('登出清理会删除旧共享键和所有用户的最近会话键', () => {
    localStorage.setItem('wf_goal_recent', '[]');
    setRecentGoalsStorage('user-a', JSON.stringify([entryA]));
    setRecentGoalsStorage('user-b', JSON.stringify([entryB]));
    localStorage.setItem('v2_goal_cid:user-a', 'gc_a');

    clearGoalConversationStorage();

    expect(localStorage.getItem('wf_goal_recent')).toBeNull();
    expect(getRecentGoalsStorage('user-a')).toBeNull();
    expect(getRecentGoalsStorage('user-b')).toBeNull();
    expect(localStorage.getItem('v2_goal_cid:user-a')).toBeNull();
  });
});

describe('最近列表不与「继续上次的规划」重复指向同一会话', () => {
  it('恢复卡指向的那条从列表里剔除，其余保留', () => {
    expect(withoutResumedEntry([entryA, entryB], entryA.id)).toEqual([entryB]);
  });

  it('没有恢复目标时原样返回（本地无会话，列表照常显示）', () => {
    expect(withoutResumedEntry([entryA, entryB], null)).toEqual([entryA, entryB]);
  });

  it('列表里只有恢复卡那一条时返回空（调用方据此整块隐藏，不留孤立标题）', () => {
    expect(withoutResumedEntry([entryA], entryA.id)).toEqual([]);
  });

  it('恢复目标不在列表里时不做任何改动', () => {
    expect(withoutResumedEntry([entryA], 'gc_other')).toEqual([entryA]);
  });
});
