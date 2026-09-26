/**
 * 虚拟会话路由共用的错误响应映射（原 virtual-learners.ts 内联函数，2026-09-27 随
 * 裁判独立面拆出共享——session-audits 与 virtual-learners 必须同一套状态码口径）。
 */

import type { Response } from 'express';
import { asErrorLike } from '../../virtual-lab/vlab-types';

export function virtualSessionErrorStatus(error: unknown, fallback = 500) {
  const err = asErrorLike(error);
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (typeof err.status === 'number') return err.status;
  const message = String(err.message || '');
  if (message.includes('不存在')) return 404;
  if (message.includes('不合法') || message.includes('缺少') || message.includes('不支持')) return 400;
  if (message.includes('当前') || message.includes('不能') || message.includes('必须')) return 409;
  return fallback;
}

export function sendVirtualSessionError(res: Response, error: unknown, fallbackMessage: string, fallbackStatus = 500) {
  const err = asErrorLike(error);
  return res.status(virtualSessionErrorStatus(error, fallbackStatus)).json({
    success: false,
    error: err.message || fallbackMessage,
    ...(err.code ? { code: err.code } : {}),
    ...(typeof (error as { retryable?: unknown } | null)?.retryable === 'boolean' ? { retryable: (error as { retryable: boolean }).retryable } : {})
  });
}
