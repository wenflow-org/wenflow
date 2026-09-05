// 密码重置链接发送：可插拔邮件通道
// 当前无邮件系统：默认 console provider（重置链接打印到后端日志，供开发环境联调）
// 未来接入真实邮件：实现 MailProvider 并在此注册（如 env 切换 provider）

export interface PasswordResetMailPayload {
  toName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface MailProvider {
  readonly id: string;
  sendPasswordReset(payload: PasswordResetMailPayload): Promise<void>;
}

export class ConsoleMailProvider implements MailProvider {
  readonly id = 'console';

  async sendPasswordReset(payload: PasswordResetMailPayload): Promise<void> {
    // 重置链接含一次性令牌，属敏感信息：打印到日志便于开发联调；生产接入邮件后此 provider 不应启用
    console.log(`[password-reset] 收件人: ${payload.toName}，有效期: ${payload.expiresInMinutes} 分钟`);
    console.log(`[password-reset] 重置链接: ${payload.resetUrl}`);
  }
}

export function getPasswordResetMailProvider(): MailProvider {
  const providerId = process.env.PASSWORD_RESET_MAIL_PROVIDER || 'console';
  switch (providerId) {
    case 'console':
      return new ConsoleMailProvider();
    default:
      throw new Error(`未知的密码重置邮件 provider: ${providerId}`);
  }
}
