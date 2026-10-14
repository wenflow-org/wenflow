/**
 * 教学组五页分布带默认折叠（2026-10-14 用户拍板：「教学组的这些，默认折叠，也就是分布的条
 * 状态默认折叠起来」——当天先在「学习状态」落地，随即按用户指示扩到同组其余四页）。
 *
 * 折叠是 MkDistBand 的**可选档**（collapsible 默认关，原语级行为见
 * components/mk/__tests__/MkDistBand.collapsible.test.ts），所以「哪几页折了」只能由各页
 * 显式传参决定——本用例钉的就是这份页面名单，防以后改版漏掉一页或悄悄折错页。
 *
 * 名单外两处不是遗漏：
 *  - 用户与学习者（People）本就没有分布带；
 *  - 虚拟学习者运行条用的是裸条（无标题卡头可折，且不属教学组）。
 *
 * 为什么用源码断言而不是逐页挂载：这五页的数据前置各不相同（stats / 窗口 / embedded 宿主），
 * 逐页挂载得各造一套 mock 才能摸到这条带；而本拍板的对象就是「页面有没有传这个 prop」本身。
 */
import { describe, expect, it } from 'vitest';
import LearnerCenterSource from '../LearnerCenter.vue?raw';
import GoalConversationsSource from '../GoalConversations.vue?raw';
import OpsContentSource from '../OpsContent.vue?raw';
import TeachingSessionsSource from '../TeachingSessions.vue?raw';
import MemoryReviewOverviewSource from '../MemoryReviewOverview.vue?raw';
import VirtualLearnerRunningBarSource from '../VirtualLearnerRunningBar.vue?raw';

const PAGES: Array<[string, string]> = [
  ['学习状态 LearnerCenter', LearnerCenterSource],
  ['目标对话 GoalConversations', GoalConversationsSource],
  ['学习路径 OpsContent', OpsContentSource],
  ['教学会话 TeachingSessions', TeachingSessionsSource],
  ['记忆与复习 MemoryReviewOverview', MemoryReviewOverviewSource]
];

/** 分布带开标签之后、其内某行恰好是 collapsible（属性行，不是注释里的描述句） */
const BAND_FOLDED = /<MkDistBand\b[\s\S]{0,400}?^\s*collapsible$/m;

describe('教学组分布带默认折叠', () => {
  it.each(PAGES)('%s：分布带显式开 collapsible', (_name, src) => {
    expect(src).toMatch(BAND_FOLDED);
  });

  it('虚拟学习者运行条用裸条（无卡头可折）→ 不在折叠名单内', () => {
    expect(VirtualLearnerRunningBarSource).toContain('<MkDistBand');
    expect(VirtualLearnerRunningBarSource).not.toMatch(/^\s*collapsible$/m);
  });
});
