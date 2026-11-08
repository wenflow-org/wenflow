/**
 * 来源白名单与「同源放行」判定（2026-11-07）
 *
 * 用户报：管理端把「管理后台访问控制」设成不限制后，从别的设备用局域网地址打开
 * 用户侧，登录直接变成 403「请求来源不被允许」。
 *
 * 病根不在那个开关（它只管管理后台的 IP 准入，映射 adminAccessMode），而在 CSRF/CORS
 * 的来源白名单：CORS_ORIGIN 只枚举了 localhost/127.0.0.1 的几个端口；换设备访问时
 * 浏览器发的 Origin 是 http://192.168.66.42:5183，不在名单里 → 写请求一律 403。
 *
 * 修法：Origin 与本次请求的 Host 一致、且 Host 属本机/私网时视为同源放行。本文件
 * 逐条锁住这个判定的边界——放宽的只有「同一台主机换设备访问」，跨站伪造仍拒绝。
 */
import { isSameOriginRequest, parseAllowedOrigins, DEFAULT_ALLOWED_ORIGINS } from '../allowed-origins';

describe('parseAllowedOrigins', () => {
  it('未配置时回退默认清单（全站 localhost 开发端口）', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(DEFAULT_ALLOWED_ORIGINS);
  });

  it('逗号清单去空白与尾斜杠', () => {
    expect(parseAllowedOrigins(' http://a.test:1/ , http://b.test ')).toEqual(['http://a.test:1', 'http://b.test']);
  });
});

describe('isSameOriginRequest：同源局域网访问放行', () => {
  it('局域网 IP 与请求 Host 一致 → 放行（用户本次遇到的场景）', () => {
    expect(isSameOriginRequest('http://192.168.66.42:5183', '192.168.66.42:5183')).toBe(true);
    expect(isSameOriginRequest('http://10.0.0.7:3001', '10.0.0.7:3001')).toBe(true);
    expect(isSameOriginRequest('http://172.20.1.5:8080', '172.20.1.5:8080')).toBe(true);
  });

  it('localhost / 127.0.0.1 / [::1] 一致 → 放行', () => {
    expect(isSameOriginRequest('http://localhost:5183', 'localhost:5183')).toBe(true);
    expect(isSameOriginRequest('http://127.0.0.1:3001', '127.0.0.1:3001')).toBe(true);
    expect(isSameOriginRequest('http://[::1]:3001', '[::1]:3001')).toBe(true);
  });

  it('mDNS 局域网主机名一致 → 放行（Mac/部分路由用 my-pc.local）', () => {
    expect(isSameOriginRequest('http://my-mac.local:5183', 'my-mac.local:5183')).toBe(true);
  });

  it('https 同源（反向代理终结 TLS）也放行，默认端口差异不影响', () => {
    expect(isSameOriginRequest('https://192.168.1.9', '192.168.1.9:443')).toBe(true);
    expect(isSameOriginRequest('http://192.168.1.9', '192.168.1.9:80')).toBe(true);
  });
});

describe('isSameOriginRequest：跨站 / 可疑来源仍拒绝', () => {
  it('Origin 主机与本次 Host 不同 → 拒绝（跨站伪造的典型形态）', () => {
    expect(isSameOriginRequest('https://evil.example', '192.168.66.42:5183')).toBe(false);
    expect(isSameOriginRequest('http://192.168.66.43:5183', '192.168.66.42:5183')).toBe(false);
  });

  it('公网域名指向内网地址 → 拒绝（DNS rebinding 防护：不因私网可达就放行公网域名）', () => {
    expect(isSameOriginRequest('http://evil.example:5183', 'evil.example:5183')).toBe(false);
    expect(isSameOriginRequest('http://app.public.com', 'app.public.com')).toBe(false);
  });

  it('缺 Origin 或 Host → 拒绝（缺一不能判同源）', () => {
    expect(isSameOriginRequest(undefined, '192.168.66.42:5183')).toBe(false);
    expect(isSameOriginRequest('http://192.168.66.42:5183', undefined)).toBe(false);
    expect(isSameOriginRequest('', '')).toBe(false);
  });

  it('非 http(s) 协议 / 非法 Origin → 拒绝', () => {
    expect(isSameOriginRequest('file://192.168.1.2/x', '192.168.1.2')).toBe(false);
    expect(isSameOriginRequest('not a url', '192.168.1.2')).toBe(false);
    expect(isSameOriginRequest('null', '192.168.1.2')).toBe(false);
  });

  it('公网 IP 即使用同源也拒绝（要求 Host 是本机/私网）', () => {
    expect(isSameOriginRequest('http://8.8.8.8:5183', '8.8.8.8:5183')).toBe(false);
  });
});
