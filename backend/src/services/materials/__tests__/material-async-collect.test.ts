/**
 * 联网采集回填单测（活的 path 批次 B）：
 * extractAsyncCollectMarker（marker 提取/非占位返回 null）。
 * DB 轮询/扫描路径不在此测（依赖 prisma），由实机 E2E 覆盖。
 */
import { extractAsyncCollectMarker } from '../material-async-collect.service';

describe('extractAsyncCollectMarker', () => {
  it('从占位 notes 提取归一标题', () => {
    const notes = [
      '联网资料后台采集中，就绪后自动补充到本路径',
      '__async_collect__:3-6岁儿童学习与发展指南',
    ];
    expect(extractAsyncCollectMarker(notes)).toBe('3-6岁儿童学习与发展指南');
  });

  it('无 marker（真实 pack/普通 notes）→ null', () => {
    expect(extractAsyncCollectMarker(['复用库中联网资料，跳过本次采集'])).toBeNull();
    expect(extractAsyncCollectMarker([])).toBeNull();
    expect(extractAsyncCollectMarker(undefined)).toBeNull();
    expect(extractAsyncCollectMarker(['不是 marker', 123])).toBeNull();
  });

  it('marker 必须带冒号与标题，光有前缀不算', () => {
    expect(extractAsyncCollectMarker(['__async_collect__:'])).toBe('');
  });
});
