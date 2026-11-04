/**
 * `POST /admin/infra-models/pull` 的行为契约（P1 2026-11-04）。
 *
 * 为什么要有这条：向量 / 重排卡此前只能手打模型 ID，现在也能「向上游拉一份清单再挑」
 * （用户「它每一个接口都独立的自己去拉就行了」）。这条路由的判据有三处容易做错：
 *  1. 端点是带类型路径的（`…/v1/embeddings`），拉清单前必须回到 base 再补 `/models`；
 *  2. 独立服务允许带草稿连接去拉，但**换了地址后留空密钥不得回退旧密钥**（与接入页同判据）；
 *  3. 上游失败要给可行动的话，不能把 401/超时伪装成「没有模型」。
 *
 * 走真实 express 栈（app.listen(0) + fetch），只把两个服务依赖换成桩。
 */
import express from 'express';
import type { AddressInfo } from 'node:net';

jest.mock('../../../services/embedding', () => ({
  embedTexts: jest.fn(),
  rerankDocuments: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}));

jest.mock('../../../services/embedding/infra-config.service', () => ({
  InfraConfigError: class InfraConfigError extends Error {
    status = 400;
    code = 'invalid';
  },
  getInfraModelsView: jest.fn(),
  loadInfraModelConfig: jest.fn(),
  saveInfraModels: jest.fn(),
}));

jest.mock('../../../services/apiConfig.service', () => ({
  __esModule: true,
  default: { testConnection: jest.fn() },
}));

import router from '../infra-models';
import { loadInfraModelConfig } from '../../../services/embedding/infra-config.service';
import apiConfigService from '../../../services/apiConfig.service';

const loadInfraModelConfigMock = loadInfraModelConfig as jest.Mock;
const testConnectionMock = apiConfigService.testConnection as jest.Mock;

interface PullBody {
  success?: boolean;
  data?: { kind?: string; endpoint?: string; models?: string[] };
  error?: string;
}

function runtimeConfig(endpoint: string, apiKey: string) {
  return {
    embedding: { endpoint, apiKey, connectionMode: 'own', model: 'BAAI/bge-m3' },
    rerank: { endpoint, apiKey, connectionMode: 'own', model: 'BAAI/bge-reranker-v2-m3' },
    required: true,
    source: 'db',
  };
}

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/infra-models', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  loadInfraModelConfigMock.mockReset();
  testConnectionMock.mockReset();
});

async function pull(body: Record<string, unknown>): Promise<{ status: number; body: PullBody }> {
  const res = await fetch(`${base}/api/admin/infra-models/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as PullBody };
}

describe('POST /admin/infra-models/pull', () => {
  it('剥掉类型路径段后拉清单：端点回落到 base，返回上游全量模型', async () => {
    loadInfraModelConfigMock.mockResolvedValue(runtimeConfig('https://gw.example/v1/embeddings', 'saved-key'));
    testConnectionMock.mockResolvedValue({ success: true, models: ['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3'] });

    const { status, body } = await pull({ kind: 'embedding' });

    expect(status).toBe(200);
    // 关键：交给 testConnection 的是 base（它自己按 /v1 约定补 /models），不是 …/embeddings
    expect(testConnectionMock).toHaveBeenCalledWith('https://gw.example/v1', 'saved-key');
    expect(body.data).toMatchObject({ kind: 'embedding', endpoint: 'https://gw.example/v1' });
    expect(body.data?.models).toEqual(['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3']);
  });

  it('独立服务可用草稿连接去拉（还没保存也能拉）', async () => {
    loadInfraModelConfigMock.mockResolvedValue(runtimeConfig('https://old.example/v1/rerank', 'old-key'));
    testConnectionMock.mockResolvedValue({ success: true, models: ['BAAI/bge-reranker-v2-m3'] });

    const { status } = await pull({
      kind: 'rerank',
      endpoint: 'https://new.example/v1/rerank',
      apiKey: 'draft-key',
    });

    expect(status).toBe(200);
    expect(testConnectionMock).toHaveBeenCalledWith('https://new.example/v1', 'draft-key');
  });

  it('换了地址却留空密钥：拒绝，且绝不用旧密钥去敲新端点', async () => {
    loadInfraModelConfigMock.mockResolvedValue(runtimeConfig('https://old.example/v1/embeddings', 'old-key'));

    const { status, body } = await pull({ kind: 'embedding', endpoint: 'https://new.example/v1/embeddings' });

    expect(status).toBe(400);
    expect(String(body.error)).toContain('重新填密钥');
    expect(testConnectionMock).not.toHaveBeenCalled();
  });

  it('地址没换、只带地址不带密钥：沿用已保存的密钥', async () => {
    loadInfraModelConfigMock.mockResolvedValue(runtimeConfig('https://gw.example/v1/embeddings', 'saved-key'));
    testConnectionMock.mockResolvedValue({ success: true, models: ['BAAI/bge-m3'] });

    const { status } = await pull({ kind: 'embedding', endpoint: 'https://gw.example/v1/embeddings' });

    expect(status).toBe(200);
    expect(testConnectionMock).toHaveBeenCalledWith('https://gw.example/v1', 'saved-key');
  });

  it('还没有可用连接：说清先填什么，不打上游', async () => {
    loadInfraModelConfigMock.mockResolvedValue(runtimeConfig('', ''));

    const { status, body } = await pull({ kind: 'embedding' });

    expect(status).toBe(400);
    expect(String(body.error)).toContain('还没有可用连接');
    expect(testConnectionMock).not.toHaveBeenCalled();
  });

  it('上游拉取失败：把原因透传出来，不伪装成「没有模型」', async () => {
    loadInfraModelConfigMock.mockResolvedValue(runtimeConfig('https://gw.example/v1/embeddings', 'k'));
    testConnectionMock.mockResolvedValue({ success: false, error: 'HTTP 401: Unauthorized' });

    const { status, body } = await pull({ kind: 'embedding' });

    expect(status).toBe(400);
    expect(String(body.error)).toContain('401');
  });
});
