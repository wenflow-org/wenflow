import { describe, expect, it } from '@jest/globals';
import { extractJsonObject } from '../json-extractor';

describe('extractJsonObject 内嵌直引号修复', () => {
  it('修复字符串值内未转义的直引号（真课故障形态）', () => {
    const raw = '{"reply":"你把两盆的"不浇"拆成了两个机制：一盆是留得住，一盆是根本不往下走。","analysis":{"understanding":0.85}}';
    const r = extractJsonObject(raw);
    expect(r.parsed).not.toBeNull();
    expect((r.parsed as any).reply).toContain('不浇');
    expect((r.parsed as any).reply).toBe('你把两盆的"不浇"拆成了两个机制：一盆是留得住，一盆是根本不往下走。');
    expect((r.parsed as any).analysis.understanding).toBe(0.85);
  });

  it('合法 JSON 不受影响', () => {
    const raw = '{"reply":"正常回复","a":[1,2],"b":{"c":"d"}}';
    const r = extractJsonObject(raw);
    expect((r.parsed as any).reply).toBe('正常回复');
  });

  it('嵌套对象+数组里的内嵌引号一起修', () => {
    const raw = '{"reply":"他说"该浇"然后走了","opts":[{"t":"选"A"项"}]}';
    const r = extractJsonObject(raw);
    expect(r.parsed).not.toBeNull();
    expect(JSON.stringify(r.parsed)).toContain('该浇');
  });

  it('前后有散文也能抽到', () => {
    const raw = '好的，我来继续：\n{"reply":"他看到"轻飘"就浇"}';
    const r = extractJsonObject(raw);
    expect(r.parsed).not.toBeNull();
    expect((r.parsed as any).reply).toContain('轻飘');
  });
});
