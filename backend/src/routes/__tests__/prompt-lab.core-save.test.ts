/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内省 express router/mock 形状（对齐同目录既有豁免先例） */
/**
 * #9 回归：Skill 设计页「保存并编译」在无任何编辑时不得重排 core/*.yaml。
 *
 * 表单模式（mode=form）此前无条件 serializeCoreFile 整篇重写，导致：
 *   identity: | → |-、channels 流转块列表、ref/desc 键序对调、去引号……
 * 现改为：表单载荷与磁盘现有 core 语义等价时沿用磁盘原文本；
 * 有真实编辑时序列化，但沿用原文件 EOL（#11）。
 *
 * 通过 jest.isolateModules 在设置 CORE_FILES_DIR / PROMPTS_DIR 等后动态装载路由
 * （目录常量在模块装载时固化），避免触碰真实 prompts/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: { findFirst: async () => null, findMany: async () => [] },
    agent_contracts: { findMany: async () => [] },
    field_definitions: { findMany: async () => [] },
    agent_field_routings: { findMany: async () => [] },
    node_config_changes: { create: async (args: any) => ({ id: 'audit-1', ...args.data }) },
  },
}));

jest.mock('../../services/field-dispatcher', () => ({
  clearRoutingCache: jest.fn(),
  getAgentRoutings: jest.fn(async () => []),
}));

jest.mock('../../services/prompt-composer', () => ({ clearSupplementRenderCache: jest.fn() }));

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: jest.fn(() => ({ invalidateCache: jest.fn() })),
}));

jest.mock('../../services/cache/prompt-cache.service', () => ({
  promptCache: { clearAgentCache: jest.fn() },
}));

// 非 canonical 排版：flow 列表 / 块标量 / 无引号 type —— 序列化器会整体重排
const FIXTURE_CORE = [
  '# demo core（fixture）',
  'skillId: demo-skill',
  'baseVersion: 1',
  'identity: 演示身份',
  'channels: [dialogue, state]',
  'stateAdvance: false',
  'rules:',
  '  - 规则一',
  'fields:',
  '  - name: reply',
  '    type: string',
  '    desc: 回复',
  'constraints: []',
  'params: { temperature: 0.5, maxTokens: 100, failurePolicy: retry }',
  'deltaOutput: false',
  'outputMedia: json',
  '',
].join('\n');

const EQUAL_PAYLOAD = {
  identity: '演示身份',
  channels: ['dialogue', 'state'],
  stateAdvance: false,
  deltaOutput: false,
  outputMedia: 'json',
  rules: ['规则一'],
  constraints: [],
  fields: [{ name: 'reply', type: 'string', desc: '回复', turn: false }],
  params: { temperature: 0.5, maxTokens: 100, failurePolicy: 'retry' },
};

let tempRoot = '';
let coreDir = '';
let coreFile = '';
let router: any;

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-core-save-'));
  coreDir = path.join(tempRoot, 'core');
  const orchestrationDir = path.join(tempRoot, 'orchestration');
  const promptsDir = path.join(tempRoot, 'prompts');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(orchestrationDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });
  coreFile = path.join(coreDir, 'demo-skill.yaml');
  fs.writeFileSync(coreFile, FIXTURE_CORE, 'utf-8');
  // 编排目录不可为空：field-routing-bootstrap 在模块装载时即 loadOrchestrationFiles
  fs.writeFileSync(
    path.join(orchestrationDir, 'demo.yaml'),
    ['# test orchestration', 'stage: demo', 'displayName: Demo', 'contracts:', '  - agentId: skill:demo-skill', 'fields: []', 'routings: []', ''].join('\n'),
    'utf-8',
  );

  process.env.CORE_FILES_DIR = coreDir;
  process.env.ORCHESTRATION_DIR = orchestrationDir;
  process.env.PROMPTS_DIR = promptsDir;

  jest.isolateModules(() => {
    router = require('../prompt-lab').default;
  });
});

afterAll(() => {
  delete process.env.CORE_FILES_DIR;
  delete process.env.ORCHESTRATION_DIR;
  delete process.env.PROMPTS_DIR;
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  fs.writeFileSync(coreFile, FIXTURE_CORE, 'utf-8');
});

function getRouteHandler(p: string, method: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === p && item.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

async function putForm(core: Record<string, unknown>) {
  const handler = getRouteHandler('/core/:skillId', 'put');
  const res = createResponse();
  await handler({ params: { skillId: 'demo-skill' }, body: { mode: 'form', core }, user: { userId: 'u1' } }, res);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

describe('PUT /core/:skillId（表单模式·无编辑保存守卫 #9）', () => {
  it('载荷与磁盘 core 语义等价 → 文件逐字节不变（不重排）', async () => {
    const { res, body } = await putForm(EQUAL_PAYLOAD);
    expect(res.status).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.status).toBe('pending-compile');
    expect(fs.readFileSync(coreFile, 'utf-8')).toBe(FIXTURE_CORE);
  });

  it('真实编辑 → 序列化写盘，且保留原文件 EOL（#11）', async () => {
    // 先写 CRLF 版本，模拟 Windows 检出
    const crlf = FIXTURE_CORE.replace(/\n/g, '\r\n');
    fs.writeFileSync(coreFile, crlf, 'utf-8');

    const { body } = await putForm({ ...EQUAL_PAYLOAD, identity: '新身份' });
    expect(body.success).toBe(true);

    const out = fs.readFileSync(coreFile, 'utf-8');
    expect(out).toContain('新身份');
    expect(out).not.toBe(crlf);
    // 仍是 CRLF：去掉所有 CRLF 后不应再有裸 LF
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
