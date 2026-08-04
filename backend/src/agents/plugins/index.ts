/**
 * Agent 插件入口
 *
 * 导出所有可用插件并自动注册
 */

import { agentPluginRegistry } from '../plugin-registry';
import { logger } from '../../utils/logger';

// 导入所有插件
import { basicEvaluator } from './basic-evaluator';
import { goalAlignmentChecker } from '../../plugins/goal-alignment-checker';
import { adaptPluginToSkill } from './skill-adapter';

// 插件列表
export const allPlugins = [
  basicEvaluator,
  goalAlignmentChecker
];

/**
 * 注册所有插件
 */
export function registerAllPlugins(): void {
  logger.info('🔄 Registering all agent plugins...');

  for (const plugin of allPlugins) {
    try {
      if (agentPluginRegistry.has(plugin.id)) continue;
      agentPluginRegistry.register(plugin);
    } catch (error: any) {
      logger.error(`Failed to register plugin ${plugin.id}:`, error);
    }
  }

  logger.info(`✅ Registered ${allPlugins.length} plugins`);
}

export async function registerPluginSkills(gateway: {
  registerSkill: (definition: any, handler?: (input: any) => Promise<any>) => Promise<string>;
}): Promise<void> {
  registerAllPlugins();
  await agentPluginRegistry.ready();
  for (const plugin of allPlugins) {
    const { definition, handler } = adaptPluginToSkill(plugin);
    await gateway.registerSkill(definition, handler);
  }
}

export { adaptPluginToSkill } from './skill-adapter';

/**
 * 获取插件注册表
 */
export { agentPluginRegistry };

/**
 * 获取所有可用插件
 */
export function getAllPlugins() {
  return allPlugins;
}
