import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ENVELOPE_PREFIX = 'wfsec:v1:';
const ALGORITHM = 'aes-256-gcm';
const OPAQUE_SECRET_CONTAINERS = new Set(['headers', 'env']);

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

interface Keyring {
  currentKeyId: string;
  keys: Map<string, Buffer>;
}

function decodeBase64Key(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
    ? decoded
    : null;
}

function decodeEnvelopePart(value: string, expectedLength?: number): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new SecretCryptoError('数据库 Secret 密文格式无效');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value
    || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new SecretCryptoError('数据库 Secret 密文格式无效');
  }
  return decoded;
}

export interface SecretKeyringFingerprint {
  exported: false;
  currentKeyId: string | null;
  keys: Array<{ keyId: string; fingerprint: string }>;
}

function loadKeyring(): Keyring | null {
  const serialized = (process.env.SECRET_ENCRYPTION_KEYS || '').trim();
  if (!serialized) return null;

  const keys = new Map<string, Buffer>();
  for (const entry of serialized.split(',')) {
    const separator = entry.indexOf(':');
    if (separator <= 0) {
      throw new SecretCryptoError('SECRET_ENCRYPTION_KEYS 格式无效');
    }
    const keyId = entry.slice(0, separator).trim();
    const encodedKey = entry.slice(separator + 1).trim();
    const key = decodeBase64Key(encodedKey);
    if (!keyId || !key || key.length !== 32) {
      throw new SecretCryptoError('Secret 加密密钥必须是带 ID 的 32 字节 Base64 值');
    }
    if (keys.has(keyId)) {
      throw new SecretCryptoError(`Secret 加密密钥 ID 重复: ${keyId}`);
    }
    keys.set(keyId, key);
  }

  const currentKeyId = (process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID || '').trim();
  if (!currentKeyId || !keys.has(currentKeyId)) {
    throw new SecretCryptoError('SECRET_ENCRYPTION_CURRENT_KEY_ID 未指向有效密钥');
  }
  return { currentKeyId, keys };
}

export function validateSecretEncryptionConfig(required = process.env.NODE_ENV === 'production'): void {
  const keyring = loadKeyring();
  if (required && !keyring) {
    throw new SecretCryptoError('生产环境必须配置 SECRET_ENCRYPTION_KEYS 和 SECRET_ENCRYPTION_CURRENT_KEY_ID');
  }
}

export function getSecretKeyringFingerprint(): SecretKeyringFingerprint {
  const keyring = loadKeyring();
  if (!keyring) return { exported: false, currentKeyId: null, keys: [] };
  return {
    exported: false,
    currentKeyId: keyring.currentKeyId,
    keys: Array.from(keyring.keys.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyId, key]) => ({
        keyId,
        fingerprint: `sha256:${createHash('sha256')
          .update(Buffer.from('wenflow-key-fingerprint-v1\0', 'utf8'))
          .update(key)
          .digest('hex')}`
      }))
  };
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

export function needsSecretMigration(value: string | null | undefined, context?: string): boolean {
  if (!value) return false;
  const keyring = loadKeyring();
  if (!keyring) throw new SecretCryptoError('未配置数据库 Secret 加密密钥');
  if (!isEncryptedSecret(value)) return true;
  if (context) decryptSecret(value, context);
  return value.split(':')[2] !== keyring.currentKeyId;
}

export function reencryptSecret(value: string | null | undefined, context: string): string | null | undefined {
  if (!value || !needsSecretMigration(value, context)) return value;
  const plaintext = decryptSecret(value, context);
  return plaintext ? encryptSecret(plaintext, context) : plaintext;
}

export function encryptSecret(value: string | null | undefined, context: string): string | null | undefined {
  if (value === null || value === undefined || value === '') return value;
  if (!value.trim()) return '';
  if (isEncryptedSecret(value)) {
    decryptSecret(value, context);
    return value;
  }
  const keyring = loadKeyring();
  if (!keyring) {
    throw new SecretCryptoError('未配置数据库 Secret 加密密钥');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyring.keys.get(keyring.currentKeyId)!, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'wfsec',
    'v1',
    keyring.currentKeyId,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url')
  ].join(':');
}

export function decryptSecret(value: string | null | undefined, context: string): string | null | undefined {
  if (value === null || value === undefined || !isEncryptedSecret(value)) return value;
  const parts = value.split(':');
  if (parts.length !== 6) throw new SecretCryptoError('数据库 Secret 密文格式无效');

  const [, , keyId, iv, ciphertext, tag] = parts;
  const keyring = loadKeyring();
  const key = keyring?.keys.get(keyId);
  if (!key) throw new SecretCryptoError(`缺少数据库 Secret 解密密钥: ${keyId}`);

  const ivBuffer = decodeEnvelopePart(iv, 12);
  const ciphertextBuffer = decodeEnvelopePart(ciphertext);
  const tagBuffer = decodeEnvelopePart(tag, 16);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tagBuffer);
    return Buffer.concat([
      decipher.update(ciphertextBuffer),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new SecretCryptoError('数据库 Secret 解密失败');
  }
}

export function encryptSecretTree<T>(value: T, context: string): T {
  return transformSecretTree(value, context, encryptSecret);
}

export function decryptSecretTree<T>(value: T, context: string): T {
  return transformSecretTree(value, context, decryptSecret);
}

export function reencryptSecretTree<T>(value: T, context: string, forceSecretStrings = false): T {
  return transformSecretTree(value, context, reencryptSecret, forceSecretStrings);
}

function transformSecretTree<T>(
  value: T,
  context: string,
  transform: (value: string, context: string) => string | null | undefined,
  forceSecretStrings = false
): T {
  if (typeof value === 'string') {
    return (forceSecretStrings ? transform(value, context) : value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(item => transformSecretTree(item, context, transform, forceSecretStrings)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((forceSecretStrings || isSecretFieldName(key)) && typeof item === 'string') {
      result[key] = transform(item, context);
    } else {
      result[key] = transformSecretTree(
        item,
        context,
        transform,
        forceSecretStrings || OPAQUE_SECRET_CONTAINERS.has(key.toLowerCase())
      );
    }
  }
  return result as T;
}

export function isSecretFieldName(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /^(apikey|apisecret|authorization|proxyauthorization|cookie|password|passphrase|secret|clientsecret|privatekey|secretaccesskey|accesskey|accesskeyid|credential|credentials|signature|token|accesstoken|refreshtoken|idtoken|bearertoken|authtoken|sessiontoken|jwt|xapikey|xauthtoken)$/.test(normalized)
    || /(?:apikey|secret|password|token|credential|signature|accesskey)$/.test(normalized);
}
