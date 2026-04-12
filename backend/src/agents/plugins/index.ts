/**
 * Agent 插件入口
 *
 * 导出所有可用插件并自动注册
 */

import { agentPluginRegistry } from '../plugin-registry';
import { logger } from '../../utils/logger';

// 导入所有插件
import { genericPlanner } from '../path-planner/plugins/generic-planner';
import { basicGenerator } from '../content-generator/plugins/basic-generator';
import { basicExtractor } from './basic-extractor';
import { basicEvaluator } from './basic-evaluator';
import { dataMappingAgent } from './data-mapping';
import { goalAlignmentChecker } from '../../plugins/goal-alignment-checker';
import { confidenceHandler } from '../../plugins/confidence-handler';

// 插件列表
export const allPlugins = [
  genericPlanner,
  basicGenerator,
  basicExtractor,
  basicEvaluator,
  dataMappingAgent,
  goalAlignmentChecker,
  confidenceHandler
];

/**
 * 注册所有插件
 */
export function registerAllPlugins(): void {
  logger.info('🔄 Registering all agent plugins...');

  for (const plugin of allPlugins) {
    try {
      agentPluginRegistry.register(plugin);
    } catch (error: any) {
      logger.error(`Failed to register plugin ${plugin.id}:`, error);
    }
  }

  logger.info(`✅ Registered ${allPlugins.length} plugins`);
}

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
