import { extractJsonObject } from '../json-extractor';

describe('extractJsonObject 容错链（2026-08-30 加入）', () => {
  it('纯 JSON 直接解析', () => {
    const result = extractJsonObject('{"a":1,"b":[1,2]}');
    expect(result.parsed).toEqual({ a: 1, b: [1, 2] });
  });

  it('```json 代码围栏包裹时剥离围栏解析', () => {
    const raw = '```json\n{"stallRisk":0.4,"predictedTone":"smooth"}\n```';
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual({ stallRisk: 0.4, predictedTone: 'smooth' });
  });

  it('无语言标记的 ``` 围栏同样剥离', () => {
    const raw = '以下是结果：\n```\n{"a":1}\n```\n以上。';
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual({ a: 1 });
  });

  it('解释文字包裹的 JSON 也能解析（贪婪截取）', () => {
    const raw = '好的，预测结果如下：{"stallRisk":0.6} 请查收';
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual({ stallRisk: 0.6 });
  });

  it('尾部截断的残缺 JSON 通过修复解析', () => {
    // 字符串被 maxTokens 截断：缺右括号 + 尾逗号
    const raw = '{"a":1,"b":[1,2,3,';
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it('首个完整 JSON 对象后有多余文本时截取完整对象', () => {
    // 模型先输出一个 JSON 后又补了别的
    const raw = '{"a":1} 然后补充一些说明文字 {"b":2}';
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual({ a: 1 });
  });

  it('围栏内容不完整时仍尝试修复', () => {
    const raw = '```json\n{"a":1,"b":[1,2],';
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual({ a: 1, b: [1, 2] });
  });

  it('完全无法解析时返回 null', () => {
    const result = extractJsonObject('完全没有 JSON 内容的纯文本回复');
    expect(result.parsed).toBeNull();
    expect(result.extractedJson).toBeNull();
  });

  // 2026-10-22 夜间跑批：模拟学习者模型两次把整个对象再序列化成字符串
  it('双重编码的 JSON（整段被包成字符串）解一层后照常取值', () => {
    const inner = { reply: '好，这组题我按平时习惯计时做。', emotion: 'neutral', learnerState: { phaseFocus: 'practice' } };
    const raw = JSON.stringify(JSON.stringify(inner));
    const result = extractJsonObject(raw);
    expect(result.parsed).toEqual(inner);
    expect(result.parsed.reply).toBe(inner.reply);
  });

  it('双重编码只解到对象为止，普通字符串保持原样', () => {
    const result = extractJsonObject(JSON.stringify('一个普通字符串'));
    expect(result.parsed).toBe('一个普通字符串');
  });

  it('空输入返回 null', () => {
    expect(extractJsonObject('').parsed).toBeNull();
    expect(extractJsonObject('  ').parsed).toBeNull();
    expect(extractJsonObject(null as unknown as string).parsed).toBeNull();
  });
});
