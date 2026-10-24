import { Router } from 'express';
import { PLUGIN_CATALOG, isKnownPluginId, pluginNameOf } from '../../config/plugin-catalog';
import { getPluginStates, setPluginEnabled } from '../../services/plugin-states.service';
import { setAuditAction, setAuditAfter } from '../../middleware/audit-context';

const router = Router();

/**
 * 插件启停（2026-10-24 用户「插件就是配置启用」）。
 *
 * 读：返回分组目录 + 当前启停（缺省全启用）。
 * 写：只写 platform_settings.pluginStates；运行时由 executeSkill 统一拦截停用插件的能力调用，
 *     调用方按各能力的失败策略继续（见 capabilityCatalog 的 fallback 文案）。
 */
router.get('/', async (_req, res) => {
  try {
    res.json({
      success: true,
      data: {
        states: await getPluginStates(),
        groups: PLUGIN_CATALOG.map((g) => ({ id: g.id, name: g.name, skills: g.skills })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.put('/:pluginId', async (req, res) => {
  const pluginId = String(req.params.pluginId || '');
  if (!isKnownPluginId(pluginId)) {
    res.status(400).json({ success: false, error: `未知插件：${pluginId}` });
    return;
  }
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ success: false, error: 'enabled 必须是布尔值' });
    return;
  }
  try {
    const states = await setPluginEnabled(pluginId, req.body.enabled);
    setAuditAction(res, 'plugin-toggle', { targetType: 'plugin', targetId: pluginId });
    setAuditAfter(res, { pluginId, name: pluginNameOf(pluginId), enabled: req.body.enabled, states });
    res.json({ success: true, data: { states } });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
