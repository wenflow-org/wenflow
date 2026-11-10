/**
 * toast 去重（2026-11-02 走查）：反复点同一个按钮不该在右上角堆起多张同文案卡片
 * （原实现只去重 1.2s 窗口内的重复，连点超过窗口就一张张叠上去）。
 */
import { describe, expect, it } from 'vitest';
import { toast } from '../toast';

function reset() {
  [...toast.toasts].forEach((item) => toast.close(item.id));
}

describe('toast 同文案去重', () => {
  it('同类型同文案连续弹两次 → 屏上只有一张', () => {
    reset();
    toast.error('复制失败：浏览器未授予剪贴板权限，请手动选中文字复制');
    toast.error('复制失败：浏览器未授予剪贴板权限，请手动选中文字复制');
    expect(toast.toasts).toHaveLength(1);
  });

  it('文案不同 → 各自保留', () => {
    reset();
    toast.error('复制失败');
    toast.error('保存失败');
    expect(toast.toasts).toHaveLength(2);
  });

  it('类型不同、文案相同 → 各自保留（error/success 语义不同）', () => {
    reset();
    toast.error('已完成');
    toast.success('已完成');
    expect(toast.toasts).toHaveLength(2);
  });
});
