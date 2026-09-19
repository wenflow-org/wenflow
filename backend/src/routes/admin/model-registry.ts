import { Router } from 'express';
import { getModelRegistryOverview } from '../../services/model-registry.service';

const router = Router();

/**
 * GET /api/admin/model-registry — 模型配置总览（**只读**）
 *
 * 设计：doc/MODEL_GATEWAY_DESIGN.md §4.1/§4.2/§4.5（P2⑤ 方案 B：读模型统一，不做写入口）。
 * 汇总「代码能力注册表 + platform_api_configs 别名覆盖 + 部署冷却」的生效状态：
 * - models：每个模型的能力（思考/推理档）与限额（输出上限、缺省、推理预留、并发）
 * - aliases：别名成员、DB 覆盖声明、默认选中项、requireThinking 下的选中项与降级标记
 * - defaults：平台 defaultModel / defaultReasoningModel 的解析结果与来源（别名/具体）
 * - fallbackChains：降级链
 * - cooldowns：当前处于冷却期的部署（进程内快照）
 * - warnings：配置漂移（未注册模型、别名为空、未被引用、废弃 model 副本）
 *
 * 模型能力的唯一写源仍是 `config/models.config.ts`；本接口不提供写操作。
 */
router.get('/', async (_req, res) => {
  try {
    const data = await getModelRegistryOverview();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
