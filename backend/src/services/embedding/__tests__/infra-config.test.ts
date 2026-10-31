/**
 * 基础设施模型配置纯函数测试（不触网、不读库）。
 *
 * 关注三件事：
 * 1. 环境变量只作为默认/回落，平台配置可逐字段覆盖；
 * 2. 非法配置在保存前被拦下（地址/模型/超时/批量/环境变量名）；
 * 3. rerank 没有批量概念，任何输入都收敛为 null。
 */
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_INFRA_TIMEOUT_MS,
  defaultInfraModelsConfig,
  mergeInfraModelsConfig,
  resolveInfraEndpoint,
  validateInfraModelsConfig,
} from '../infra-config';

const ENV = {
  EMBEDDING_API_URL: 'https://gw.example/v1/embeddings',
  EMBEDDING_API_KEY: 'test-key',
  EMBEDDING_MODEL: 'BAAI/bge-m3',
  EMBEDDING_TIMEOUT_MS: '15000',
  EMBEDDING_BATCH_SIZE: '16',
  RERANK_API_URL: 'https://gw.example/v1/rerank',
  RERANK_MODEL: 'BAAI/bge-reranker-v2-m3',
} as NodeJS.ProcessEnv;

describe('infra-config 默认值与合并', () => {
  it('未落库时按环境变量生成默认配置，required 默认 true', () => {
    const config = defaultInfraModelsConfig(ENV);
    expect(config.embedding.endpoint).toBe('https://gw.example/v1/embeddings');
    expect(config.embedding.model).toBe('BAAI/bge-m3');
    expect(config.embedding.timeoutMs).toBe(15000);
    expect(config.embedding.batchSize).toBe(16);
    expect(config.rerank.endpoint).toBe('https://gw.example/v1/rerank');
    expect(config.rerank.model).toBe('BAAI/bge-reranker-v2-m3');
    expect(config.rerank.batchSize).toBeNull();
    expect(config.required).toBe(true);
  });

  it('缺省超时/批量回落到平台默认值', () => {
    const config = defaultInfraModelsConfig({} as NodeJS.ProcessEnv);
    expect(config.embedding.timeoutMs).toBe(DEFAULT_INFRA_TIMEOUT_MS);
    expect(config.embedding.batchSize).toBe(DEFAULT_EMBEDDING_BATCH_SIZE);
  });

  it('平台配置只覆盖显式字段，空串/非法数字回落默认', () => {
    const base = defaultInfraModelsConfig(ENV);
    const merged = mergeInfraModelsConfig(base, {
      embedding: { endpoint: 'https://platform.example/v1/embeddings', model: '', timeoutMs: 0, batchSize: 64 },
      rerank: { model: 'BAAI/bge-reranker-v3', batchSize: 8 },
      required: true,
    });
    expect(merged.embedding.endpoint).toBe('https://platform.example/v1/embeddings');
    expect(merged.embedding.model).toBe('BAAI/bge-m3');
    expect(merged.embedding.timeoutMs).toBe(15000);
    expect(merged.embedding.batchSize).toBe(64);
    expect(merged.rerank.model).toBe('BAAI/bge-reranker-v3');
    expect(merged.rerank.batchSize).toBeNull();
  });
});

describe('infra-config 校验', () => {
  it('合法配置返回空错误数组', () => {
    expect(validateInfraModelsConfig(defaultInfraModelsConfig(ENV))).toEqual([]);
  });

  it('拦下非 http(s) 地址、空模型、越界超时、越界批量与非法环境变量名', () => {
    const config = defaultInfraModelsConfig(ENV);
    config.embedding.endpoint = 'ftp://gw.example/v1/embeddings';
    config.embedding.model = '';
    config.embedding.timeoutMs = 500;
    config.embedding.batchSize = 999;
    config.embedding.apiKeyEnv = 'BAD-ENV';
    const errors = validateInfraModelsConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.join('\n')).toContain('http:// 或 https://');
    expect(errors.join('\n')).toContain('模型 id 不能为空');
    expect(errors.join('\n')).toContain('超时');
    expect(errors.join('\n')).toContain('批量大小');
    expect(errors.join('\n')).toContain('密钥环境变量名');
  });

  it('允许只配置其中一个：另一个地址为空 = 未配置，不再拦截首配', () => {
    const config = defaultInfraModelsConfig({} as NodeJS.ProcessEnv)
    config.embedding.endpoint = 'https://gw.example/v1/embeddings'
    config.rerank.endpoint = ''
    expect(validateInfraModelsConfig(config)).toEqual([])

    // 反过来只配重排同样合法
    config.embedding.endpoint = ''
    config.rerank.endpoint = 'https://gw.example/v1/rerank'
    expect(validateInfraModelsConfig(config)).toEqual([])
  })

  it('维度为空允许，非整数或越界拒绝', () => {
    const config = defaultInfraModelsConfig(ENV);
    config.embedding.dimensions = 1024;
    expect(validateInfraModelsConfig(config)).toEqual([]);
    config.embedding.dimensions = -1;
    expect(validateInfraModelsConfig(config).join('\n')).toContain('向量维度');
  });

  it('inherit 模式不要求服务地址与环境变量名', () => {
    const config = defaultInfraModelsConfig({} as NodeJS.ProcessEnv);
    config.embedding.connectionMode = 'inherit';
    config.embedding.endpoint = '';
    expect(validateInfraModelsConfig(config)).toEqual([]);
  });
});

describe('resolveInfraEndpoint', () => {
  it('裸域名补 /v1 与类型路径', () => {
    expect(resolveInfraEndpoint('https://gw.example', 'embedding'))
      .toBe('https://gw.example/v1/embeddings');
    expect(resolveInfraEndpoint('https://gw.example/', 'rerank'))
      .toBe('https://gw.example/v1/rerank');
  });

  it('已带 /v1 时只补类型路径', () => {
    expect(resolveInfraEndpoint('https://gw.example/v1', 'embedding'))
      .toBe('https://gw.example/v1/embeddings');
    expect(resolveInfraEndpoint('https://gw.example/v1/', 'rerank'))
      .toBe('https://gw.example/v1/rerank');
  });

  it('空地址返回空串', () => {
    expect(resolveInfraEndpoint('', 'embedding')).toBe('');
  });
});
