import { isPasswordResetMailDeliveryAvailable } from '../password-reset-mailer';

describe('密码重置邮件通道能力', () => {
  const original = process.env.PASSWORD_RESET_MAIL_PROVIDER;

  afterEach(() => {
    if (original === undefined) delete process.env.PASSWORD_RESET_MAIL_PROVIDER;
    else process.env.PASSWORD_RESET_MAIL_PROVIDER = original;
  });

  it('默认 console provider 不能承诺用户能收到邮件', () => {
    delete process.env.PASSWORD_RESET_MAIL_PROVIDER;
    expect(isPasswordResetMailDeliveryAvailable()).toBe(false);
  });

  it('配置了非 console provider 时视为具备投递能力', () => {
    process.env.PASSWORD_RESET_MAIL_PROVIDER = 'smtp';
    expect(isPasswordResetMailDeliveryAvailable()).toBe(true);
  });
});
