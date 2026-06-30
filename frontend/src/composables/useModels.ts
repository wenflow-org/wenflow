import { ref, onMounted } from 'vue';
import { getAvailableModels, type ModelDefinition, type AvailableModelsResponse } from '@/api/config';

/**
 * 模型列表 Composable
 * 
 * 用于在组件中方便地获取和使用模型列表
 * 统一从后端 API 获取，避免前端硬编码
 */
export function useModels() {
  const models = ref<ModelDefinition[]>([]);
  const chatModels = ref<ModelDefinition[]>([]);
  const reasoningModels = ref<ModelDefinition[]>([]);
  const defaults = ref({ chat: 'deepseek-v4-flash', reasoning: 'deepseek-v4-pro' });
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * 加载模型列表
   */
  const loadModels = async () => {
    loading.value = true;
    error.value = null;
    
    try {
      const res = await getAvailableModels();
      const data = res.data as AvailableModelsResponse;
      
      models.value = data.models;
      chatModels.value = data.byTier.chat;
      reasoningModels.value = data.byTier.reasoning;
      defaults.value = data.defaults;
    } catch (err: any) {
      error.value = err.message || '加载模型列表失败';
      console.error('Failed to load models:', err);
      
      // Fallback: 使用硬编码的默认值（以防 API 失败）
      models.value = [
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'chat', provider: 'deepseek', supportsThinking: true },
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'reasoning', provider: 'deepseek', supportsThinking: true },
        { id: 'deepseek-r1', label: 'DeepSeek R1', tier: 'reasoning', provider: 'deepseek', supportsThinking: true }
      ];
      chatModels.value = models.value.filter(m => m.tier === 'chat');
      reasoningModels.value = models.value.filter(m => m.tier === 'reasoning');
    } finally {
      loading.value = false;
    }
  };

  /**
   * 获取模型的显示标签
   */
  const getModelLabel = (modelId: string): string => {
    const model = models.value.find(m => m.id === modelId);
    return model?.label ?? modelId;
  };

  /**
   * 检查模型是否支持 Thinking Mode
   */
  const supportsThinking = (modelId: string): boolean => {
    const model = models.value.find(m => m.id === modelId);
    return model?.supportsThinking ?? false;
  };

  /**
   * 组件挂载时自动加载
   */
  onMounted(() => {
    loadModels();
  });

  return {
    models,
    chatModels,
    reasoningModels,
    defaults,
    loading,
    error,
    loadModels,
    getModelLabel,
    supportsThinking
  };
}
