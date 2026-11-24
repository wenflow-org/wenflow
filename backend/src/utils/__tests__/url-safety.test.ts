/**
 * 学生贴链接安全闸单测（2026-11-23 切口③）：
 * 学生手贴的 URL 是不可信输入——协议白名单 + SSRF 常规探测面（localhost/内网/保留段 IP）
 * + userinfo 拒收。fetch 由外部 Provider 执行，本文件只做 URL 字面量级检查（零 DNS 依赖）。
 */
import { extractHttpUrls, isSafePublicHttpUrl } from '../url-safety';

describe('extractHttpUrls', () => {
  it('抽取保序去重（host 大小写/尾斜杠归一；路径大小写敏感不归一），中文标点收尾不裹进来', () => {
    const text = '看这个 https://example.com/a，还有 https://Example.COM/a/ 和 http://x.org/doc。';
    expect(extractHttpUrls(text)).toEqual(['https://example.com/a', 'http://x.org/doc']);
    // 路径大小写是不同页面，不合并
    expect(extractHttpUrls('https://example.com/A https://example.com/a')).toHaveLength(2);
  });

  it('max 截断 + 无 URL 返回空', () => {
    expect(extractHttpUrls('没有链接的一句话')).toEqual([]);
    expect(extractHttpUrls('https://a.com https://b.com https://c.com https://d.com', 2)).toHaveLength(2);
  });
});

describe('isSafePublicHttpUrl · SSRF 闸', () => {
  it('公网 http/https 通过', () => {
    expect(isSafePublicHttpUrl('https://learn.microsoft.com/sql/t-sql')).toEqual({ ok: true });
    expect(isSafePublicHttpUrl('http://example.com')).toEqual({ ok: true });
  });

  it('非 http/https 协议拒收（file/javascript/data）', () => {
    expect(isSafePublicHttpUrl('file:///etc/passwd').code).toBe('insecure-protocol');
    expect(isSafePublicHttpUrl('javascript:alert(1)').code).toBe('insecure-protocol');
    expect(isSafePublicHttpUrl('data:text/html,x').code).toBe('insecure-protocol');
    expect(isSafePublicHttpUrl('not a url').code).toBe('insecure-protocol');
  });

  it('localhost 与内网域名拒收', () => {
    expect(isSafePublicHttpUrl('http://localhost:3001/api').code).toBe('localhost');
    expect(isSafePublicHttpUrl('http://api.localhost/x').code).toBe('localhost');
    expect(isSafePublicHttpUrl('https://intranet.company.local/secret').code).toBe('localhost');
    expect(isSafePublicHttpUrl('http://db.internal/').code).toBe('localhost');
  });

  it('内网/保留段 IPv4 字面量拒收（SSRF 探测面）', () => {
    expect(isSafePublicHttpUrl('http://127.0.0.1:3001/').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://10.0.0.5/').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://192.168.1.10/admin').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://172.16.0.9/').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://0.0.0.0/').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://100.64.1.1/').code).toBe('private-host');
  });

  it('公网 IPv4 字面量放行；IPv6 环回/ULA/链路本地拒收', () => {
    expect(isSafePublicHttpUrl('http://93.184.216.34/')).toEqual({ ok: true });
    expect(isSafePublicHttpUrl('http://[::1]/').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://[fd00::5]/').code).toBe('private-host');
    expect(isSafePublicHttpUrl('http://[fe80::1]/').code).toBe('private-host');
  });

  it('带 userinfo 的 URL 拒收（防凭据外泄给第三方抓取）', () => {
    expect(isSafePublicHttpUrl('https://user:pass@example.com/').code).toBe('credentials');
  });
});
