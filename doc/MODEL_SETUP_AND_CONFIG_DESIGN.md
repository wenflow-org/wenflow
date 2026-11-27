# 模型配置的系统设计（从部署到 Skill 细调，含插件降级）

> 📌 类型：设计方案（把「模型配置」拆成连接与模型清单两件事，并定义对话 / 向量 / 重排 / 插件 / Skill 的配置与降级形态）｜索引见 [doc/README.md](./README.md)。
> 关联：[`MODEL_GATEWAY_DESIGN.md`](./MODEL_GATEWAY_DESIGN.md)（运行时网关 SSOT——本文只补充「怎么把模型配进来」，不重复解析链路）、[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)、[`ADMIN_VISUAL_LAYER_SPEC.md`](./ADMIN_VISUAL_LAYER_SPEC.md)
> 适用范围：`backend/config/llm-providers.json`、`backend/src/services/{apiConfig,admin/model-providers,embedding}/`、`backend/src/routes/admin/{api-config,model-providers,infra-models,plugins,skill-model-configs}.ts`、`frontend/src/views/admin-redesign/{ApiConfig,ModelProvidersPanel,InfraModelsPanel,PullModelsDialog,ModelEditorDialog,Addons}.vue`、`skill-design/runtime-tab.vue`

---

## 0. 一句话结论

**把「模型配置」拆成两件事：谁能连（连接/密钥，进 DB 密文）、有哪些模型（清单/能力/限额，进 git 文件）。**

对话 / 向量 / 重排三块共用同一套「连接 + 拉取 + 勾选」交互：各自向上游 `/v1/models` 拉一份清单，用户只挑自己要的（对话卡不按角色过滤，向量 / 重排卡按用途筛）——**平台不维护上游全量表**。Skill 默认全部「跟随平台默认」，只在需要时覆盖。插件是另一套同构机制：每个通道一条「主用 → 备用」有序 provider 链，链就是降级。

平台默认模型由 UI「设为默认」钉选，写入 DB `platform_api_configs.defaultModel`（默认为空时，首个挂载的模型自动成为默认）；运行时只认这一个默认，DB 与 env `AI_MODEL` 都为空时报 `AI model is not configured`。

---

## 1. 要支撑的动线（用户口径）

1. 部署时可在环境里配 API 端点与模型；不配模型也能启动；但**必须配管理员账号密码**才能进管理台。
2. 进管理台后 UI 配置：**第 1 步填 API Key → 拉取模型**（大部分网关会返回模型清单）。
3. 模型分三块——**对话 / 向量(embedding) / 重排(rerank)**，每块**各自独立拉取**；返回结果可能很多，**平台不维护这张全量表**，用户只挑自己需要的放进对应位置。
4. 平台侧把需要的模型配好（对话可能配 3~4 个）。
5. 再去 **Skill 里细调**；开发时只用了 DeepSeek-V4.1 一个模型，所以 **Skill 基本都跟平台默认走**。
6. **思考模式 / 思考强度 / 能力（视觉等）由用户自己勾选**——用户必须清楚自己的模型有什么能力。
7. 这些配置**落到本地文件吗？同步读取吗？**
8. 插件里的配置也是同样的顺序；插件还有**降级**，一并设计。

设计目标：这 8 步在 UI 上走得通、走得顺，且每一步的「配置真相」都有唯一落点、可热生效、可 git 审查。

---

## 2. 配置落在哪儿（现行）

### 2.1 四份配置各存各的

| 配置 | 存储位置 | 读取语义 |
|---|---|---|
| 对话模型清单 + 能力 + 限额 + 单价 | **`backend/config/llm-providers.json`（git 跟踪）** | 启动时同步读入内存；每次解析前比 mtime，变了才重读 → **热生效、无需重启** |
| 平台连接（Base URL / API Key）+ 平台默认模型 + 可靠性 | **DB `platform_api_configs`**（key 为 AES-256-GCM 密文，AAD=`system.platform_api_configs.apiKey`） | 路由读取有 60s 缓存，写后失效 |
| 自定义供应商密钥（BYOK） | **DB `provider_secrets`**（密文） | 60s 进程内缓存 + 写后失效 |
| **向量 / 重排** | **DB `platform_settings.infraModels`（JSON）** + 密钥 `provider_secrets`（`infra-embedding` / `infra-rerank`） | 启动时 hydrate 成进程快照，保存时再 hydrate |
| 插件供应商（目录 = 类型定义，值 + 顺序 = 平台设置） | **代码 `backend/src/config/plugin-providers.ts`** + 值落 `platform_settings` | 每次读 DB / 代码常量 |

四份**不合并存储**：每份存什么、为什么，由 §3 的判定原则一句话说清。

### 2.2 部署期脚本写 env，env 只是兜底

- `setup-env.ps1` / `docker-start.sh` 往 `backend/.env` 写 `AI_API_URL` / `AI_API_KEY` / `AI_MODEL`，并补 embedding / rerank 变量（留空 = 不启用语义层，不影响启动）。
- 运行时主路径读 DB 行；这些变量只在 `platform_api_configs` 为空时兜底（`APIRouter.getFallbackConfig`）。
- **env 与 UI 不是同一份真相**：env 只是首次部署的种子。

### 2.3 不配模型能启动；进管理台的唯一硬门槛是管理员账号

- 未配置 `INIT_ADMIN_PASSWORD` 时不创建初始管理员（`backend/src/bootstrap/seeds.ts`）；用户名 / 密码（`INIT_ADMIN_NAME` / `INIT_ADMIN_PASSWORD`）是唯一硬门槛。
- 模型缺失不阻断启动：`llm-providers.json` 缺失 → 内置兜底目录，env 全空也能起，只是调用时会报错（§2.4）。

### 2.4 平台默认模型的落点

- 运行时默认模型只认 DB `platform_api_configs.defaultModel`（`APIRouter.resolveModel`）；它与 env `AI_MODEL` 都为空时报 `AI model is not configured. Set admin defaultModel or AI_MODEL.`。
- 注册表文件的 `defaults` 只作展示 / 自洽校验，运行时不读。
- 管理台通过模型行「设为默认」写 `platform_api_configs.defaultModel`（`PUT /admin/api-config`）。

### 2.5 三块模型：对话 / 向量 / 重排

- **对话**：「获取模型」先做连通测试并拉上游 `/v1/models`，成功后把连接落盘再开挑选弹窗（`ApiConfig.vue#fetchModels`）。挑选弹窗是一张平铺清单：搜索 + 清单（模型标识 / 状态 / 测试），已添加的置灰并沉到末尾；清单不按模型名猜能力——能力在引入时按模型名预判入库，要改去行内「配置」。
- **向量 / 重排**：`InfraModelsPanel.vue` 两张卡，连接后可拉取上游清单并按用途过滤；默认 `BAAI/bge-m3` / `BAAI/bge-reranker-v2-m3`（`infra-config.ts`），provider 只支持 `bge`。一条连接可配多个模型（模型池），其中一个「启用」，运行时只调用启用的那个。

### 2.6 能力元数据：引入时按模型名推断，行内可改

- `modelCapabilityInference.ts#inferModelCapabilities`（前端）用正则从模型 **id 字符串**推断 `role`（image / rerank / embedding / chat）与 `supportsThinking` / `reasoningEfforts` / `vision` 等；猜中思考标记时强度预填 `low / high / max`。
- 批量「添加模型」时把推断值直接写进注册表；要精修能力，去行内「配置」逐项修改。

### 2.7 Skill 级：默认「跟随平台默认」

- `skill_model_configs` 的生效字段：`model` / `thinkingMode` / `reasoningEffort` / `endpoint` / `apiKey` / `requestTimeoutMs` / `maxLogicalRetries` / `paramOverrides`；`fallbackChain` 列保留但不读写。
- `model` 为空 = 继承平台默认；`runtime-tab.vue` 的模型行未单独指定时显示「跟随平台默认」。这就是「Skill 基本都跟平台默认」。

### 2.8 插件：三组插件、四条「有序 provider 链 = 降级」通道

- 目录 `plugin-providers.ts` 定义三组插件：**联网 web**（search / fetch 两通道，TinyFish / Tavily / Exa）、**决策 decision**（阿里云 / Cloudflare / Venice / OpenCode Zen / 自建）、**生图 image**（Agnes）。每个 provider 自带 `服务地址 + 模型 + 密钥`。
- **配置面**：每个通道的 `defaultOrder` 给出默认链，实际顺序按通道存 `platform_settings`；`Addons.vue` 里拖 `主用 / 备用1 / 备用2` 即改这条链——**四条通道一视同仁**，不是只有联网能排。
- **运行面**：`web-search` / `fetch` / `decision` / `image` 四处服务都是「按链逐个 provider 尝试，失败自动降级」，同一个形状。
- **已知限制**：生图只有 `agnes` 一个已实现 provider（`image/providers/index.ts` 的 `KNOWN_PROVIDERS` 与 `IMPLEMENTED_PROVIDERS` 都只有它），链永远只有一项、**没有第二个可降级对象**。决策有 5 个已实现 provider，默认链只放 `alibaba` 一个——其余可以在界面上加进链。

---

## 3. 判定原则（回答「到底落文件还是 DB、同步读吗」）

**一条规则，解释全部四份：**

> **形状与不含密钥的模型清单 → 文件（git，可审查、可服务器手改）；密钥与「这台机器选了哪个」 → DB（密文，不随仓库走）。**

据此：

- **对话模型清单（含能力 / 限额 / 单价）→ `llm-providers.json`。** 它是「有哪些模型、各有什么能力」的**目录**，天然适合当代码审——加一个模型是一次可 review 的 diff；DB 被清空也能从 git 恢复。
  - **读取语义：启动同步读入内存 + mtime 门控热重载，无需重启。** 管理台是这份文件的**编辑器**（原子写 + 备份 10 份 + 失败回滚），不是第二个写源。回答用户：「是的，落到本地文件；同步读、改了自动生效。」
- **连接（Base URL / API Key）、平台默认模型、重试 / RPM → DB。** 密钥绝不能进 git 文件。
- **向量 / 重排 → 保持 DB `infraModels` + 密钥 `provider_secrets`。** 理由同「密钥不进文件」。这里有一个有意的**不对称**：对话的「模型能力」在文件，向量 / 重排的「模型选择」在 DB。embedding / rerank 在平台上是**单例必需配置**，不是可增删的模型墙，放 DB 更贴合「这台机器装了哪套引擎」。
- **插件 → 目录（形状）在代码 `plugin-providers.ts`，值与顺序在 `platform_settings`。** 形状属于代码契约；具体填哪家、什么顺序属于部署决策。

一句话给用户：**「模型有哪些」在文件里（可 git 审、同步读、热生效）；「用哪把钥匙、默认哪一个」在数据库里（密文）。**

---

## 4. 三块模型的统一交互（回答 §1 的 2~4 步）

在「系统设置 → 模型与接入」宿主页内，三块是**同构的三张卡**。三张卡同一套解剖：卡头只有能力角色 + 类型 + 一颗「＋ 添加模型」，正文是模型行（或模型池）。对话卡的连接与清单在**同一张弹窗**里（「连接设置」并入添加模型）；向量 / 重排的连接与参数在「配置」弹层里，清单在添加弹窗里：

```
┌ 对话模型  LLM                                                  [＋添加模型] ┐
├──────────────────────────────────────────────────────────────────────────┤
│ deepseek-v4.1-flash  默认 思考 推理强度 视觉               配置 测试 ⋯ │
│ agnes-3.0-flash                                            配置 测试 ⋯ │
└──────────────────────────────────────────────────────────────────────────┘
  点「＋添加模型」→ 弹窗：顶部「连接」段（地址 / 密钥 + 显隐 / 最大重试 / 间隔 / RPM
  + [重置此通道] [保存连接]），下面是按当前地址拉一次的上游清单（勾选 / 提前测试 / 手动录入）
┌ 向量模型  Embedding                         [＋添加模型] ┐
│ BAAI/bge-m3                              启用  配置 测试 ⋯ │
│ Qwen3-Embedding-0.6B                            配置 测试 ⋯ │
└──────────────────────────────────────────────────────────┘
┌ 重排模型  Reranker                          [＋添加模型] ┐
│ BAAI/bge-reranker-v2-m3                         配置 测试 ⋯ │
└──────────────────────────────────────────────────────────┘
```

**关键设计点：**

1. **三块共用一条「连接」，默认「复用对话连接」。** 大多数聚合网关一个 base URL + 一把 key 就能同时服务 chat/embedding/rerank。用户只需在对话卡填一次；向量/重排卡默认继承，需要独立服务时才勾「使用独立接口地址覆盖全局通道」（`InfraModelsPanel` 的 `connectionMode: inherit|own`）。独立服务填**根地址**，`/v1/embeddings`、`/v1/rerank` 由界面拼并给出实际请求预览；库里仍存完整端点，回填时还原成根地址。**这段连接只在「＋ 添加模型」弹窗里**：行内「配置」弹层只剩模型与参数（模型 ID 只读 + 显示名称可改，与对话模型的「模型设置」同一对标识）；拉清单带草稿连接去拉，改连接后清单标过期。
2. **三块各自「拉取」同一份 `/v1/models`。** 对话卡的清单**不按角色过滤**，上游返回什么就列什么，由运营自己判断要哪几个；`modelCapabilityInference` 的 `role` 只留给向量卡 / 重排卡按用途筛选（`role==='embedding'` / `'rerank'`）。**平台不落库全量表**：拉取结果只活在弹窗里，确认后才把选中项写进各自存储。
3. **向量 / 重排的「拉取」**：只把「上游模型 id 列表 + 角色过滤后的候选」呈现给用户挑选，provider 适配层仍是 `bge`；也可以「手动录入」（自建 / 别名）。**默认值 `BAAI/bge-m3` 是「占位建议」。** 没有 `single` 单选模式——勾几个就进池子几个，由池子里的「启用」决定运行时用哪个。
4. **钉默认**：对话卡模型行提供「设为默认」；默认为空时，**第一个挂载的模型自动成为默认**。写入 `platform_api_configs.defaultModel`。平台只有一个默认，长不长思考看思考模式 / 推理强度。

---

## 5. 能力元数据：按模型名预填，行内可改（回答 §1 第 6 步）

- 添加模型（无论批量还是手动）时，按模型名推断 `思考 / 推理强度 / 视觉 / 输出上限 / 默认输出 / 推理预留 / 并发上限 / 单价` 等能力并写入注册表。
- 用户要精修能力，去行内「配置」逐项修改；未声明的能力保守处理。
- 运行时的能力闸门（网关的 `MODEL_VISION_UNSUPPORTED` 等，见 `MODEL_GATEWAY_DESIGN.md` §4.4）保持不变——声明错会被硬拦，这层保护正好和「用户要清楚自己模型能力」互补。

---

## 6. Skill 细调：默认继承，按需覆盖（回答 §1 第 5 步）

§2.7 已符合，设计只需明确「默认无感、例外才配」：

- **默认：Skill 不写模型 = `model IS NULL` = 跟随平台默认**。管理台 Skill「运行时」页读数显示「当前使用平台默认」。
- **需要时**才配：选模型 / 思考模式 / 思考强度 / temperature-topP-maxTokens 覆盖 / 超时 / 逻辑重试。
- 开发期只用 DeepSeek-V4.1 ⇒ 99% 的 Skill 无需任何模型配置，这是**默认体验**：Skill 列表 + 覆盖率视图里，绝大多数显示「平台默认」。

---

## 7. 插件配置 + 降级（回答 §1 第 8 步）

**插件与模型同构：每个「通道」是一条有序 provider 链，链序即降级。**

```
┌ 联网 ────────────────────────────────────────────┐
│ 搜索   主用 TinyFish ▸ 备用1 Tavily ▸ 备用2 Exa     [配置] │
│ 抓取   主用 TinyFish ▸ 备用1 Tavily                [配置] │
└──────────────────────────────────────────────────┘
┌ 决策 ────────────────────────────────────────────┐
│ 判定   主用 阿里云MaaS ▸ 备用1 Cloudflare ▸ …      [配置] │
└──────────────────────────────────────────────────┘
┌ 生图 ────────────────────────────────────────────┐
│ 生成   主用 Agnes                                 [配置] │
└──────────────────────────────────────────────────┘
```

**降级设计（两层，别混）：**

1. **通道内 provider 降级（=「插件降级」用户所指）——现行机制**（§2.8）：一条链里按顺序尝试、失败自动下一个，`web / fetch / decision / image` 四处同构。每个 provider 自带地址 + 模型 + 密钥，换 provider 即换端点 / 密钥。它与对话侧**不同**：对话侧不做降级，失败就报错（`MODEL_GATEWAY_DESIGN.md` §4.5）。
   - 两个必须向用户明说的事实：① 决策有 5 个已实现 provider，而默认链只放了一个（界面可加）；② 生图只有一个已实现的 provider（`agnes`），**它的链永远只有一项**——用户若以为「配了备用就会降级」，需要对这一条明说。
2. **能力降级（插件停用 / 缺失时整步降级）**：某插件关闭或失败时，依赖它的那一步走「各卡标注的降级路径」（如资料包标为未找到），流水线继续跑而不是整条挂掉。这层是**行为约定**，不是用户可编辑配置。

**配置顺序与模型一致**：先填 provider 的地址 / 密钥 → 测连通 → 选 / 排链 → 保存。`Addons.vue` 提供 `主用 / 备用` 拖拽 + 逐 provider 字段，顺序持久化到 `platform_settings`。

---

## 8. 边界与风险

- **对话侧不做降级**：主模型失败即报错，不换模型；对话卡挂多少模型都只按默认那一只用。插件侧（web / fetch / decision / image）的 provider 链是另一套机制（每个 provider 自带地址与密钥），不受影响。
- **模型 id 未注册时**：解析链对裸 id 原样返回、不静默回落；未注册的 id 等于没有能力声明（不发思考 / 推理强度字段，带图请求被拒），调用结果由上游决定。
- **`skill_model_configs` 历史覆盖行**：已有库里的旧 `model` 覆盖不会自动清空，需用「批量模型配置 → 跟随平台默认」清（`MODEL_GATEWAY_DESIGN.md` §4.8）。
- **验收标准**：全新库、只配管理员账号、UI 里填 Base URL + Key → 拉取 → 挂 1 个对话模型 → **无需碰 env 即可完成一次真实 LLM 调用**。
