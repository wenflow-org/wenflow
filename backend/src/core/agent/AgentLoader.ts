/**
 * AgentLoader - Agent 加载器
 * 自动扫描并注册 agents/ 目录下的所有 Agent
 */

import * as fs from 'fs';
import * as path from 'path';
import { ILearningAgent, IAgentRegistration, AgentConstructor } from './ILearningAgent';
import { logger } from '../../utils/logger';

export interface IAgentLoaderConfig {
  /** Agent 目录路径 */
  agentsDir: string;
  /** 是否递归扫描 */
  recursive?: boolean;
  /** 文件过滤模式 */
  filePattern?: RegExp;
  /** 排除的文件夹 */
  excludeDirs?: string[];
}

export class AgentLoader {
  private agents: Map<string, ILearningAgent> = new Map();
  private registrations: Map<string, IAgentRegistration> = new Map();
  private config: Required<IAgentLoaderConfig>;

  constructor(config: IAgentLoaderConfig) {
    this.config = {
      recursive: true,
      filePattern: /Agent\.(ts|js)$/,
      excludeDirs: ['node_modules', '__tests__', 'test'],
      ...config,
    };
  }

  /**
   * 扫描并加载所有 Agent
   */
  async loadAll(): Promise<ILearningAgent[]> {
    const agentFiles = this.scanDirectory(this.config.agentsDir);
    const loadedAgents: ILearningAgent[] = [];

    for (const filePath of agentFiles) {
      try {
        const agent = await this.loadAgent(filePath);
        if (agent) {
          loadedAgents.push(agent);
          logger.info(`[AgentLoader] 加载 Agent: ${agent.id}`);
        }
      } catch (error: any) {
        logger.error(`[AgentLoader] 加载失败 ${filePath}:`, error.message);
      }
    }

    logger.info(`[AgentLoader] 共加载 ${loadedAgents.length} 个 Agent`);
    return loadedAgents;
  }

  /**
   * 加载单个 Agent
   */
  private async loadAgent(filePath: string): Promise<ILearningAgent | null> {
    // 清除 require 缓存（开发环境热重载）
    delete require.cache[require.resolve(filePath)];

    const module = require(filePath);

    // 查找 Agent 类（默认导出或命名导出）
    const AgentClass = module.default || this.findAgentClass(module);

    if (!AgentClass) {
      throw new Error(`未找到 Agent 类导出: ${filePath}`);
    }

    // 实例化
    const agent = new AgentClass();

    // 验证接口
    if (!this.isValidAgent(agent)) {
      throw new Error(`无效的 Agent 实现: ${filePath}`);
    }

    // 初始化
    if (agent.initialize) {
      await agent.initialize();
    }

    // 注册
    this.agents.set(agent.id, agent);
    this.registrations.set(agent.id, {
      id: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      subject: agent.subject,
      capabilities: agent.capabilities,
      constructor: AgentClass,
      filePath,
    });

    return agent;
  }

  /**
   * 扫描目录
   */
  private scanDirectory(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      logger.warn(`[AgentLoader] 目录不存在: ${dir}`);
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // 递归扫描（排除指定目录）
        if (this.config.recursive && !this.config.excludeDirs.includes(entry.name)) {
          files.push(...this.scanDirectory(fullPath));
        }
      } else if (entry.isFile()) {
        // 检查文件匹配模式
        if (this.config.filePattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * 查找 Agent 类
   */
  private findAgentClass(module: any): AgentConstructor | null {
    // 查找第一个以大写字母开头的类
    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (typeof exported === 'function' && /^[A-Z]/.test(key)) {
        return exported;
      }
    }
    return null;
  }

  /**
   * 验证 Agent 实现
   */
  private isValidAgent(agent: any): agent is ILearningAgent {
    const required = ['id', 'name', 'version', 'description', 'subject', 'capabilities', 'run'];
    for (const prop of required) {
      if (!(prop in agent)) {
        logger.error(`[AgentLoader] 缺少必需属性: ${prop}`);
        return false;
      }
    }
    return true;
  }

  /**
   * 获取 Agent
   */
  get(id: string): ILearningAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * 列出所有 Agent
   */
  list(): ILearningAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 按学科查找
   */
  findBySubject(subject: string): ILearningAgent[] {
    return this.list().filter(agent => agent.subject === subject);
  }

  /**
   * 按能力标签查找
   */
  findByCapability(tag: string): ILearningAgent[] {
    return this.list().filter(agent =>
      agent.capabilities.tags.includes(tag)
    );
  }

  /**
   * 获取注册信息
   */
  getRegistration(id: string): IAgentRegistration | undefined {
    return this.registrations.get(id);
  }

  /**
   * 列出所有注册信息
   */
  listRegistrations(): IAgentRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * 卸载 Agent
   */
  async unload(id: string): Promise<boolean> {
    const agent = this.agents.get(id);
    if (!agent) return false;

    if (agent.destroy) {
      await agent.destroy();
    }

    this.agents.delete(id);
    this.registrations.delete(id);

    logger.info(`[AgentLoader] 卸载 Agent: ${id}`);
    return true;
  }

  /**
   * 重载 Agent（热更新）
   */
  async reload(id: string): Promise<ILearningAgent | null> {
    const registration = this.registrations.get(id);
    if (!registration) return null;

    await this.unload(id);
    return this.loadAgent(registration.filePath);
  }
}

// 默认导出单例
export const agentLoader = new AgentLoader({
  agentsDir: path.join(__dirname, '../../agents'),
});
