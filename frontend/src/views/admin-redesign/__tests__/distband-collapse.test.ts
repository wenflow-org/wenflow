/**
 * 教学组分布带全部退役（2026-10-17 用户连续走查四页 + 「记忆与复习也不要了」）。
 *
 * 历史：2026-10-14 曾拍板「教学组各页这条分布带一律默认折叠」，五页名单由本用例钉住。
 * 2026-10-17 起五页相继移除 MkDistBand——目标对话 / 学习路径 / 教学会话 / 学习状态 /
 * 记忆与复习；原因统一是：分档多数为 0 时比例条只等于上方 KPI 的一个数，且这些带都兼作
 * 唯一筛选入口，折叠后筛选被藏起来。
 *
 * 现在本用例从「哪几页折了」转为「哪几页不许再加回来」：教学组六页源码里不得出现 MkDistBand。
 * 名单外唯一保留者是虚拟学习者运行条的裸条（无卡头、无折叠，不属教学组）。
 */
import { describe, expect, it } from 'vitest';
import PeopleSource from '../People.vue?raw';
import GoalConversationsSource from '../GoalConversations.vue?raw';
import OpsContentSource from '../OpsContent.vue?raw';
import TeachingSessionsSource from '../TeachingSessions.vue?raw';
import LearnerCenterSource from '../LearnerCenter.vue?raw';
import MemoryReviewOverviewSource from '../MemoryReviewOverview.vue?raw';
import VirtualLearnerRunningBarSource from '../VirtualLearnerRunningBar.vue?raw';

const TEACHING_PAGES: Array<[string, string]> = [
  ['用户与学习者 People', PeopleSource],
  ['目标对话 GoalConversations', GoalConversationsSource],
  ['学习路径 OpsContent', OpsContentSource],
  ['教学会话 TeachingSessions', TeachingSessionsSource],
  ['学习状态 LearnerCenter', LearnerCenterSource],
  ['记忆与复习 MemoryReviewOverview', MemoryReviewOverviewSource]
];

describe('教学组分布带已全部退役', () => {
  it.each(TEACHING_PAGES)('%s：不再使用 MkDistBand', (_name, src) => {
    expect(src).not.toContain('<MkDistBand');
  });

  it('替代出口仍在：状态筛选回到卡头 pills / chips（目标对话、学习路径），完结率升 KPI（教学会话）', () => {
    expect(GoalConversationsSource).toContain('gcStatusPills');
    expect(OpsContentSource).toContain('ocStatusPills');
    expect(TeachingSessionsSource).toContain('completionRate');
  });

  it('虚拟学习者运行条仍用裸条（无卡头可折，且不属教学组）', () => {
    expect(VirtualLearnerRunningBarSource).toContain('<MkDistBand');
    expect(VirtualLearnerRunningBarSource).not.toMatch(/^\s*collapsible$/m);
  });
});
