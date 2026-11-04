/**
 * 复制文本（2026-11-02 走查）。
 *
 * 为什么不能直接用 navigator.clipboard：课堂常在局域网明文 HTTP 下访问
 * （如 http://192.168.x.x:5173），**非安全上下文里 navigator.clipboard 根本不存在**
 * （或权限被拒）——实测表现就是「点复制按钮、右上角一直弹『复制失败』」。
 *
 * 口径与 admin 侧 ExecLogs/HealthCenter 一致：先走 Clipboard API，失败回退
 * execCommand('copy')；两者都失败返回 false，由调用方给用户明确提示，绝不静默。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 权限被拒 / 非安全上下文 → 回退 */
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
