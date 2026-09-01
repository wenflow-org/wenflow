/**
 * glossaryMeta.ts 术语常量表完整性测试（阶段 1 术语统一）：
 * 完成度五档 / 基准三分语义必须齐全且唯一——前端多处共用此表，
 * 缺档会导致 Skill 目录/编排页/抽屉渲染空洞。
 */
import { describe, expect, it } from 'vitest';
import {
  COMPLETION_META,
  SEMANTICS_META,
  completionMetaOf
} from '../glossaryMeta';

describe('完成度五档（COMPLETION_META）', () => {
  it('五档齐全（draft → handler-ready → core-ready → fields-synced → live）', () => {
    const statuses = COMPLETION_META.map((m) => m.status);
    expect(statuses).toEqual([
      'draft',
      'handler-ready',
      'core-ready',
      'fields-synced',
      'live'
    ]);
  });

  it('每档 status 唯一且 label/short/hint 非空', () => {
    const seen = new Set<string>();
    for (const meta of COMPLETION_META) {
      expect(seen.has(meta.status), `status 重复：${meta.status}`).toBe(false);
      seen.add(meta.status);
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.short.trim().length).toBeGreaterThan(0);
      expect(meta.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it('completionMetaOf 按 status 定位，未知返回 undefined', () => {
    expect(completionMetaOf('live')?.label).toBe('已上线');
    expect(completionMetaOf('nope')).toBeUndefined();
  });
});

describe('基准三分语义（SEMANTICS_META）', () => {
  it('四个语义位齐全', () => {
    const ids = SEMANTICS_META.map((m) => m.id);
    expect(ids).toEqual([
      'baseline-drift',
      'consistency',
      'override-record',
      'runtime-info'
    ]);
  });

  it('每项 id 唯一且 label/hint 非空', () => {
    const seen = new Set<string>();
    for (const meta of SEMANTICS_META) {
      expect(seen.has(meta.id)).toBe(false);
      seen.add(meta.id);
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.hint.trim().length).toBeGreaterThan(0);
    }
  });
});
