/**
 * 重建脚本的在跑工作守卫（2026-10-21）：
 * 清库会打断在途课堂，默认必须拒绝 —— 守卫逻辑单独断言，避免只在 CLI 里被间接覆盖。
 */
import { describeActiveWorkBlocker } from '../rebuild-vl-data-layer';

describe('describeActiveWorkBlocker（重建前在跑工作守卫）', () => {
  it('没有在跑课堂/会话 → 放行', () => {
    expect(describeActiveWorkBlocker({ activeClassrooms: 0, runningSessions: 0 })).toBeNull();
  });

  it('有未收束课堂 → 拒绝并给出强制开关', () => {
    const reason = describeActiveWorkBlocker({ activeClassrooms: 2, runningSessions: 0 });
    expect(reason).toContain('未收束课堂 2 节');
    expect(reason).toContain('--force');
  });

  it('有在跑仿真会话 → 拒绝，且两项同时出现都报', () => {
    const reason = describeActiveWorkBlocker({ activeClassrooms: 1, runningSessions: 3 });
    expect(reason).toContain('未收束课堂 1 节');
    expect(reason).toContain('在跑仿真会话 3 个');
  });

  it('非法/负数计数按 0 处理，不制造假拦截', () => {
    expect(describeActiveWorkBlocker({ activeClassrooms: -1, runningSessions: Number.NaN })).toBeNull();
  });
});
