import { Router } from 'express';
import { embedTexts, rerankDocuments, EmbeddingError } from '../../services/embedding';
import { resolveInfraModelsBaseUrl } from '../../services/embedding/infra-config';
import apiConfigService from '../../services/apiConfig.service';
import {
  InfraConfigError,
  getInfraModelsView,
  loadInfraModelConfig,
  saveInfraModels,
  type InfraModelsUpdateInput,
} from '../../services/embedding/infra-config.service';
import { setAuditAction, setAuditAfter } from '../../middleware/audit-context';

const router = Router();

/**
 * 基础设施模型（embedding / rerank）配置。
 *
 * 2026-10-20 用户拍板：embedding/rerank 是平台必需基础设施，和 LLM 一样走平台配置，
 * 不是插件。配置落 platform_settings.infraModels，密钥落 provider_secrets 密文；
 * 环境变量只作首次部署与回落。
 *
 * 读取是管理端「模型与接入 → 接入与模型 → 基础设施模型」卡的数据源；
 * PUT 只写配置与密钥，不触发流程；POST /test 发一次真实最小请求验证连通性。
 */
router.get('/', async (_req, res) => {
  try {
    res.json({ success: true, data: await getInfraModelsView() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.put('/', async (req, res) => {
  try {
    const body = (req.body ?? {}) as InfraModelsUpdateInput;
    const data = await saveInfraModels(body);
    setAuditAction(res, 'infra-models-update', { targetType: 'infra-models', targetId: 'embedding-rerank' });
    setAuditAfter(res, {
      ...body,
      embedding: body.embedding ? { ...body.embedding, apiKey: body.embedding.apiKey ? '***' : undefined } : undefined,
      rerank: body.rerank ? { ...body.rerank, apiKey: body.rerank.apiKey ? '***' : undefined } : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof InfraConfigError) {
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
      return;
    }
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * 上游模型清单（P1 2026-11-04）：让向量 / 重排卡也能像对话模型一样「拉一份上游清单再挑」，
 * 不必手打模型 ID（用户「它每一个接口都独立的自己去拉就行了」）。
 *
 * 用**已保存**的那条连接去拉：复用时取对话卡的地址与密钥，独立服务时取它自己的配置。
 * 端点从该能力的 endpoint 反推 base——它自己是带类型路径的（`…/v1/embeddings`、`…/v1/rerank`），
 * 剥掉类型段再交给 testConnection（它按 `/v1` 约定补齐 `/models`）。
 * 返回的是上游全量清单，按用途过滤交给界面（role 判据与对话侧同一套）。
 */
router.post('/pull', async (req, res) => {
  const kind = req.body?.kind === 'rerank' ? 'rerank' : 'embedding';
  try {
    const runtime = await loadInfraModelConfig();
    const entry = runtime[kind];
    const savedEndpoint = String(entry.endpoint || '').trim();
    const savedKey = String(entry.apiKey || '').trim();
    /* 独立服务时允许带草稿连接：用户「填地址和 key → 拉取 → 选模型」是自然顺序，
       不该逼他先保存一次再拉。地址没换时留空的密钥沿用已保存的那把；
       地址换了就绝不回退（不能把旧密钥发给一个还没验证过的新端点，与接入页同一判据）。 */
    const draftEndpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    const draftKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const endpoint = draftEndpoint || savedEndpoint;
    const endpointChanged = Boolean(draftEndpoint) && draftEndpoint !== savedEndpoint;
    if (endpointChanged && !draftKey) {
      res.status(400).json({ success: false, error: '换服务地址后需要重新填密钥再拉取。' });
      return;
    }
    const apiKey = draftKey || savedKey;
    if (!endpoint || !apiKey) {
      res.status(400).json({
        success: false,
        error: '这条能力还没有可用连接：先填服务地址与密钥，或切到「复用对话模型的连接」。',
      });
      return;
    }
    // 剥掉类型路径段回到 base（`…/v1/embeddings` → `…/v1`），testConnection 再按约定拼 /models
    const base = resolveInfraModelsBaseUrl(endpoint);
    const result = await apiConfigService.testConnection(base, apiKey);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error || '拉取模型清单失败' });
      return;
    }
    res.json({
      success: true,
      data: {
        kind,
        endpoint: base,
        models: result.models ?? [],
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post('/test', async (req, res) => {
  const kind = req.body?.kind === 'rerank' ? 'rerank' : 'embedding';
  /* 指定模型（2026-11-05 模型池）：一条连接可能挂着好几个模型，
     行内「测试」测的必须是**那一行**的模型，否则 B 行会显示 A 的结果。
     不传仍测当前启用项（连接级调用方保持原语义）。 */
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const modelOverride = requestedModel ? { model: requestedModel } : {};
  setAuditAction(res, 'infra-models-test', { targetType: 'infra-models', targetId: kind });
  try {
    if (kind === 'embedding') {
      const result = await embedTexts(
        { input: ['平台基础设施连通性测试'], ...modelOverride },
        { timeoutMs: 15_000 },
      );
      res.json({
        success: true,
        data: {
          ok: true,
          kind,
          provider: result.provider,
          model: result.model,
          dimensions: result.vectors[0]?.embedding.length ?? 0,
          latencyMs: result.latencyMs,
        },
      });
      return;
    }
    const result = await rerankDocuments(
      {
        query: '学习动机',
        documents: ['自我决定理论认为胜任感、自主性与归属感影响内在动机。', '报名流程与缴费说明。'],
        ...modelOverride,
      },
      { timeoutMs: 15_000 },
    );
    res.json({
      success: true,
      data: {
        ok: true,
        kind,
        provider: result.provider,
        model: result.model,
        results: result.results.length,
        latencyMs: result.latencyMs,
      },
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        ok: false,
        kind,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof EmbeddingError ? { code: error.code } : {}),
      },
    });
  }
});

export default router;
