/**
 * Prompt Source Fields — 字段表与 source ```json``` 块的双向绑定工具
 * ============================================================
 *
 * 设计原则:
 *   - prompts/skill.*.md 是唯一真相 (File-as-Truth)
 *   - 字段表只是 ```json``` 块的 GUI 表征 — 在 prompt 源里读取/写回
 *   - 不引入第三方 source-of-truth 表
 *
 * 两个核心函数:
 *   extractFieldsFromSource(source, section)   — 从源抽字段表 (供 GUI 渲染)
 *   serializeFieldsToSource(source, section, fields) — 把字段表写回源 (保留 prose, 仅替换 ```json``` 块)
 *
 * 字段表结构 (EditableField):
 *   path:       string         — 'understanding.surface_goal' / 'reply' / 'items[].name'
 *   valueType:  'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object'
 *   enumValues: string[] | null — valueType='enum' 时的可选值
 *   note:       string          — 字段说明 (LLM 看到的占位文本)
 *   required:   boolean         — 仅作 GUI 标注, 不影响 json 序列化 (LLM 看 note)
 */

import { parsePromptSchema, type PromptBlock, type WfField } from '../prompt-schema';

export type FieldValueType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';

export interface EditableField {
  path: string;
  valueType: FieldValueType;
  enumValues?: string[] | null;
  note: string;
  required?: boolean;
}

/**
 * 把 WfField 的字段类型 (含 enum(...) 复合类型) 归一为 EditableField.valueType
 */
function normalizeValueType(raw: string | null | undefined): {
  valueType: FieldValueType;
  enumValues: string[] | null;
} {
  if (!raw) return { valueType: 'string', enumValues: null };
  const t = raw.trim().toLowerCase();
  if (t.startsWith('enum(')) {
    const inner = raw.replace(/^enum\(/i, '').replace(/\)$/, '');
    return { valueType: 'enum', enumValues: inner.split('|').map((s) => s.trim()) };
  }
  if (t === 'number') return { valueType: 'number', enumValues: null };
  if (t === 'boolean') return { valueType: 'boolean', enumValues: null };
  if (t === 'array') return { valueType: 'array', enumValues: null };
  if (t === 'object') return { valueType: 'object', enumValues: null };
  return { valueType: 'string', enumValues: null };
}

/**
 * 从一个 prompt source 抽取指定段 (input | output) 的可编辑字段表.
 */
export function extractFieldsFromSource(
  source: string,
  section: 'input' | 'output'
): EditableField[] {
  const schema = parsePromptSchema(source);
  const fields: WfField[] = section === 'input' ? schema.inputFields : schema.outputFields;
  return fields.map((f) => {
    const { valueType, enumValues } = normalizeValueType(f.valueType);
    return {
      path: f.path,
      valueType,
      enumValues,
      note: f.note || '',
      required: false, // 当前 schema 不存 required, GUI 自己维护
    };
  });
}

/**
 * 把 EditableField[] 序列化为一个 ```json``` 块 (字符串, 含 fence).
 *
 * 算法: 递归把扁平 path 重建为嵌套对象, 每个叶子写占位说明 (注意保留 note).
 *
 * 例:
 *   [
 *     { path: 'reply', valueType: 'string', note: '回复' },
 *     { path: 'understanding.surface_goal', valueType: 'string', note: '表面目标' },
 *     { path: 'state.stage', valueType: 'enum', enumValues: ['a','b'], note: '阶段' }
 *   ]
 *   →
 *   {
 *     "reply": "string — 回复",
 *     "understanding": {
 *       "surface_goal": "string — 表面目标"
 *     },
 *     "state": {
 *       "stage": "a|b"
 *     }
 *   }
 */
export function fieldsToJsonObject(fields: EditableField[]): any {
  const root: any = {};
  for (const f of fields) {
    setPath(root, f.path, fieldPlaceholder(f));
  }
  return root;
}

function fieldPlaceholder(f: EditableField): any {
  if (f.valueType === 'enum' && f.enumValues && f.enumValues.length > 0) {
    return f.enumValues.join('|');
  }
  if (f.valueType === 'boolean') return false;
  if (f.valueType === 'number') return 0;
  const noteStr = f.note ? ` — ${f.note}` : '';
  return `${f.valueType}${noteStr}`;
}

function setPath(root: any, path: string, value: any): void {
  const segs = path.split('.');
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    let seg = segs[i];
    const isArr = seg.endsWith('[]');
    if (isArr) seg = seg.slice(0, -2);
    const last = i === segs.length - 1;

    if (last) {
      if (isArr) {
        if (!Array.isArray(cur[seg])) cur[seg] = [];
        if (cur[seg].length === 0) cur[seg].push(value);
        else cur[seg][0] = value;
      } else {
        cur[seg] = value;
      }
    } else {
      if (isArr) {
        if (!Array.isArray(cur[seg])) cur[seg] = [{}];
        if (cur[seg].length === 0) cur[seg].push({});
        cur = cur[seg][0];
      } else {
        if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) {
          cur[seg] = {};
        }
        cur = cur[seg];
      }
    }
  }
}

/**
 * 把字段表写回 prompt 源 — 仅替换指定段内的第一个 ```json``` 块, 其它 prose 一字不动.
 *
 * @param source 原 prompt 文本
 * @param section 'input' | 'output'
 * @param fields 新字段表
 * @returns 修改后的源文本
 */
export function serializeFieldsToSource(
  source: string,
  section: 'input' | 'output',
  fields: EditableField[]
): { source: string; rewritten: boolean; error?: string } {
  const schema = parsePromptSchema(source);
  const targetBlock = schema.blocks.find((b) => b.section === section);
  if (!targetBlock) {
    return {
      source,
      rewritten: false,
      error: `源中未找到 ${section === 'input' ? '## 输入说明' : '## 输出规格'} 段`,
    };
  }

  // 构造新 json 文本
  const jsonObj = fieldsToJsonObject(fields);
  const jsonText = JSON.stringify(jsonObj, null, 2);
  const newJsonBlock = '```json\n' + jsonText + '\n```';

  // 用区域内的旧 ```json``` 块定位并替换
  const fenceRe = /```json\s*\n[\s\S]*?```/;
  if (fenceRe.test(targetBlock.body)) {
    targetBlock.body = targetBlock.body.replace(fenceRe, newJsonBlock);
  } else {
    // 兜底: 没有 json 块, 在段首加一个 (跟在 H2 标题后)
    targetBlock.body = newJsonBlock + '\n\n' + targetBlock.body;
  }

  // 用 block 在 source 的位置定位并替换该段 body
  // 找到该段的标题行, 再找下一个 H2 标题或文件末
  const heading = section === 'input' ? '## 输入说明' : '## 输出规格';
  const aliasHeadings =
    section === 'input'
      ? ['## 输入说明', '## 输入约定']
      : ['## 输出规格', '## 输出格式', '## 输出说明', '## 返回格式'];

  let headingIdx = -1;
  for (const h of aliasHeadings) {
    headingIdx = source.indexOf(h);
    if (headingIdx >= 0) break;
  }
  if (headingIdx < 0) {
    return { source, rewritten: false, error: `源中未找到 ${heading} 标题` };
  }

  // 找到下一个 H2 标题位置 (或文件末)
  const afterHeading = source.slice(headingIdx);
  const nextH2Match = afterHeading.slice(1).match(/\n## /);
  const sectionEnd = nextH2Match
    ? headingIdx + 1 + (nextH2Match.index || 0) + 1
    : source.length;

  // 替换该段
  const beforeSection = source.slice(0, headingIdx);
  const afterSection = source.slice(sectionEnd);
  const sectionHeadingLine = source.slice(headingIdx, source.indexOf('\n', headingIdx) + 1);

  const newSection = sectionHeadingLine + '\n' + targetBlock.body.trim() + '\n\n';

  return {
    source: beforeSection + newSection + afterSection.replace(/^\n+/, ''),
    rewritten: true,
  };
}

/**
 * 便利: 把整个段拿到 + 修改 + 再写回 (用于 PUT /admin/prompt-ops/:agentId/fields)
 */
export function updateFieldsInSource(
  source: string,
  inputFields?: EditableField[],
  outputFields?: EditableField[]
): { source: string; warnings: string[] } {
  const warnings: string[] = [];
  let current = source;

  if (inputFields) {
    const r = serializeFieldsToSource(current, 'input', inputFields);
    if (r.error) warnings.push(`input: ${r.error}`);
    current = r.source;
  }

  if (outputFields) {
    const r = serializeFieldsToSource(current, 'output', outputFields);
    if (r.error) warnings.push(`output: ${r.error}`);
    current = r.source;
  }

  return { source: current, warnings };
}
