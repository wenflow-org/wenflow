import { slimPromptCallRow } from '../telemetry-writer.service';

describe('slimPromptCallRow（成功行写前瘦身，2026-10-08 数据还债 B2）', () => {
  const bigPayload = 'x'.repeat(5000);

  it('失败行原样保留（排障全量价值）', () => {
    const row = { success: false, userPayload: bigPayload, rawModelOutput: bigPayload, extractedJson: bigPayload };
    expect(slimPromptCallRow(row)).toEqual(row);
  });

  it('成功行超 4K 的 userPayload/raw/extracted 换瘦身标记（bytes/sha256/head）', () => {
    const out = slimPromptCallRow({
      success: true,
      userPayload: bigPayload,
      rawModelOutput: bigPayload,
      extractedJson: bigPayload,
      normalizedOutput: '{"ok":1}',
    });
    for (const key of ['userPayload', 'rawModelOutput', 'extractedJson'] as const) {
      const marker = JSON.parse(out[key]);
      expect(marker.__slim).toBe(true);
      expect(marker.bytes).toBe(Buffer.byteLength(bigPayload));
      expect(marker.head).toHaveLength(400);
      expect(marker.sha256).toHaveLength(16);
    }
    expect(out.normalizedOutput).toBe('{"ok":1}');
  });

  it('成功行小字段原样保留（≤4K 不动）', () => {
    const row = { success: true, userPayload: '{"small":1}', rawModelOutput: 'ok', extractedJson: null, normalizedOutput: null };
    const out = slimPromptCallRow(row);
    expect(out.userPayload).toBe('{"small":1}');
    expect(out.rawModelOutput).toBe('ok');
  });

  it('成功行 normalizedOutput 离群截断到 256K', () => {
    const out = slimPromptCallRow({ success: true, normalizedOutput: 'y'.repeat(300000) });
    expect((out.normalizedOutput as string).length).toBe(262144);
  });

  it('null/undefined 数据安全透传', () => {
    expect(slimPromptCallRow(null)).toEqual(null);
    expect(slimPromptCallRow(undefined)).toEqual(undefined);
  });
});
