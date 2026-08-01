import { getRequestContext } from '../../gateway/api-gateway/context';
import { SkillDefinition } from '../../skills/protocol';
import { agentPluginRegistry } from '../plugin-registry';
import { AgentPlugin } from '../plugin-types';

interface PluginExecutionEnvelope {
  pluginInput: any;
  pluginContext?: {
    userId?: string;
    sessionId?: string;
    taskId?: string;
    metadata?: Record<string, any>;
  };
}

const categoryByPluginType: Record<AgentPlugin['type'], SkillDefinition['category']> = {
  'requirement-extractor': 'analysis',
  'path-planner': 'generation',
  'content-generator': 'generation',
  'quality-evaluator': 'analysis',
  'tutor': 'generation',
};

function isPluginExecutionEnvelope(value: any): value is PluginExecutionEnvelope {
  return !!value
    && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, 'pluginInput');
}

export function adaptPluginToSkill(plugin: AgentPlugin): {
  definition: SkillDefinition;
  handler: (input: any) => Promise<any>;
} {
  return {
    definition: {
      name: plugin.id,
      displayName: plugin.name,
      version: plugin.version,
      status: 'working',
      category: categoryByPluginType[plugin.type],
      description: plugin.description,
      capabilities: plugin.capabilities,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      stats: { callCount: 0, successRate: 1, avgLatency: 0 },
    },
    handler: async (request: any) => {
      const envelope = isPluginExecutionEnvelope(request)
        ? request
        : { pluginInput: request, pluginContext: undefined };
      const requestContext = getRequestContext();

      return agentPluginRegistry.execute(plugin.id, envelope.pluginInput, {
        userId: requestContext.userId,
        sessionId: envelope.pluginContext?.sessionId,
        sourceEntry: requestContext.sourceEntry,
        metadata: {
          ...envelope.pluginContext?.metadata,
          taskId: envelope.pluginContext?.taskId,
        },
      });
    },
  };
}
