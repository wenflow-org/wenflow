/**
 * 能力消费方账本对账（2026-10-21）。
 *
 * 用法：`npm --prefix backend run capability:check`
 *
 * 检查三件事：
 * 1. `backend/config/llm-providers.json` 里出现的每个 provider / model 键都必须在
 *    `src/config/capability-consumers.ts` 登记（未登记的键会被加载器静默丢弃）；
 * 2. 登记为 runtime / display 的字段，其消费点文件必须存在且包含声明的符号；
 * 3. 已知零消费字段（capabilities / contextWindow / supportsTools / supportsStream）
 *    一旦出现在真实文件里直接失败。
 */
import fs from 'fs';
import path from 'path';
import {
  CAPABILITY_CONSUMERS,
  UNSUPPORTED_FIELDS,
  type CapabilityConsumerEntry,
} from '../config/capability-consumers';

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(BACKEND_ROOT, 'src');
const REGISTRY_PATH = path.join(BACKEND_ROOT, 'config', 'llm-providers.json');

/** 解析 `path#symbol` 形式的消费点引用。 */
export function parseConsumerRef(ref: string): { file: string; symbol: string | null } {
  const [file, symbol] = ref.split('#');
  return { file, symbol: symbol && symbol.trim() ? symbol.trim() : null };
}

export interface CapabilityCheckIssue {
  level: 'error' | 'warning';
  code:
    | 'UNKNOWN_FIELD'
    | 'UNSUPPORTED_FIELD'
    | 'MISSING_CONSUMER'
    | 'CONSUMER_FILE_MISSING'
    | 'CONSUMER_SYMBOL_MISSING';
  field: string;
  detail: string;
}

/** 纯函数：给定注册表内容与账本，产出问题清单（便于单测）。 */
export function auditCapabilityConsumers(
  registry: unknown,
  entries: CapabilityConsumerEntry[] = CAPABILITY_CONSUMERS,
  readSource: (relativePath: string) => string | null = (relativePath) => {
    const absolute = path.join(SRC_ROOT, relativePath);
    try {
      return fs.readFileSync(absolute, 'utf8');
    } catch {
      return null;
    }
  }
): CapabilityCheckIssue[] {
  const issues: CapabilityCheckIssue[] = [];
  const known = new Map(entries.map((entry) => [entry.field, entry]));
  const unsupported = new Set(UNSUPPORTED_FIELDS);

  const seen = new Set<string>();
  const visit = (field: string, allowRoot = false) => {
    if (seen.has(field)) return;
    seen.add(field);
    if (unsupported.has(field)) {
      issues.push({ level: 'error', code: 'UNSUPPORTED_FIELD', field, detail: '该字段零消费方，写入不会生效' });
      return;
    }
    if (!known.has(field) && !(allowRoot && field.startsWith('root.$'))) {
      issues.push({
        level: 'error',
        code: 'UNKNOWN_FIELD',
        field,
        detail: '未在 src/config/capability-consumers.ts 登记（加载器会静默丢弃）',
      });
    }
  };

  if (registry && typeof registry === 'object') {
    const root = registry as Record<string, unknown>;
    for (const key of Object.keys(root)) {
      if (key === 'providers' || key === 'aliases' || key === 'defaults') visit(`root.${key}`);
      else visit(`root.${key}`, true);
    }
    const providers = root.providers && typeof root.providers === 'object'
      ? root.providers as Record<string, unknown>
      : {};
    for (const provider of Object.values(providers)) {
      if (!provider || typeof provider !== 'object') continue;
      const providerRecord = provider as Record<string, unknown>;
      for (const key of Object.keys(providerRecord)) {
        if (key === 'models') {
          visit('provider.models');
          continue;
        }
        visit(`provider.${key}`);
      }
      const models = providerRecord.models && typeof providerRecord.models === 'object'
        ? providerRecord.models as Record<string, unknown>
        : {};
      for (const model of Object.values(models)) {
        if (!model || typeof model !== 'object') continue;
        for (const key of Object.keys(model as Record<string, unknown>)) visit(`model.${key}`);
      }
    }
  }

  // 消费点引用可解析：runtime 必须有消费点，display 允许为空（纯注释类）
  for (const entry of entries) {
    if (entry.kind === 'runtime' && entry.consumers.length === 0) {
      issues.push({
        level: 'error',
        code: 'MISSING_CONSUMER',
        field: entry.field,
        detail: '登记为 runtime 但没有任何消费点',
      });
      continue;
    }
    if (entry.kind === 'unsupported' || entry.kind === 'derived') continue;
    for (const ref of entry.consumers) {
      const { file, symbol } = parseConsumerRef(ref);
      const source = readSource(file);
      if (source === null) {
        issues.push({
          level: 'error',
          code: 'CONSUMER_FILE_MISSING',
          field: entry.field,
          detail: `消费点文件不存在：src/${file}`,
        });
        continue;
      }
      if (symbol && !source.includes(symbol)) {
        issues.push({
          level: 'warning',
          code: 'CONSUMER_SYMBOL_MISSING',
          field: entry.field,
          detail: `src/${file} 中找不到符号「${symbol}」（消费点可能已重构，账本需同步）`,
        });
      }
    }
  }

  return issues;
}

function main(): void {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`[capability-check] 找不到注册表：${REGISTRY_PATH}`);
    process.exit(1);
  }
  let registry: unknown;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (error) {
    console.error('[capability-check] 注册表不是合法 JSON', error);
    process.exit(1);
  }

  const issues = auditCapabilityConsumers(registry);
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  for (const issue of issues) {
    const tag = issue.level === 'error' ? 'ERROR' : 'WARN ';
    console.log(`[capability-check] ${tag} ${issue.field} (${issue.code}) — ${issue.detail}`);
  }
  console.log(
    `[capability-check] 登记 ${CAPABILITY_CONSUMERS.length} 个字段；文件对账完成：`
    + `${errors.length} error / ${warnings.length} warning`
  );
  if (errors.length > 0) process.exit(1);
}

if (require.main === module) main();
