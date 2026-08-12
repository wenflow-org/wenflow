/**
 * parseOrchestrationFile 的 mtime 解析缓存集成测试
 *
 * - 命中：同一文件二次解析不重复执行 yaml.load（spy 计数），返回同一对象
 * - mtime 变化失效：文件内容变更 → 重新解析且结果反映新内容
 * - 文件删除 → 抛读取失败（不返回陈旧缓存）
 * - clearYamlFileCache → 强制重解析
 *
 * 全部使用临时文件，不触碰真实 prompts/orchestration/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { parseOrchestrationFile } from '../orchestration-file';
import { clearYamlFileCache } from '../../yaml-file-cache';

const MINIMAL_STAGE = `stage: test
displayName: Test
contracts: []
fields: []
routings: []
`;

describe('parseOrchestrationFile mtime 缓存', () => {
  let dir = '';
  let file = '';

  beforeEach(() => {
    clearYamlFileCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-orch-cache-'));
    file = path.join(dir, 'test.yaml');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearYamlFileCache();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('命中：文件未变时二次解析不重复 yaml.load，返回同一对象', () => {
    fs.writeFileSync(file, MINIMAL_STAGE, 'utf-8');
    const loadSpy = jest.spyOn(yaml, 'load');
    const first = parseOrchestrationFile(file);
    const second = parseOrchestrationFile(file);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('mtime 变化后失效：内容变更触发重新解析且结果反映新内容', () => {
    fs.writeFileSync(file, MINIMAL_STAGE, 'utf-8');
    const loadSpy = jest.spyOn(yaml, 'load');
    const first = parseOrchestrationFile(file);
    fs.writeFileSync(
      file,
      MINIMAL_STAGE.replace(
        'fields: []',
        'fields:\n  - fieldId: reply\n    promptRole: public-reply\n    valueType: string\n    description: 回复',
      ),
      'utf-8',
    );
    const second = parseOrchestrationFile(file);
    expect(first.fields).toEqual([]);
    expect(second.fields).toHaveLength(1);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('文件删除后不返回陈旧缓存：抛读取失败', () => {
    fs.writeFileSync(file, MINIMAL_STAGE, 'utf-8');
    parseOrchestrationFile(file);
    fs.rmSync(file);
    expect(() => parseOrchestrationFile(file)).toThrow(/读取失败/);
  });

  it('clearYamlFileCache 强制重新解析', () => {
    fs.writeFileSync(file, MINIMAL_STAGE, 'utf-8');
    const loadSpy = jest.spyOn(yaml, 'load');
    parseOrchestrationFile(file);
    clearYamlFileCache();
    parseOrchestrationFile(file);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
