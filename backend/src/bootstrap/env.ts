/**
 * 进程环境装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：加载 .env、强制安全配置检查（JWT_SECRET 强校验）、
 * 密钥加密 / 安全 HTTP / 运行时数据库路径校验。
 * 必须在任何业务初始化之前执行；校验失败直接终止进程（fail-fast）。
 */
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { validateSecretEncryptionConfig } from '../utils/secret-crypto';
import { validateSafeHttpConfig } from '../utils/safe-http';
import { validateRuntimeDatabaseUrls } from '../utils/runtime-paths';

export function bootstrapEnvironment(): void {
  // 加载环境变量
  dotenv.config();

  // 强制安全配置检查
  const requiredEnvVars = ['JWT_SECRET'];

  requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) {
      console.error(`❌ 缺少必要的环境变量: ${envVar}`);
      console.error('请在 .env 文件中配置该变量');
      process.exit(1);
    }
  });

  // JWT_SECRET 安全性检查
  if (process.env.JWT_SECRET === 'your-secret-key-change-in-production' ||
      process.env.JWT_SECRET?.length < 32) {
    console.error('❌ JWT_SECRET 不安全：');
    console.error('  - 请勿使用默认值');
    console.error('  - 密钥长度至少32位');
    console.error('  - 建议使用随机生成：openssl rand -base64 32');
    process.exit(1);
  }

  logger.info('✅ 安全配置检查通过');
  validateSecretEncryptionConfig(true);
  validateSafeHttpConfig();
  validateRuntimeDatabaseUrls(process.env.DATABASE_URL, process.env.SYSTEM_DATABASE_URL);
}
