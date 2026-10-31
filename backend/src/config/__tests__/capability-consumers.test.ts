import fs from 'fs';
import path from 'path';
import { auditCapabilityConsumers, parseConsumerRef } from '../../scripts/check-capability-consumers';
import { CAPABILITY_CONSUMERS, UNSUPPORTED_FIELDS, findCapabilityConsumer, runtimeFields } from '../../config/capability-consumers';

const fakeSource = (map: Record<string, string>) => (relativePath: string) => map[relativePath] ?? null;

describe('capability consumer ledger', () => {
  it('未登记的 provider 键报 UNKNOWN_FIELD', () => {
    const issues = auditCapabilityConsumers(
      { providers: { acme: { name: 'Acme', mysteryKnob: true, models: {} } } },
      CAPABILITY_CONSUMERS,
      fakeSource({})
    );
    expect(issues.some((i) => i.code === 'UNKNOWN_FIELD' && i.field === 'provider.mysteryKnob')).toBe(true);
  });

  it('已知零消费字段出现在文件里报 UNSUPPORTED_FIELD', () => {
    for (const field of UNSUPPORTED_FIELDS) {
      const [scope, key] = field.split('.') as [string, string];
      const registry = scope === 'provider'
        ? { providers: { acme: { [key]: true, models: {} } } }
        : { providers: { acme: { models: { m1: { [key]: true } } } } };
      const issues = auditCapabilityConsumers(registry, CAPABILITY_CONSUMERS, fakeSource({}));
      expect(issues.some((i) => i.code === 'UNSUPPORTED_FIELD' && i.field === field)).toBe(true);
    }
  });

  it('runtime 字段没有消费点报 MISSING_CONSUMER', () => {
    const issues = auditCapabilityConsumers({}, [
      { field: 'provider.enabled', kind: 'runtime', consumers: [] },
    ], fakeSource({}));
    expect(issues).toEqual([
      expect.objectContaining({ code: 'MISSING_CONSUMER', field: 'provider.enabled' }),
    ]);
  });

  it('消费点文件缺失 / 符号漂移分别报错与警告', () => {
    const issues = auditCapabilityConsumers({}, [
      { field: 'provider.enabled', kind: 'runtime', consumers: ['nowhere/missing.ts#x'] },
      { field: 'provider.name', kind: 'display', consumers: ['config/models.config.ts#NOT_THERE_SYMBOL'] },
    ], fakeSource({ 'config/models.config.ts': 'export const something = 1;' }));
    expect(issues.some((i) => i.code === 'CONSUMER_FILE_MISSING')).toBe(true);
    expect(issues.some((i) => i.code === 'CONSUMER_SYMBOL_MISSING' && i.level === 'warning')).toBe(true);
  });

  it('真实注册表与真实源码：零 error', () => {
    const backendRoot = path.resolve(__dirname, '../../..');
    const registry = JSON.parse(fs.readFileSync(path.join(backendRoot, 'config', 'llm-providers.json'), 'utf8'));
    const issues = auditCapabilityConsumers(registry);
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('账本字段名唯一且 runtime 字段有消费者', () => {
    const fields = CAPABILITY_CONSUMERS.map((entry) => entry.field);
    expect(new Set(fields).size).toBe(fields.length);
    for (const field of runtimeFields()) {
      const entry = findCapabilityConsumer(field);
      expect(entry?.consumers.length).toBeGreaterThan(0);
    }
  });

  it('parseConsumerRef 容忍没有符号的引用', () => {
    expect(parseConsumerRef('config/models.config.ts#enabled')).toEqual({ file: 'config/models.config.ts', symbol: 'enabled' });
    expect(parseConsumerRef('config/models.config.ts')).toEqual({ file: 'config/models.config.ts', symbol: null });
  });
});
