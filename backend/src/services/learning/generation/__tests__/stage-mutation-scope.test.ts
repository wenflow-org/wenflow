/**
 * #241：`rebuild-all` 的 allowCompleted 必须贯穿到 stageDesign 的路径变更闸门。
 *
 * 真实事故：core 阶段按 allowCompleted 删除并重建了里程碑，但同事务创建 stageDesign run 后
 * 调用的 enrich 仍以 replace-tasks 默认口径复核（不允许已完成课堂/证据），于是 run 被取消、
 * 路径留下 active + 0 任务。这里锁定 scope 选路：整建放行→allowCompleted；append 只限空阶段；
 * 默认（普通 stageDesign）不得放宽（防修过头）。
 */
import { buildStageMutationScope } from '../stage-enrichment';

describe('buildStageMutationScope（#241）', () => {
  it('整条重建（allowCompleted）→ replace-tasks 沿用 core 的放行口径', () => {
    expect(buildStageMutationScope(false, [], true)).toEqual({ allowCompleted: true });
  });

  it('appendOnly 只限定到空白阶段，不带 allowCompleted', () => {
    expect(buildStageMutationScope(true, ['m-1', 'm-2'], true)).toEqual({ milestoneIds: ['m-1', 'm-2'] });
  });

  it('防修过头：普通 stageDesign（未显式放行）仍按默认保护，不传 allowCompleted', () => {
    expect(buildStageMutationScope(false, [], false)).toEqual({});
    expect(buildStageMutationScope(false, [])).toEqual({});
  });
});
