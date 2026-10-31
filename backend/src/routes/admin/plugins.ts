import { Router } from 'express';
import { PLUGIN_CATALOG, isKnownPluginId, pluginNameOf } from '../../config/plugin-catalog';
import { isPluginConfigId } from '../../config/plugin-providers';
import { getPluginStates, setPluginEnabled } from '../../services/plugin-states.service';
import {
  PluginProviderConfigError,
  getPluginProviderConfig,
  getPluginProviderConfigs,
  savePluginProviderConfig,
} from '../../services/plugin-providers.service';
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

/**
 * 插件的外部服务配置（2026-10-24 用户「联网是配置模型吗」）。
 *
 * 联网 / 决策 / 生图 的「配置」不是 LLM 模型绑定，而是各自 provider 的密钥、入口与模型：
 * 非密钥字段落 platform_settings.pluginProviders，密钥落 provider_secrets 密文。
 * 环境变量只作回落；保存后运行时快照立即刷新。
 */
router.get('/config', async (_req, res) => {
  try {
    res.json({ success: true, data: { plugins: await getPluginProviderConfigs() } });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.put('/config/:pluginId', async (req, res) => {
  const pluginId = String(req.params.pluginId || '');
  if (!isPluginConfigId(pluginId)) {
    res.status(400).json({ success: false, error: `该插件没有服务配置：${pluginId}` });
    return;
  }
  try {
    const view = await savePluginProviderConfig(pluginId, req.body ?? {});
    const providerCount = Object.keys(req.body?.providers || {}).length;
    setAuditAction(res, 'plugin-config-update', { targetType: 'plugin', targetId: pluginId });
    setAuditAfter(res, { pluginId, name: pluginNameOf(pluginId), providers: providerCount });
    res.json({ success: true, data: { plugin: view } });
  } catch (error) {
    if (error instanceof PluginProviderConfigError) {
      res.status(error.status).json({ success: false, error: error.message });
      return;
    }
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
