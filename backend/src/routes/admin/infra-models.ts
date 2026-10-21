import { Router } from 'express';
import { embedTexts, rerankDocuments, EmbeddingError } from '../../services/embedding';
import {
  InfraConfigError,
  getInfraModelsView,
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

router.post('/test', async (req, res) => {
  const kind = req.body?.kind === 'rerank' ? 'rerank' : 'embedding';
  setAuditAction(res, 'infra-models-test', { targetType: 'infra-models', targetId: kind });
  try {
    if (kind === 'embedding') {
      const result = await embedTexts({ input: ['平台基础设施连通性测试'] }, { timeoutMs: 15_000 });
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
