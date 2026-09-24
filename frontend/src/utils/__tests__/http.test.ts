/**
 * utils/http.ts 统一客户端工厂单测（审计 #7 拦截器合并的共享核心）：
 * 成功解包画像、错误信封归一化（对象/字符串/兜底）、取消归一化、
 * 401 画像策略（豁免端点、_retry 防循环、重试接管、无策略回落）。
 * 用自定义 adapter 直驱真实 axios 拦截器链，不起网络。
 */
import { describe, expect, it, vi } from 'vitest';
import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { createApiClient } from '../http';

function makeResponse(config: AxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  return { data, status, statusText: String(status), headers: {}, config: config as never };
}

/** 构建带自定义 adapter 的客户端：handler 按调用序返回固定响应，或 reject 出带 response 的错误对象 */
function clientWith(
  profile: Parameters<typeof createApiClient>[0],
  responses: Array<{ status: number; data?: unknown; reject?: boolean }>
) {
  const calls: AxiosRequestConfig[] = [];
  const client = createApiClient(profile);
  client.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const idx = calls.length;
    calls.push(config);
    const scripted = responses[Math.min(idx, responses.length - 1)];
    const resp = makeResponse(config, scripted.status, scripted.data ?? {});
    if (scripted.reject || scripted.status >= 400) {
      return Promise.reject({ response: resp, config, isAxiosError: true });
    }
    return resp;
  };
  return { client, calls };
}

describe('createApiClient 工厂', () => {
  it('unwrapResponse=true 解包 response.data（user 侧契约）；缺省原样返回（admin 侧契约）', async () => {
    const unwrapped = clientWith({ timeout: 1000, unwrapResponse: true }, [{ status: 200, data: { hello: 1 } }]);
    await expect(unwrapped.client.get('/x')).resolves.toEqual({ hello: 1 });

    const raw = clientWith({ timeout: 1000 }, [{ status: 200, data: { hello: 1 } }]);
    const res = await raw.client.get('/x');
    expect(res.status).toBe(200);
    expect((res as AxiosResponse).data).toEqual({ hello: 1 });
  });

  it('错误信封归一化：{error:{message,details}} 对象形态', async () => {
    const { client } = clientWith({ timeout: 1000 }, [{ status: 500, data: { error: { message: '后端炸了', details: { code: 7 } } } }]);
    const err = await client.get('/x').catch((e: unknown) => e) as { message?: string; status?: number; details?: unknown; response?: { status: number } };
    expect(err.message).toBe('后端炸了');
    expect(err.status).toBe(500);
    expect(err.details).toEqual({ code: 7 });
    expect(err.response?.status).toBe(500);
  });

  it('错误信封归一化：{error:"字符串"} 历史端点形态与兜底文案', async () => {
    const legacy = clientWith({ timeout: 1000 }, [{ status: 422, data: { error: '旧的字符串错误' } }]);
    await expect(legacy.client.get('/x')).rejects.toMatchObject({ message: '旧的字符串错误', status: 422 });

    const fallback = clientWith({ timeout: 1000 }, [{ status: 502, data: {} }]);
    await expect(fallback.client.get('/x')).rejects.toMatchObject({ message: '请求失败', status: 502 });
  });

  it('取消（AbortError/CanceledError）归一化为 cancelled 标记', async () => {
    const { client } = clientWith({ timeout: 1000 }, []);
    client.defaults.adapter = async (config: InternalAxiosRequestConfig) =>
      Promise.reject(Object.assign(new Error('canceled'), { name: 'CanceledError', config }));
    await expect(client.get('/x')).rejects.toMatchObject({ message: '请求已取消', cancelled: true });
  });

  it('401：handleUnauthorized 返回重试 response 则以它继续（user 静默刷新语义）', async () => {
    let clientRef: ReturnType<typeof createApiClient> | null = null;
    const handler = vi.fn(async (error: { config?: AxiosRequestConfig }) => {
      const retryConfig = { ...(error.config ?? {}), _retry: true } as AxiosRequestConfig;
      return clientRef!.request(retryConfig);
    });
    const { client, calls } = clientWith(
      { timeout: 1000, unwrapResponse: true, handleUnauthorized: handler },
      [{ status: 401, data: {} }, { status: 200, data: { ok: true } }]
    );
    clientRef = client;
    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect((calls[1] as { _retry?: boolean })._retry).toBe(true);
  });

  it('401：isAuthEndpoint 豁免端点不触发策略，直接归一化拒绝（凭证错误语义）', async () => {
    const handler = vi.fn();
    const { client } = clientWith(
      { timeout: 1000, isAuthEndpoint: (url) => url.includes('/login'), handleUnauthorized: handler },
      [{ status: 401, data: { error: { message: '用户名或密码错误' } } }]
    );
    await expect(client.get('/auth/login')).rejects.toMatchObject({ status: 401, message: '用户名或密码错误' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('401：_retry 过的请求不再触发策略（防刷新循环）', async () => {
    const handler = vi.fn();
    const { client } = clientWith({ timeout: 1000, handleUnauthorized: handler }, [{ status: 401, data: {} }]);
    await expect(client.get('/x', { _retry: true } as never)).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('401：无策略画像（admin 守卫放行场景）落到统一归一化拒绝', async () => {
    const { client } = clientWith({ timeout: 1000 }, [{ status: 401, data: { error: { message: '未授权' } } }]);
    await expect(client.get('/x')).rejects.toMatchObject({ status: 401, message: '未授权' });
  });

  it('injectHeaders 画像在请求链生效（user 侧 Token 注入）', async () => {
    const { client, calls } = clientWith(
      {
        timeout: 1000,
        injectHeaders: (config) => {
          config.headers.Authorization = 'Bearer t1';
          return config;
        },
      },
      [{ status: 200, data: {} }]
    );
    await client.get('/x');
    expect((calls[0].headers as Record<string, unknown>).Authorization).toBe('Bearer t1');
  });

  it('FormData 上传：默认 application/json 头被移除且 data 保持 FormData（不被 formDataToJSON 转成 JSON 体）', async () => {
    // 回归锚点（2026-09-24）：实例默认 Content-Type: application/json 会让 axios transformRequest
    // 把 FormData 序列化成 JSON 字符串，后端 multer 收不到文件字段（goal 页资料上传报「没有收到文件」）。
    const { client, calls } = clientWith({ timeout: 1000 }, [{ status: 200, data: { success: true } }]);
    const form = new FormData();
    form.append('file', new Blob(['doc-content'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '指南.docx');

    await client.post('/materials', form);

    const sent = calls[0];
    expect(sent.data).toBeInstanceOf(FormData);
    const headers = sent.headers as unknown as { getContentType?: () => unknown };
    const rawType = typeof headers?.getContentType === 'function'
      ? headers.getContentType()
      : (sent.headers as Record<string, unknown>)['Content-Type'];
    // 清除后 AxiosHeaders 侧可能返回 false/null/undefined，统一按「非 JSON」判定
    const contentType = rawType == null || typeof rawType !== 'string' ? '' : rawType.toLowerCase();
    expect(contentType).not.toContain('application/json');
  });
});
