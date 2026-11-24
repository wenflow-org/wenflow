/**
 * 学生消息里 URL 的安全闸（2026-11-23 学生贴链接通道配套）。
 *
 * 与搜索链路的区别：搜索返回的 URL 至少经过搜索引擎筛查，而**学生手贴的 URL 是不可信输入**——
 * 在丢给外部 fetch Provider 前必须先验：
 *   ① 仅 http/https 协议（file/javascript/data 一律拒）；
 *   ② 拒 localhost / 内网 / 保留段 IP 字面量（SSRF：防把内网地址交给第三方抓取、防探测）；
 *   ③ 拒带 userinfo 的 URL（http://user:pass@host 形态）。
 * 不做 DNS 解析级校验（fetch 由外部 Provider 执行，不在本机出网；URL 字面量检查已挡住
 * 常规探测面），保持零依赖。
 */

export type UnsafeUrlCode = 'insecure-protocol' | 'private-host' | 'localhost' | 'credentials';

export interface UrlSafetyVerdict {
  ok: boolean;
  code?: UnsafeUrlCode;
}

/** 消息文本里的 http(s) URL 抽取：去重、保序、默认最多取前 3 条。 */
export function extractHttpUrls(text: string, max = 3): string[] {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'）】」）】,,，。;;！!?？]+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const trimmed = raw.replace(/[.,;:!?)]+$/g, '');
    // 去重键按「host 小写 + path 去尾斜杠 + query」归一——example.com/a 与 Example.com/A/ 视为同一页
    let key = trimmed.toLowerCase();
    try {
      const u = new URL(trimmed);
      key = `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
    } catch {
      // 非法 URL 保留原样键
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/** IPv4 字面量是否落在私有/保留段（SSRF 常规探测面）。 */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true; // 私有 / 环回 / 未指定
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true; // 私有
  if (a === 192 && b === 168) return true; // 私有
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function looksLikeIPv6Local(host: string): boolean {
  const h = host.toLowerCase();
  return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8');
}

/**
 * 单条 URL 的安全判定。ok=false 时 code 说明原因（可直接映射为学生可理解的降级文案）。
 */
export function isSafePublicHttpUrl(url: string): UrlSafetyVerdict {
  let parsed: URL;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return { ok: false, code: 'insecure-protocol' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'insecure-protocol' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'credentials' };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, code: 'private-host' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, code: 'localhost' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) return { ok: false, code: 'private-host' };
    return { ok: true };
  }
  if (host.includes(':') && looksLikeIPv6Local(host)) {
    return { ok: false, code: 'private-host' };
  }
  return { ok: true };
}
