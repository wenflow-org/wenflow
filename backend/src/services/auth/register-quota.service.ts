/**
 * 注册治理（R6）：单 IP 每日注册数量上限。
 *
 * 现状（VLAB_DATA_SURVEY P0-1）：公开注册仅 10 次/小时/IP 的内存尝试限速，
 * shotsnap 14 账号 2 小时批量注册——尝试限速拦不住"每 5 分钟注册一个"的慢批量。
 * 本服务把成功注册持久化进 login_attempts（scope='register', success=true），
 * 以 DB 累计计数实现 24h 窗口内的数量上限（默认 5 个/天/IP，env REGISTER_IP_DAILY_QUOTA 可调），
 * 超过即 429 REGISTER_IP_QUOTA_EXCEEDED。重启不丢失、跨实例生效。
 *
 * 权衡（不自动打测试标记）：用户名命中 TEST_ACCOUNT_PREFIXES 不自动标记——
 * isVirtualLearner 语义是"无凭据虚拟学习者"，错位；新增 isTestAccount 列需 SQLite
 * 重建 users 表（被 ~20 张子表外键引用，风险大于收益）。存量识别已有 isTestAccountUser
 * 单点（登录拒绝 + 统计/风险队列过滤），新注册受数量上限约束后批量污染面已被封堵。
 */

import prisma from '../../config/database';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

export const DEFAULT_IP_DAILY_QUOTA = 5;
export const REGISTER_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 解析环境变量配置：正整数才生效，否则回退默认 5 */
export function resolveIpDailyQuota(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_IP_DAILY_QUOTA;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(`[register-quota] REGISTER_IP_DAILY_QUOTA 无效（${value}），使用默认 ${DEFAULT_IP_DAILY_QUOTA}`);
    return DEFAULT_IP_DAILY_QUOTA;
  }
  return parsed;
}

export class IpRegisterQuotaExceededError extends Error {
  readonly status = 429;
  readonly code = 'REGISTER_IP_QUOTA_EXCEEDED';
  readonly quota: number;
  readonly retryAfterHours = 24;

  constructor(quota: number) {
    super(`同一 IP 每天最多注册 ${quota} 个账号，请明天再试`);
    this.name = 'IpRegisterQuotaExceededError';
    this.quota = quota;
  }
}

type QuotaDatabase = Pick<PrismaClient, 'login_attempts'>;

export class RegisterQuotaService {
  private readonly database: QuotaDatabase;

  constructor(options: { database?: QuotaDatabase } = {}) {
    this.database = options.database ?? prisma;
  }

  /** 查询某 IP 在窗口内（默认 24h）的成功注册数量 */
  async countRecentRegistrations(ip: string, now: Date = new Date()): Promise<number> {
    return this.database.login_attempts.count({
      where: {
        scope: 'register',
        ip,
        success: true,
        createdAt: { gte: new Date(now.getTime() - REGISTER_QUOTA_WINDOW_MS) }
      }
    });
  }

  /**
   * 注册前置校验：超过配额抛 IpRegisterQuotaExceededError（429）。
   * 返回当前剩余配额（供日志），0 表示恰好已满。
   */
  async assertWithinDailyQuota(
    ip: string,
    quota: number,
    now: Date = new Date()
  ): Promise<number> {
    const used = await this.countRecentRegistrations(ip, now);
    if (used >= quota) {
      throw new IpRegisterQuotaExceededError(quota);
    }
    return quota - used;
  }

  /** 注册成功后落库：写入 login_attempts（scope='register'，与登录审计同表同索引） */
  async recordSuccessfulRegistration(
    ip: string,
    username: string,
    now: Date = new Date()
  ): Promise<void> {
    await this.database.login_attempts.create({
      data: {
        scope: 'register',
        username: username.slice(0, 64),
        ip,
        success: true,
        reason: 'registration_ok',
        createdAt: now
      }
    }).catch((error) => {
      // 配额记录写入失败仅告警：不阻断注册主流程（宁可少记一次配额，不让用户注册失败）
      logger.warn('[register-quota] 注册配额记录写入失败', {
        error: error instanceof Error ? error.message : String(error),
        ip
      });
    });
  }
}

export const registerQuotaService = new RegisterQuotaService();
