// 密码重置链接发送：可插拔邮件通道
// 当前无邮件系统：默认 console provider（重置链接打印到后端日志，供开发环境联调）
// 未来接入真实邮件：实现 MailProvider 并在此注册（如 env 切换 provider）
import { logger } from '../../utils/logger';

export interface PasswordResetMailPayload {
  toName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface MailProvider {
  readonly id: string;
  sendPasswordReset(payload: PasswordResetMailPayload): Promise<void>;
}

/** 抹掉重置链接中的一次性 token（query 参数），保留其余结构供排查 */
export function redactResetToken(resetUrl: string): string {
  try {
    const url = new URL(resetUrl);
    if (url.searchParams.has('token')) {
      url.searchParams.set('token', '***');
    }
    return url.toString();
  } catch {
    return resetUrl.replace(/([?&]token=)[^&]*/g, '$1***');
  }
}

export class ConsoleMailProvider implements MailProvider {
  readonly id = 'console';

  async sendPasswordReset(payload: PasswordResetMailPayload): Promise<void> {
    // 重置链接含一次性令牌，属敏感信息：生产环境只落脱敏链接（读到日志 ≠ 拿到 token），
    // 开发环境保留完整链接便于联调
    console.log(`[password-reset] 收件人: ${payload.toName}，有效期: ${payload.expiresInMinutes} 分钟`);
    if (process.env.NODE_ENV === 'production') {
      console.log(`[password-reset] 重置链接(已脱敏): ${redactResetToken(payload.resetUrl)}`);
    } else {
      console.log(`[password-reset] 重置链接: ${payload.resetUrl}`);
    }
  }
}

export function getPasswordResetMailProvider(): MailProvider {
  const providerId = process.env.PASSWORD_RESET_MAIL_PROVIDER || 'console';
  switch (providerId) {
    case 'console':
      if (process.env.NODE_ENV === 'production') {
        // 链接已脱敏意味着生产用户实际收不到可用链接：这是部署配置缺失，必须显式暴露
        logger.warn('[password-reset] 生产环境正在使用 console 邮件 provider：重置链接已脱敏入日志，用户无法完成自助重置。请尽快配置真实邮件通道（PASSWORD_RESET_MAIL_PROVIDER）。');
      }
      return new ConsoleMailProvider();
    default:
      throw new Error(`未知的密码重置邮件 provider: ${providerId}`);
  }
}
