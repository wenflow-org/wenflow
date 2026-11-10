/**
 * CORS 与 CSRF 共用的来源白名单（2026-10-22 单源化，机械过滤审计 C 类）。
 *
 * 此前两处各自维护默认清单且不同步：http-app.ts 的 CORS 默认多 `http://127.0.0.1:5173`、
 * csrf.middleware 没有——同一请求会「CORS 预检通过、CSRF 写请求被拒」，排查时极易误判。
 * 两处现在都从本模块取默认值与解析逻辑；生产必须显式配 CORS_ORIGIN（http-app 有启动告警）。
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

/** 解析 CORS_ORIGIN 逗号清单：去空白/去尾斜杠；未配置回退默认清单。 */
export const parseAllowedOrigins = (raw?: string): string[] =>
  (raw?.split(',') || DEFAULT_ALLOWED_ORIGINS)
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

/** 本机 / 私网 / mDNS 主机名：只有这类 Host 才允许走「同源即放行」的兜底。 */
const LOOPBACK_OR_PRIVATE_HOST =
  /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[?::1\]?|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)$/;

/** 拿 Host 头里的主机名（去掉端口 / IPv6 方括号），小写。 */
const hostnameOf = (hostHeader: string): string => {
  const raw = hostHeader.trim().toLowerCase();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(':')[0];
};

/**
 * 同源判定：请求的 Origin 与本次请求的 Host 完全一致，且 Host 属于本机/私网。
 *
 * 为什么需要它（2026-11-07 用户报「局域网访问变成请求来源不被允许」）：
 * 白名单只能枚举出已知的 IP:端口。前端跑在 0.0.0.0:5183、从别的设备用
 * http://192.168.66.42:5183 打开时，浏览器发的 Origin 就是那个局域网地址——
 * 换网段 / DHCP 重新分配后名单立刻失效，页面看着能开、一旦写请求（登录、发消息）
 * 就 403「请求来源不被允许」。
 *
 * 安全边界（为什么这不削弱 CSRF 防护）：
 *  - Origin 与 Host 相同 ⇒ 发起页面就是从本服务加载的，跨站页面伪造不出这个头；
 *  - 再限定 Host 必须是 loopback/私网/mDNS，公网域名部署仍只认显式白名单
 *    （避免 DNS rebinding 把公网域名解析到内网地址后绕过）；
 *  - 请求仍要过鉴权：这里只表示「不是跨站伪造」，不代表已登录。
 */
export const isSameOriginRequest = (origin?: string, hostHeader?: string): boolean => {
  if (!origin || !hostHeader) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const originHost = parsed.host.toLowerCase().replace(/:80$/, '').replace(/:443$/, '');
  const requestHost = hostHeader.trim().toLowerCase().replace(/:80$/, '').replace(/:443$/, '');
  if (!originHost || originHost !== requestHost) {
    return false;
  }

  return LOOPBACK_OR_PRIVATE_HOST.test(hostnameOf(originHost));
};
