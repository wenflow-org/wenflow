import { mergePathIdIntoMetadata, parseArgs } from '../backfill-metric-path-identity';

describe('backfill-metric-path-identity', () => {
  describe('parseArgs', () => {
    it('默认 dry-run（不带 --apply 绝不写库）', () => {
      expect(parseArgs([])).toEqual({ apply: false, limit: 20 });
    });

    it('--apply 才写库，--limit 生效且有上界', () => {
      expect(parseArgs(['--apply', '--limit=99'])).toEqual({ apply: true, limit: 99 });
      expect(parseArgs(['--apply', '--limit=100000']).limit).toBe(500);
      expect(parseArgs(['--apply', '--limit=0']).limit).toBe(20);
    });

    it('未知参数直接报错（防止静默按 dry-run 跑）', () => {
      expect(() => parseArgs(['--aplly'])).toThrow(/未知参数/);
    });
  });

  describe('mergePathIdIntoMetadata', () => {
    it('按写入侧规范键序插入 pathId（与 buildMetricCreateData 形状一致）', () => {
      const before = JSON.stringify({
        version: 'state-v2',
        committed: true,
        source: 'task-completion',
        scale: 'internal-10',
        taskId: 'st_1',
      });
      expect(mergePathIdIntoMetadata(before, 'lp_A')).toBe(JSON.stringify({
        version: 'state-v2',
        committed: true,
        source: 'task-completion',
        scale: 'internal-10',
        pathId: 'lp_A',
        taskId: 'st_1',
      }));
    });

    it('保留未知键（不丢信息），未知键排在规范键之后', () => {
      const before = JSON.stringify({ source: 'task-completion', futureKey: 'keep-me' });
      const after = JSON.parse(mergePathIdIntoMetadata(before, 'lp_A')!);
      expect(after.futureKey).toBe('keep-me');
      expect(after.pathId).toBe('lp_A');
      expect(Object.keys(after)).toEqual(['source', 'pathId', 'futureKey']);
    });

    it('已有相同 pathId → 幂等', () => {
      const before = JSON.stringify({ source: 'task-completion', pathId: 'lp_A' });
      expect(JSON.parse(mergePathIdIntoMetadata(before, 'lp_A')!)).toEqual({
        source: 'task-completion',
        pathId: 'lp_A',
      });
    });

    it('已有不同 pathId → 拒绝覆盖（返回 null，由调用方跳过该行）', () => {
      const before = JSON.stringify({ source: 'task-completion', pathId: 'lp_B' });
      expect(mergePathIdIntoMetadata(before, 'lp_A')).toBeNull();
    });

    it('metadata 为空 → 用规范键序造一份', () => {
      expect(mergePathIdIntoMetadata(null, 'lp_A')).toBe(JSON.stringify({ pathId: 'lp_A' }));
    });

    it('metadata 非法 JSON → 返回 null（不破坏原值）', () => {
      expect(mergePathIdIntoMetadata('{not json', 'lp_A')).toBeNull();
    });
  });
});
