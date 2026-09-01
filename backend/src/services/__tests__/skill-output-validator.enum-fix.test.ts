import { validateOutputAgainstFields } from '../skill-output-validator';

describe('extractEnumCandidates 修复验证（example-first|predict|self-assess 说明文字）', () => {
  const fields = [{ name: 'mode', type: 'enum', desc: 'example-first|predict|self-assess，必须保持与输入给出的开场模式一致' }];

  it('self-assess 不再被吞（此前报 enum-out-of-range）', () => {
    const r = validateOutputAgainstFields({ mode: 'self-assess' }, fields);
    expect(r.valid).toBe(true);
  });

  it('predict / example-first 仍合法', () => {
    expect(validateOutputAgainstFields({ mode: 'predict' }, fields).valid).toBe(true);
    expect(validateOutputAgainstFields({ mode: 'example-first' }, fields).valid).toBe(true);
  });

  it('真越界值仍报错', () => {
    const r = validateOutputAgainstFields({ mode: 'bogus' }, fields);
    expect(r.valid).toBe(false);
    expect(r.issues[0].code).toBe('enum-out-of-range');
  });
});
