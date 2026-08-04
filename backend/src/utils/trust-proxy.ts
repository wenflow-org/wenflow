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
