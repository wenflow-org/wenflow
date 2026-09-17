import * as fs from 'fs';
import * as path from 'path';
import {
  encryptSecret,
  isEncryptedSecret,
  validateSecretEncryptionConfig
} from '../utils/secret-crypto';

export interface McpSecretMigrationStats {
  scanned: number;
  pending: number;
  migrated: number;
  failed: number;
}

const MCP_CONFIG_PATH = path.join(__dirname, '../../config/mcp.json');
const MCP_SECRET_CONTEXT = 'system.mcp_config.apiKey';
const ENV_TEMPLATE_PATTERN = /^\$\{[\s\S]*\}$/;

export function migrateMcpSecrets(apply: boolean, configPath = MCP_CONFIG_PATH): McpSecretMigrationStats {
  const stats: McpSecretMigrationStats = { scanned: 0, pending: 0, migrated: 0, failed: 0 };
  validateSecretEncryptionConfig(true);

  const content = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
  const config = JSON.parse(content) as {
    providers?: Array<{ id: string; apiKey?: string }>;
    /** 旧字段名（历史配置） */
    servers?: Array<{ id: string; apiKey?: string }>;
  };
  // 兼容旧字段名：历史配置用 servers 表示外挂服务/供应商
  const providers = Array.isArray(config.providers)
    ? config.providers
    : (Array.isArray(config.servers) ? config.servers : []);

  let changed = false;
  for (const provider of providers) {
    const apiKey = provider.apiKey;
    if (!apiKey || ENV_TEMPLATE_PATTERN.test(apiKey) || isEncryptedSecret(apiKey)) continue;
    stats.scanned++;
    stats.pending++;
    if (apply) {
      try {
        const encrypted = encryptSecret(apiKey, MCP_SECRET_CONTEXT) ?? apiKey;
        provider.apiKey = encrypted;
        changed = true;
        stats.migrated++;
      } catch (error) {
        stats.failed++;
        console.error(`[mcp-secret-migration] provider id=${provider.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (apply && changed) {
    const tmpPath = `${configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);
  }

  return stats;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const fileArgIndex = process.argv.indexOf('--file');
  const configPath = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : MCP_CONFIG_PATH;
  const stats = migrateMcpSecrets(apply, configPath);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'audit', file: configPath, ...stats }));
  if (stats.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[mcp-secret-migration] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
