/**
 * 导出脚本：将代码中的 prompt 常量提取到 prompts/*.md 文件
 * 运行方式: npx ts-node src/scripts/export-prompts-to-files.ts
 */

import fs from 'fs';
import path from 'path';
import { serializePromptFile } from '../composers/prompt-files/loader';

import { 
  PATH_SCENE_FRAMING_PROMPT, 
  PATH_SCENE_FRAMING_MAX_TOKENS, 
  PATH_SCENE_FRAMING_TEMPERATURE 
} from '../skills/path-scene-framing';
import { STAGE_DESIGNER_PROMPT } from '../skills/stage-designer';
import { GOAL_PROFILE_INFERENCE_PROMPT } from '../skills/goal-profile-inference';
import { LEARNING_PATTERN_DISTILLER_PROMPT } from '../skills/learning-pattern-distiller';
import { ADAPTIVE_GUIDANCE_COPY_PROMPT } from '../skills/adaptive-guidance-copy';
import { 
  VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT, 
  VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS, 
  VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE 
} from '../skills/virtual-learner-persona-designer';
import { 
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT, 
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS, 
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE 
} from '../skills/virtual-learner-scenario-designer';
import { 
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT, 
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS, 
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE 
} from '../skills/virtual-learner-goal-dialogue-simulator';
import { 
  VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT, 
  VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS, 
  VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE 
} from '../skills/virtual-learner-path-evaluator';
import { 
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT, 
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS, 
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE 
} from '../skills/virtual-learner-learn-turn-simulator';

const PROMPTS_DIR = path.resolve(__dirname, '../../../prompts');

interface PromptToExport {
  agentId: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  acceptableAgentIds?: string[];
}

const promptsToExport: PromptToExport[] = [
  {
    agentId: 'skill:goal-conversation',
    name: 'default-goal-conversation',
    description: '学习目标澄清与方向收敛助手',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4000,
    acceptableAgentIds: ['skill:goal-conversation', 'goal-conversation'],
  },
  {
    agentId: 'skill:path-planning',
    name: 'default-path-generation',
    description: '学习路径规划 Agent',
    systemPrompt: '',
    temperature: 0.5,
    maxTokens: 32000,
  },
  {
    agentId: 'skill:teaching-turn',
    name: 'default-teaching-turn',
    description: '结构化教学回合生成器',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4000,
  },
  {
    agentId: 'skill:session-wrapup',
    name: 'default-session-wrapup',
    description: '课后总结与评估 Agent',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4000,
  },
  {
    agentId: 'skill:peer-reinforcement',
    name: 'default-peer-reinforcement',
    description: '同伴学习与 Feynman 技巧辅助',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4000,
  },
  {
    agentId: 'skill:path-scene-framing',
    name: 'default-path-scene-framing',
    description: '学习路径输入清洗与场景构建',
    systemPrompt: PATH_SCENE_FRAMING_PROMPT,
    temperature: PATH_SCENE_FRAMING_TEMPERATURE,
    maxTokens: PATH_SCENE_FRAMING_MAX_TOKENS,
  },
  {
    agentId: 'skill:stage-designer',
    name: 'default-stage-designer',
    description: '阶段任务设计器',
    systemPrompt: STAGE_DESIGNER_PROMPT,
    temperature: 0.3,
    maxTokens: 32000,
  },
  {
    agentId: 'skill:goal-profile-inference',
    name: 'default-goal-profile-inference',
    description: '学习者画像推断器',
    systemPrompt: GOAL_PROFILE_INFERENCE_PROMPT,
    temperature: 0.7,
    maxTokens: 2000,
  },
  {
    agentId: 'skill:learning-pattern-distiller',
    name: 'default-learning-pattern-distiller',
    description: '学习模式蒸馏器',
    systemPrompt: LEARNING_PATTERN_DISTILLER_PROMPT,
    temperature: 0.5,
    maxTokens: 3000,
  },
  {
    agentId: 'skill:adaptive-guidance-copy',
    name: 'default-adaptive-guidance-copy',
    description: '动态引导文案生成器',
    systemPrompt: ADAPTIVE_GUIDANCE_COPY_PROMPT,
    temperature: 0.6,
    maxTokens: 2000,
  },
  {
    agentId: 'skill:virtual-learner-persona-designer',
    name: 'default-virtual-learner-persona-designer',
    description: '虚拟学习者身份设计师',
    systemPrompt: VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
    temperature: VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-scenario-designer',
    name: 'default-virtual-learner-scenario-designer',
    description: '虚拟学习者实验样本设计师',
    systemPrompt: VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
    temperature: VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-goal-dialogue-simulator',
    name: 'default-virtual-learner-goal-dialogue-simulator',
    description: 'Goal 阶段虚拟学习者对话模拟器',
    systemPrompt: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
    temperature: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-path-evaluator',
    name: 'default-virtual-learner-path-evaluator',
    description: '虚拟学习者 Path 评估器',
    systemPrompt: VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
    temperature: VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-learn-turn-simulator',
    name: 'default-virtual-learner-learn-turn-simulator',
    description: 'Learn 阶段虚拟学习者回合模拟器',
    systemPrompt: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
    temperature: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
  },
];

async function exportPrompts() {
  console.log('开始导出 prompts 到文件...');
  console.log(`目标目录: ${PROMPTS_DIR}`);

  // 确保目录存在
  if (!fs.existsSync(PROMPTS_DIR)) {
    fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    console.log(`✅ 创建目录: ${PROMPTS_DIR}`);
  }

  let created = 0;
  let skipped = 0;

  for (const prompt of promptsToExport) {
    const fileBase = prompt.agentId.replace(/:/g, '.');
    const filePath = path.join(PROMPTS_DIR, `${fileBase}.md`);

    // 检查文件是否已存在
    if (fs.existsSync(filePath)) {
      console.log(`⏭️  跳过（已存在）: ${fileBase}.md`);
      skipped++;
      continue;
    }

    // 序列化为 markdown
    const content = serializePromptFile({
      agentId: prompt.agentId,
      name: prompt.name,
      description: prompt.description,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
      acceptableAgentIds: prompt.acceptableAgentIds,
      systemPrompt: prompt.systemPrompt,
    });

    // 写入文件
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✅ 已创建: ${fileBase}.md (${Math.round(content.length / 1024)}KB)`);
    created++;
  }

  console.log('');
  console.log('导出完成！');
  console.log(`- 创建: ${created} 个文件`);
  console.log(`- 跳过: ${skipped} 个文件`);
  console.log('');
  console.log('下一步：');
  console.log('1. 检查生成的文件内容');
  console.log('2. git add prompts/ && git commit -m "feat: migrate prompts to file-based system"');
  console.log('3. npm run prompts:sync  (同步到数据库)');
}

exportPrompts().catch((error) => {
  console.error('导出失败:', error);
  process.exit(1);
});
