import { isIP } from 'net';

export type TrustProxySetting = boolean | number | string;

function isIpOrCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0) return false;
  const version = isIP(address);
  if (!version) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (version === 4 ? 32 : 128);
}

export function resolveTrustProxySetting(
  configuredValue: string | undefined,
  nodeEnvironment: string | undefined
): TrustProxySetting {
  const value = (configuredValue || '').trim();
  const normalized = value.toLowerCase();

  if (!value || normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true') {
    if (nodeEnvironment === 'production') {
      throw new Error('生产环境禁止 TRUST_PROXY=true，请配置受信代理 IP、CIDR 或明确跳数');
    }
    return true;
  }
  if (/^\d+$/.test(value)) return Number(value);
  const proxies = value.split(',').map(item => item.trim()).filter(Boolean);
  if (proxies.length === 0 || proxies.some(proxy => !isIpOrCidr(proxy))) {
    throw new Error('TRUST_PROXY 只允许代理 IP、CIDR、逗号分隔地址或非负跳数');
  }
  return proxies.join(', ');
}

export interface AdminAllowlistRisk {
  /** true = 管理端 IP 白名单可被客户端请求头伪造 */
  spoofable: boolean;
  reason: string | null;
}

/**
 * 管理端「按来源 IP 放行」的白名单是否可被 `X-Forwarded-For` 伪造。
 *
 * 背景（2026-10-17 实测）：`adminAccessRestrictMiddleware` 只看 `req.ip`。而 `TRUST_PROXY` 设为
 * `true` 或跳数（如 `1`）时，Express 会用**客户端可自带的** `X-Forwarded-For` 覆盖 `req.ip`
 * —— 实测把 XFF 写成 `127.0.0.1` 即可穿过 `private`/`loopback` 白名单（200）。
 * 这与「init-admin 未配口令时回退公开默认口令」叠加，就成了公网管理员接管路径。
 *
 * 判定：`ADMIN_ACCESS_MODE='any'` 时白名单本就不生效（无风险）；否则
 * `TRUST_PROXY` 为 `true` 或 **非零跳数** 即视为可伪造。
 * **显式代理 IP/CIDR 列表不算**——那种配置下只有来自该代理的连接才被信任（Express 语义）。
 */
export function assessAdminAllowlistRisk(params: {
  trustProxy: TrustProxySetting;
  adminAccessMode?: string | null;
}): AdminAllowlistRisk {
  const mode = params.adminAccessMode === 'loopback' || params.adminAccessMode === 'any'
    ? params.adminAccessMode
    : 'private';
  if (mode === 'any') return { spoofable: false, reason: null };
  const setting = params.trustProxy;
  const trustsArbitraryUpstream = setting === true || (typeof setting === 'number' && setting > 0);
  if (!trustsArbitraryUpstream) return { spoofable: false, reason: null };
  return {
    spoofable: true,
    reason: `ADMIN_ACCESS_MODE=${mode}（按来源 IP 放行）与 TRUST_PROXY=${String(setting)} 同时生效：`
      + 'Express 会用客户端可自带的 X-Forwarded-For 覆盖 req.ip，伪造 127.0.0.1 即可穿过白名单。'
      + '请改用显式代理 IP/CIDR 列表，或把管理端限制为 ADMIN_ACCESS_MODE=loopback 且仅本机直连。',
  };
}
