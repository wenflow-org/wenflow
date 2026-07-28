# Prompt Lab 部署说明

## 开发环境运行步骤

### 1. 复制蓝图文件到 public 目录

前端需要通过 HTTP 访问 YAML 蓝图文件，所以必须将文件复制到 `public` 目录：

```powershell
# 创建目录
New-Item -ItemType Directory -Path "frontend/public/prompt-lab/blueprints" -Force

# 复制蓝图文件
Copy-Item "prompt-lab/blueprints/*.yaml" -Destination "frontend/public/prompt-lab/blueprints/" -Force
Copy-Item "prompt-lab/blueprints/*.json" -Destination "frontend/public/prompt-lab/blueprints/" -Force
```

### 2. 启动开发服务器

```bash
cd wenflow/frontend
npm run dev
```

### 3. 访问页面

访问：`http://localhost:5173/admin/prompt-lab`

（如果 5173 端口被占用，Vite 会自动使用其他端口，注意查看终端输出）

---

## 文件路径映射

| 源文件 | 前端访问路径 | 物理路径 |
|--------|-------------|---------|
| `prompt-lab/blueprints/goal-conversation.yaml` | `/prompt-lab/blueprints/goal-conversation.yaml` | `frontend/public/prompt-lab/blueprints/goal-conversation.yaml` |
| `prompt-lab/blueprints/goal-conversation.schema.json` | `/prompt-lab/blueprints/goal-conversation.schema.json` | `frontend/public/prompt-lab/blueprints/goal-conversation.schema.json` |

---

## 生产环境部署

### 方式 1：静态文件（简单）

构建时将蓝图文件复制到 `dist` 目录：

```bash
# 构建前端
npm run build

# 复制蓝图文件
Copy-Item "../../prompt-lab/blueprints/*" -Destination "dist/prompt-lab/blueprints/" -Force
```

### 方式 2：后端 API（推荐）

创建后端 API 来提供蓝图文件：

```typescript
// backend/src/routes/prompt-lab.ts
router.get('/api/prompt-lab/blueprints/:skillId', async (req, res) => {
  const { skillId } = req.params
  const yamlPath = path.join(__dirname, `../../prompt-lab/blueprints/${skillId}.yaml`)
  const yamlContent = await fs.readFile(yamlPath, 'utf-8')
  res.type('text/yaml').send(yamlContent)
})
```

然后修改前端 parser：

```typescript
// frontend/src/utils/blueprintParser.ts
export async function loadYamlBlueprint(blueprintId: string): Promise<YamlBlueprint> {
  // 开发环境：从 public 目录加载
  // 生产环境：从后端 API 加载
  const apiUrl = import.meta.env.PROD 
    ? `/api/prompt-lab/blueprints/${blueprintId}`
    : `/prompt-lab/blueprints/${blueprintId}.yaml`
  
  const response = await fetch(apiUrl)
  const yamlText = await response.text()
  return yaml.load(yamlText) as YamlBlueprint
}
```

---

## 故障排查

### 问题 1：404 Not Found

**症状**：浏览器控制台显示 `GET /prompt-lab/blueprints/goal-conversation.yaml 404`

**原因**：蓝图文件不在 `public` 目录

**解决**：执行步骤 1，复制文件到 `public` 目录

### 问题 2：编译错误

**症状**：页面白屏，控制台有 TypeScript 错误

**原因**：类型不匹配

**解决**：检查 `blueprintCompiler.ts` 和 `types/blueprint.ts` 的类型定义是否一致

### 问题 3：YAML 解析失败

**症状**：控制台显示 `yaml.load is not a function`

**原因**：`js-yaml` 导入方式错误

**解决**：统一使用 `import * as yaml from 'js-yaml'`

---

## 开发工作流

### 修改蓝图后的同步步骤

1. 编辑 `prompt-lab/blueprints/goal-conversation.yaml`
2. 复制到 `frontend/public/prompt-lab/blueprints/`
3. 刷新浏览器页面

### 自动同步脚本

创建 `sync-blueprints.ps1`：

```powershell
# sync-blueprints.ps1
Copy-Item "prompt-lab/blueprints/*" -Destination "frontend/public/prompt-lab/blueprints/" -Force
Write-Host "蓝图文件已同步" -ForegroundColor Green
```

运行：`.\sync-blueprints.ps1`

---

## 注意事项

1. ⚠️ **不要直接编辑** `frontend/public/prompt-lab/` 下的文件
2. ⚠️ 源文件始终是 `prompt-lab/blueprints/`
3. ⚠️ 修改后记得同步到 `public` 目录
4. ✅ 考虑使用文件监听自动同步
5. ✅ 生产环境建议使用后端 API

---

## 未来改进

- [ ] 实现后端保存 API，直接保存到源文件
- [ ] 添加文件监听，自动同步
- [ ] 实现版本控制和回滚
- [ ] 添加蓝图验证和 lint
