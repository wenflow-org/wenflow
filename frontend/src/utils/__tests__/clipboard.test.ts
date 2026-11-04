/**
 * 复制兼容层（2026-11-02 走查）：局域网明文 HTTP 下 navigator.clipboard 不存在，
 * 课堂「复制」按钮此前只会弹失败 toast。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../clipboard';

const originalExecCommand = document.execCommand;

afterEach(() => {
  document.execCommand = originalExecCommand;
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('Clipboard API 可用时走 API，不走回退', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('非安全上下文（navigator.clipboard 不存在）→ 回退 execCommand 成功', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await expect(copyText('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // 临时 textarea 用完必须清掉
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('Clipboard API 抛权限错 → 回退 execCommand', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.execCommand = vi.fn().mockReturnValue(true);

    await expect(copyText('hello')).resolves.toBe(true);
  });

  it('两条路都失败 → false（调用方给明确提示，不静默）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(copyText('hello')).resolves.toBe(false);
  });
});
