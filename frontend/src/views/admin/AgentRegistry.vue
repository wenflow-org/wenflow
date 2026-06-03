<template>
  <div class="agent-registry-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
      <div class="bg-orb bg-orb--3"></div>
    </div>

<div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Grid /></el-icon>
        运行节点管理
      </h2>
      <p class="page-hero__subtitle">统一查看平台内部 Agent、编排器与主链 Skill。外挂能力组件继续在“技能/组件配置”中管理，但两边都保留 Prompt、模型参数与运行预览能力。</p>
    </div>

    <div class="summary-grid" v-show="summary" style="position: relative; z-index: 1;">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">运行节点数量</div>
        <div class="value">{{ summary?.total }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">24h 活跃</div>
        <div class="value">{{ summary?.active24h }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">未调用</div>
        <div class="value">{{ summary?.neverCalled }}</div>
      </el-card>
      <el-card class="summary-card summary-card--red" shadow="hover">
        <div class="label">需关注</div>
        <div class="value danger">{{ summary?.unhealthy }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索运行节点 ID / 名称" clearable class="search" />
        <el-select v-model="nodeKind" placeholder="节点类型" clearable class="select">
          <el-option label="Agent" value="agent" />
          <el-option label="Skill" value="skill" />
          <el-option label="Orchestrator" value="orchestrator" />
        </el-select>
        <el-select v-model="lifecycle" placeholder="发布状态" clearable class="select">
          <el-option label="草稿" value="draft" />
          <el-option label="预发布" value="staging" />
          <el-option label="已发布" value="published" />
        </el-select>
        <el-select v-model="health" placeholder="健康状态" clearable class="select">
          <el-option label="健康" value="healthy" />
          <el-option label="预警" value="warning" />
          <el-option label="异常" value="error" />
          <el-option label="空闲" value="idle" />
        </el-select>
        <el-checkbox v-model="onlyAttention">仅看需关注</el-checkbox>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button @click="seedCorePrompts">
          初始化核心 Prompt
        </el-button>
        <el-button type="primary" @click="loadRegistry" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="admin-list-card">
      <el-table :data="filteredAgents" v-loading="loading" stripe style="width: 100%;">
      <el-table-column label="节点" min-width="280">
        <template #default="{ row }">
          <div class="agent-cell">
            <div class="agent-cell__title-row">
              <strong class="agent-cell__name">{{ row.name }}</strong>
              <el-tag size="small" :type="getKindTagType(row.kind)">{{ getKindLabel(row.kind) }}</el-tag>
            </div>
            <span class="agent-cell__id">{{ row.agentId }}</span>
            <span class="agent-cell__meta">{{ row.type }} · v{{ row.version }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="运行状态" min-width="190">
        <template #default="{ row }">
          <div class="status-cell">
            <div class="status-cell__row">
              <span class="status-cell__label">发布</span>
              <el-tag :type="getLifecycleTagType(row.lifecycleStatus)" size="small">{{ getLifecycleLabel(row.lifecycleStatus) }}</el-tag>
            </div>
            <div class="status-cell__row">
              <span class="status-cell__label">健康</span>
              <el-tag :type="getHealthTagType(row.status)" size="small">{{ getHealthLabel(row.status) }}</el-tag>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="运行指标" min-width="180">
        <template #default="{ row }">
          <div class="metrics-cell">
            <div class="metrics-cell__row">
              <span>{{ row.callCount }} 调用</span>
              <span :class="rateClass(row.successRate)">{{ row.successRate }}%</span>
            </div>
            <div class="metrics-cell__row metrics-cell__row--sub">
              <span>{{ formatDuration(row.avgDuration) }} 平均</span>
              <span>{{ formatTime(row.lastActivity) }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="Prompt版本" min-width="180">
        <template #default="{ row }">
          <div class="prompt-cell">
            <template v-if="getPromptSummary(row.agentId)?.loading">
              <span class="prompt-cell__muted">加载中...</span>
            </template>
            <template v-else-if="getPromptSummary(row.agentId)?.versionLabel">
              <strong class="prompt-cell__version">{{ getPromptSummary(row.agentId)?.versionLabel }}</strong>
              <el-tag
                size="small"
                effect="plain"
                :type="getPromptStatusTagType(getPromptSummary(row.agentId)?.status)"
              >
                {{ getPromptSummary(row.agentId)?.statusLabel }}
              </el-tag>
            </template>
            <span v-else class="prompt-cell__muted">{{ getPromptSummary(row.agentId)?.existsWithoutActive ? '有版本未激活' : '未配置' }}</span>
          </div>
        </template>
      </el-table-column>
        <el-table-column label="操作" width="108" fixed="right" align="center">
          <template #default="{ row }">
          <el-button class="table-link-btn" @click="openNode(row)">{{ row.kind === 'skill' ? '查看配置' : '查看设计' }}</el-button>
          </template>
        </el-table-column>
       </el-table>
    </div>

    <el-drawer
      v-model="designDrawerVisible"
      :title="`运行定义 · ${currentDesign?.basic.name || currentDesign?.agentId || ''}`"
      size="min(72%, 1080px)"
      destroy-on-close
    >
      <div v-loading="designLoading" class="design-drawer">
        <template v-if="currentDesign">
          <section class="design-hero">
            <div class="design-hero__main">
              <span class="pill">运行定义</span>
              <div class="design-hero__title-row">
                <h3>{{ currentDesign.basic.name }}</h3>
                <el-tag size="small" effect="plain" :type="getKindTagType(currentDesign.runtime.kind)">
                  {{ getKindLabel(currentDesign.runtime.kind) }}
                </el-tag>
              </div>
              <p class="design-hero__subtitle">{{ currentDesign.basic.description || '当前 Agent 暂无补充说明。' }}</p>
              <div class="design-hero__meta">
                <span>运行 ID：{{ currentDesign.agentId }}</span>
                <span>版本：{{ currentDesign.basic.version || '-' }}</span>
                <span>类型：{{ formatTypeLabel(currentDesign.basic.type) }}</span>
                <span>分类：{{ formatCategoryLabel(currentDesign.basic.category) }}</span>
              </div>
            </div>
            <div class="design-hero__summary">
              <div class="design-summary-card">
                <span class="design-summary-card__label">运行状态</span>
                <div class="design-summary-card__value-row">
                  <el-tag :type="currentDesign.runtime.runtimeEnabled ? 'success' : 'info'" size="small">
                    {{ currentDesign.runtime.runtimeEnabled ? '已启用' : '未启用' }}
                  </el-tag>
                  <el-tag size="small" effect="plain" :type="getPromptStatusTagType(currentPromptActive?.status)">
                    {{ currentPromptActive ? getPromptStatusLabel(currentPromptActive.status) : '提示词待确认' }}
                  </el-tag>
                </div>
                <p>{{ formatPromptSourceSummary(currentPromptSource) }}</p>
              </div>
              <div class="design-summary-card">
                <span class="design-summary-card__label">模型运行时</span>
                <strong class="design-summary-card__value">{{ currentModelConfig?.model || '平台默认模型' }}</strong>
                <p>{{ currentModelConfig ? `${formatTierLabel(currentModelConfig.tier)} · ${formatThinkingMode(currentModelConfig.thinkingMode)} / ${formatReasoningEffort(currentModelConfig.reasoningEffort)}` : '当前未配置独立模型策略' }}</p>
              </div>
            </div>
          </section>

          <el-alert
            v-if="isLegacyAliasDesign(currentDesign)"
            title="当前打开的是历史兼容别名，系统真实运行身份已迁移到新的规范 ID。"
            type="info"
            :closable="false"
            show-icon
            class="design-banner"
          />

          <div class="design-overview-grid">
            <section class="design-panel">
              <div class="design-panel__header">
                <div>
                  <h4>基础信息</h4>
                  <p>用于识别这条运行定义的身份与用途。</p>
                </div>
              </div>
              <div class="kv-grid">
                <div class="kv-item">
                  <span class="kv-item__label">显示名称</span>
                  <strong class="kv-item__value">{{ currentDesign.basic.name }}</strong>
                </div>
                <div class="kv-item">
                  <span class="kv-item__label">运行类型</span>
                  <strong class="kv-item__value">{{ getKindLabel(currentDesign.runtime.kind) }}</strong>
                </div>
                <div class="kv-item">
                  <span class="kv-item__label">角色定位</span>
                  <strong class="kv-item__value">{{ formatRuntimeRoleLabel(currentDesign.runtime.role) }}</strong>
                </div>
                <div class="kv-item">
                  <span class="kv-item__label">输出协议</span>
                  <strong class="kv-item__value">{{ formatIoContractLabel(currentDesign.runtime.ioContractVersion) }}</strong>
                </div>
                <div class="kv-item">
                  <span class="kv-item__label">监控分组</span>
                  <strong class="kv-item__value">{{ currentDesign.runtime.monitoringGroup || '未分组' }}</strong>
                </div>
                <div class="kv-item">
                  <span class="kv-item__label">兼容别名</span>
                  <strong class="kv-item__value">{{ currentDesign.runtime.aliases.join('、') || '无' }}</strong>
                </div>
              </div>
            </section>

            <section class="design-panel">
              <div class="design-panel__header">
                <div>
                  <h4>运行摘要</h4>
                  <p>把常用判断项收成同一屏，减少来回切换。</p>
                </div>
              </div>
              <div class="runtime-glance-grid">
                <div class="runtime-glance-card">
                  <span class="runtime-glance-card__label">启用状态</span>
                  <el-tag :type="currentDesign.runtime.runtimeEnabled ? 'success' : 'info'" size="small">
                    {{ currentDesign.runtime.runtimeEnabled ? '已启用' : '未启用' }}
                  </el-tag>
                </div>
                <div class="runtime-glance-card">
                  <span class="runtime-glance-card__label">提示词来源</span>
                  <el-tag size="small" :type="promptSourceTagType(currentPromptSource)">
                    {{ promptSourceLabel(currentPromptSource) }}
                  </el-tag>
                </div>
                <div class="runtime-glance-card">
                  <span class="runtime-glance-card__label">模型层级</span>
                  <strong>{{ currentModelConfig ? formatTierLabel(currentModelConfig.tier) : '未配置' }}</strong>
                </div>
                <div class="runtime-glance-card">
                  <span class="runtime-glance-card__label">最近调用</span>
                  <strong>{{ currentDesign.samples.agentCallLogs.length ? formatTime(currentDesign.samples.agentCallLogs[0].calledAt) : '暂无记录' }}</strong>
                </div>
              </div>
            </section>
          </div>

          <section class="design-panel design-panel--chips">
            <div class="design-panel__header">
              <div>
                <h4>接口契约</h4>
                <p>说明这个 Agent 能做什么、会接收什么、会产出什么。</p>
              </div>
            </div>
            <div class="chip-section chip-section--contract">
              <div class="chip-row chip-row--stacked">
                <span class="chip-label">能力</span>
                <div class="chip-list">
                  <el-tag v-for="item in currentDesign.definition.capabilities" :key="`cap-${item}`" size="small" effect="plain">{{ item }}</el-tag>
                  <span v-if="!currentDesign.definition.capabilities.length" class="empty">暂无能力声明</span>
                </div>
              </div>
              <div class="chip-row chip-row--stacked">
                <span class="chip-label">接收事件</span>
                <div class="chip-list">
                  <el-tag v-for="item in currentDesign.definition.subscribes" :key="`sub-${item}`" size="small" effect="plain">{{ item }}</el-tag>
                  <span v-if="!currentDesign.definition.subscribes.length" class="empty">当前没有订阅事件</span>
                </div>
              </div>
              <div class="chip-row chip-row--stacked">
                <span class="chip-label">输出事件</span>
                <div class="chip-list">
                  <el-tag v-for="item in currentDesign.definition.publishes" :key="`pub-${item}`" size="small" effect="plain">{{ item }}</el-tag>
                  <span v-if="!currentDesign.definition.publishes.length" class="empty">当前没有输出事件</span>
                </div>
              </div>
            </div>
          </section>

          <el-tabs class="design-tabs">
            <el-tab-pane label="输入协议">
              <section class="protocol-panel">
                <div class="design-panel__header design-panel__header--tight">
                  <div>
                    <h4>输入协议</h4>
                    <p>这部分定义调用方应传入哪些字段、字段类型和必填项，不等同于提示词全文。</p>
                  </div>
                </div>
                <div class="protocol-overview-grid">
                  <section class="contract-card protocol-tip-card">
                    <span class="chip-label">协议说明</span>
                    <ul class="protocol-tip-list">
                      <li>用于说明这条 Agent 接收内容的接口约定。</li>
                      <li>提示词会围绕这份约定组织行为，但不会自动生成这份协议。</li>
                      <li>运行时是否严格遵守，还取决于调用代码和后处理逻辑。</li>
                    </ul>
                  </section>
                  <section class="contract-card protocol-json-card">
                    <span class="chip-label">JSON 骨架</span>
                    <pre class="sample-json">{{ inputSchemaPreview }}</pre>
                  </section>
                </div>
                <el-table :data="inputSchemaRows" border size="small" empty-text="暂无输入协议">
                  <el-table-column prop="path" label="字段路径" min-width="240" />
                  <el-table-column prop="semanticLabel" label="字段含义" min-width="180" />
                  <el-table-column prop="type" label="类型" width="120" />
                  <el-table-column prop="requiredLabel" label="必填" width="90" />
                  <el-table-column prop="description" label="作用说明" min-width="220" />
                </el-table>
              </section>
            </el-tab-pane>
            <el-tab-pane label="输出协议">
              <section class="protocol-panel">
                <div class="design-panel__header design-panel__header--tight">
                  <div>
                    <h4>输出协议</h4>
                    <p>这部分定义该 Agent 理论上应返回哪些字段，是运行约定，不是最近一次真实输出快照。</p>
                  </div>
                </div>
                <div class="protocol-overview-grid">
                  <section class="contract-card protocol-tip-card">
                    <span class="chip-label">协议说明</span>
                    <ul class="protocol-tip-list">
                      <li>提示词通常会要求模型围绕这些字段组织输出。</li>
                      <li>如果真实返回与这里不一致，通常需要同时检查提示词和后处理代码。</li>
                      <li>建议结合下方“最近调用样本”一起看，判断约定是否真正落地。</li>
                    </ul>
                  </section>
                  <section class="contract-card protocol-json-card">
                    <span class="chip-label">JSON 骨架</span>
                    <pre class="sample-json">{{ outputSchemaPreview }}</pre>
                  </section>
                </div>
                <el-table :data="outputSchemaRows" border size="small" empty-text="暂无输出协议">
                  <el-table-column prop="path" label="字段路径" min-width="240" />
                  <el-table-column prop="semanticLabel" label="字段含义" min-width="180" />
                  <el-table-column prop="type" label="类型" width="120" />
                  <el-table-column prop="requiredLabel" label="必填" width="90" />
                  <el-table-column prop="description" label="作用说明" min-width="220" />
                </el-table>
              </section>
            </el-tab-pane>
            <el-tab-pane label="提示词版本">
              <div class="prompt-panel" v-loading="promptDrawerLoading">
                <div class="prompt-actions">
                  <el-button type="primary" size="small" @click="openCreatePromptDialog">
                    <el-icon><Plus /></el-icon>
                    创建新版本
                  </el-button>
                  <el-button v-if="currentPromptActive" size="small" @click="openForkFromActive">
                    基于当前版本修改
                  </el-button>
                </div>
                <el-alert
                  v-if="currentDesign?.runtime.promptManagement?.note"
                  :title="currentDesign.runtime.promptManagement.note"
                  type="info"
                  :closable="false"
                  show-icon
                  class="prompt-notice"
                />
                <template v-if="currentPromptActive">
                  <div class="prompt-summary-card">
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">当前版本</span>
                      <strong>{{ formatPromptVersion(currentPromptActive) }}</strong>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">状态</span>
                      <el-tag size="small" :type="getPromptStatusTagType(currentPromptActive.status)">
                        {{ getPromptStatusLabel(currentPromptActive.status) }}
                      </el-tag>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">名称</span>
                      <span>{{ currentPromptActive.name || '-' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">来源</span>
                      <el-tag size="small" :type="promptSourceTagType(currentPromptSource)">
                        {{ promptSourceLabel(currentPromptSource) }}
                      </el-tag>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">运行参数</span>
                      <span>T={{ currentPromptActive.temperature ?? '--' }} | Max={{ currentPromptActive.maxTokens ?? '--' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">发布时间</span>
                      <span>{{ formatTime(currentPromptActive.publishedAt || currentPromptActive.updatedAt || currentPromptActive.createdAt || null) }}</span>
                    </div>
                  </div>

                  <div class="prompt-text-card">
                    <div class="prompt-text-card__header">
                      <h4>系统提示词</h4>
                      <el-button v-if="promptPreviewText" type="primary" link @click="promptExpanded = !promptExpanded">
                        {{ promptExpanded ? '收起全文' : '展开全文' }}
                      </el-button>
                    </div>
                    <pre class="sample-json prompt-text-card__content">{{ visiblePromptText }}</pre>
                  </div>
                </template>
                <el-empty v-else-if="!promptDrawerLoading" :description="promptEmptyDescription" />

                <div class="prompt-versions-card">
                  <div class="prompt-versions-card__header">
                    <h4>最近版本</h4>
                    <span class="prompt-versions-card__meta">{{ currentPromptVersions.length }} 条</span>
                  </div>
                  <div class="prompt-versions-table">
                    <el-table :data="currentPromptVersions" size="small" border empty-text="暂无 Prompt 版本">
                      <el-table-column label="版本" min-width="80">
                        <template #default="{ row }">
                          {{ formatPromptVersion(row) }}
                        </template>
                      </el-table-column>
                      <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
                      <el-table-column label="参数" min-width="100">
                        <template #default="{ row }">
                          <span class="params-cell">T={{ row.temperature ?? '--' }} | {{ row.maxTokens ?? '--' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="状态" width="90">
                        <template #default="{ row }">
                          <el-tag size="small" effect="plain" :type="getPromptStatusTagType(row.status)">
                            {{ getPromptStatusLabel(row.status) }}
                          </el-tag>
                        </template>
                      </el-table-column>
                      <el-table-column label="更新时间" min-width="140">
                        <template #default="{ row }">
                          {{ formatTime(row.updatedAt || row.createdAt || null) }}
                        </template>
                      </el-table-column>
                      <el-table-column label="操作" width="160" fixed="right">
                        <template #default="{ row }">
                          <el-button 
                            v-if="row.status !== 'ACTIVE'"
                            type="success"
                            link
                            size="small"
                            @click="publishPromptVersion(row.id)"
                            :loading="publishingId === row.id"
                          >
                            发布
                          </el-button>
                          <el-tag v-if="row.status === 'ACTIVE'" type="success" size="small" effect="plain">当前生效</el-tag>
                          <el-button 
                            type="primary"
                            link
                            size="small"
                            @click="editPromptVersion(row)"
                          >
                            编辑
                          </el-button>
                          <el-button 
                            type="danger"
                            link
                            size="small"
                            @click="deletePromptDraft(row.id)"
                          >
                            删除
                          </el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </div>

                <div class="prompt-versions-card">
                  <div class="prompt-versions-card__header">
                    <h4>运行预览</h4>
                    <el-button type="primary" :loading="agentPreviewLoading" @click="runAgentPreview">运行预览</el-button>
                  </div>
                  <div class="contract-grid contract-grid--preview">
                    <section class="contract-card">
                      <span class="chip-label">示例输入</span>
                      <el-input
                        v-model="agentPreviewInputText"
                        type="textarea"
                        :rows="16"
                        class="preview-textarea"
                      />
                    </section>
                    <section class="contract-card">
                      <span class="chip-label">示例输出</span>
                      <pre v-if="agentPreviewOutput" class="sample-json">{{ prettyJson(agentPreviewOutput) }}</pre>
                      <el-empty v-else description="点击运行预览查看输出" />
                    </section>
                  </div>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="模型运行时">
              <div class="model-config-panel" v-loading="modelConfigLoading">
                <template v-if="currentModelConfig">
                  <div class="model-config-card">
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">层级</span>
                      <el-tag size="small">{{ formatTierLabel(currentModelConfig.tier) }}</el-tag>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">模型</span>
                      <span>{{ currentModelConfig.model || '平台默认' }}</span>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">思考模式</span>
                      <el-tag size="small" :type="thinkingTagType(currentModelConfig.thinkingMode)">
                        {{ formatThinkingMode(currentModelConfig.thinkingMode) }}
                      </el-tag>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">思考强度</span>
                      <el-tag size="small" :type="effortTagType(currentModelConfig.reasoningEffort)">
                        {{ formatReasoningEffort(currentModelConfig.reasoningEffort) }}
                      </el-tag>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">启用状态</span>
                      <el-switch v-model="currentModelConfig.enabled" @change="updateModelConfigEnabled" />
                    </div>
                  </div>
                  <el-button type="primary" size="small" @click="openEditModelConfigDialog" class="model-config-edit-btn">
                    编辑运行时配置
                  </el-button>
                </template>
                <el-empty v-else-if="!modelConfigLoading" description="当前 Agent 暂无模型配置" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="最近调用样本">
              <div class="sample-block">
                <div class="design-panel__header design-panel__header--tight">
                  <div>
                    <h4>最近调用</h4>
                    <p>用于快速核对这条运行定义最近一次真实输入输出。</p>
                  </div>
                </div>
                <el-empty v-if="!currentDesign.samples.agentCallLogs.length" description="最近暂无调用记录" />
                <el-collapse v-else>
                  <el-collapse-item
                    v-for="item in currentDesign.samples.agentCallLogs"
                    :key="`call-${item.id}`"
                    :title="`${formatTime(item.calledAt)} · ${item.success ? '成功' : '失败'} · ${item.durationMs || 0}ms`"
                  >
                    <div class="sample-call-meta">
                      <el-tag size="small" :type="item.success ? 'success' : 'danger'">{{ item.success ? '运行成功' : '运行失败' }}</el-tag>
                      <span>耗时 {{ formatDuration(item.durationMs) }}</span>
                      <span v-if="item.error">错误：{{ item.error }}</span>
                    </div>
                    <div class="contract-grid contract-grid--preview">
                      <section class="contract-card">
                        <span class="chip-label">输入载荷</span>
                        <pre class="sample-json">{{ prettyJson(item.input) }}</pre>
                      </section>
                      <section class="contract-card">
                        <span class="chip-label">输出载荷</span>
                        <pre class="sample-json">{{ prettyJson(item.output) }}</pre>
                      </section>
                    </div>
                  </el-collapse-item>
                </el-collapse>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>

    <el-dialog
      v-model="createPromptDialogVisible"
      :title="`${editMode ? '编辑' : '创建'} Prompt 版本 · ${currentDesign?.agentId || ''}`"
      width="min(90%, 720px)"
      destroy-on-close
    >
      <el-form :model="newPromptForm" label-width="100px" v-loading="promptDetailLoading">
        <el-form-item label="版本名称" required>
          <el-input v-model="newPromptForm.name" placeholder="如: v2.0-proposing增强版" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newPromptForm.description" type="textarea" :rows="2" placeholder="版本说明..." />
        </el-form-item>
        <el-form-item label="System Prompt" required>
          <el-input 
            v-model="newPromptForm.systemPrompt" 
            type="textarea" 
            :rows="20"
            placeholder="Agent 系统提示词..."
          />
        </el-form-item>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="Temperature">
              <el-slider v-model="newPromptForm.temperature" :min="0" :max="1" :step="0.1" show-input />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Max Tokens">
              <el-input-number v-model="newPromptForm.maxTokens" :min="100" :max="16000" :step="100" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      
      <template #footer>
        <el-button @click="createPromptDialogVisible = false">取消</el-button>
        <el-button 
          v-if="editMode && editingPromptId"
          type="primary"
          @click="updatePromptDraft"
          :loading="updatingPrompt"
        >
          保存修改
        </el-button>
        <el-button 
          v-if="!editMode"
          type="primary"
          @click="createPromptDraft"
          :loading="creatingPrompt"
        >
          创建草稿
        </el-button>
        <el-button 
          type="success"
          @click="createAndPublishPrompt"
          :loading="creatingPrompt"
        >
          创建并立即发布
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="modelConfigEditDialogVisible"
      title="编辑模型运行时配置"
      width="400px"
      destroy-on-close
    >
      <el-form :model="modelConfigEditForm" label-width="100px">
        <el-form-item label="Agent ID">
          <el-input v-model="modelConfigEditForm.agentId" disabled />
        </el-form-item>
        <el-form-item label="模型层级">
          <el-select v-model="modelConfigEditForm.tier" style="width: 100%">
            <el-option label="chat" value="chat" />
            <el-option label="reasoning" value="reasoning" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="modelConfigEditForm.model" placeholder="留空使用平台默认" />
        </el-form-item>
        <el-form-item label="思考模式">
          <el-select v-model="modelConfigEditForm.thinkingMode" style="width: 100%">
            <el-option label="跟随模型默认" value="default" />
            <el-option label="开启" value="enabled" />
            <el-option label="关闭" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="思考强度">
          <el-select v-model="modelConfigEditForm.reasoningEffort" :disabled="modelConfigEditForm.thinkingMode === 'disabled'" style="width: 100%">
            <el-option label="跟随模型默认" value="default" />
            <el-option label="high" value="high" />
            <el-option label="max" value="max" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="modelConfigEditForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modelConfigEditDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="modelConfigSaving" @click="saveModelConfig">保存</el-button>
      </template>
    </el-dialog>

    <SkillNodeWorkbench v-model:visible="skillWorkbenchVisible" :skill-id="currentSkillNodeId" @changed="loadRegistry" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Grid, Refresh, Plus } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { adminAgentsApi, adminAgentPromptsApi, adminAxios, adminSkillsApi, type AdminRegistryAgent, type AgentDesignDetail } from '@/api/adminApi';
import SkillNodeWorkbench from './components/SkillNodeWorkbench.vue';
import { toast } from '../../utils/toast';
import { PLATFORM_NODE_SKILLS } from './capabilityCatalog';

const loading = ref(false);
const summary = ref<{ total: number; active24h: number; neverCalled: number; unhealthy: number } | null>(null);
const agents = ref<AdminRegistryAgent[]>([]);
const route = useRoute();
const router = useRouter();
const skillWorkbenchVisible = ref(false);
const currentSkillNodeId = ref('');
const designDrawerVisible = ref(false);
const designLoading = ref(false);
const currentDesign = ref<AgentDesignDetail | null>(null);
const promptDrawerLoading = ref(false);
const promptExpanded = ref(false);
const keyword = ref('');
const nodeKind = ref('');
const lifecycle = ref('');
const health = ref('');
const onlyAttention = ref(false);

interface SkillConfigSummaryRow {
  skillId: string;
  displayName?: string;
  status?: 'working' | 'placeholder' | 'simplified' | 'mock';
  lastCalledAt?: string | null;
  tier: string;
  model?: string;
  enabled: boolean;
}

interface PromptVersionSummary {
  id: string;
  name?: string;
  version?: number | string;
  versionLabel?: string;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

interface PromptSummaryState {
  loading: boolean;
  versionLabel: string;
  status: string;
  statusLabel: string;
  existsWithoutActive: boolean;
}

interface AdminSkillRuntimeInfo {
  name: string;
  version: string;
  category?: string;
  description?: string;
  stats?: {
    callCount?: number;
    successRate?: number;
    avgLatency?: number;
  };
  lastCalledAt?: string | null;
  registeredAt?: string | null;
}

interface AgentModelConfig {
  agentId: string;
  tier: string;
  model?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  endpoint?: string;
  apiKey?: string;
  enabled: boolean;
}

const promptSummaries = ref<Record<string, PromptSummaryState>>({});
const currentPromptActive = ref<PromptVersionSummary | null>(null);
const currentPromptVersions = ref<PromptVersionSummary[]>([]);
const currentPromptSource = ref<'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service'>('code-fallback');

const modelConfigLoading = ref(false);
const currentModelConfig = ref<AgentModelConfig | null>(null);
const modelConfigEditDialogVisible = ref(false);
const modelConfigEditForm = ref<AgentModelConfig>({
  agentId: '',
  tier: 'chat',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  enabled: true
});
const modelConfigSaving = ref(false);

const agentPreviewLoading = ref(false);
const agentPreviewInputText = ref('');
const agentPreviewOutput = ref<any>(null);

const createPromptDialogVisible = ref(false);
const editMode = ref(false);
const editingPromptId = ref<string | null>(null);
const creatingPrompt = ref(false);
const updatingPrompt = ref(false);
const publishingId = ref<string | null>(null);
const promptDetailLoading = ref(false);

const newPromptForm = ref({
  name: '',
  description: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4000
});

const skillNameMap: Record<string, string> = {
  'text-structure-analyzer': '文本结构分析器',
  'retrieval': '内容检索器',
  'web-extractor': '网页内容提取器',
  'image-analyzer': '图片分析器',
  'memory-search': '学习记忆搜索器',
  'smart-search': '智能搜索器',
  'label-generator': '动态标签生成器',
  'adaptive-guidance-copy': '动态引导文案生成器',
  'goal-profile-inference': '目标阶段画像推断器',
  'learning-pattern-distiller': '学习模式蒸馏器',
  'session-knowledge-distiller': '课堂知识蒸馏器',
  'dialogue-concept-extractor': '对话概念抽取器',
  'path-scene-framing': '路径场景构图',
  'stage-designer': '阶段任务设计器',
  'peer-reinforcement': '同伴强化',
  'virtual-learner-persona-designer': '虚拟学习者身份设计器',
  'virtual-learner-scenario-designer': '虚拟学习者故事设计器',
  'virtual-learner-goal-dialogue-simulator': '虚拟学习者 Goal 对话模拟器',
  'virtual-learner-path-evaluator': '虚拟学习者路径评估器',
  'virtual-learner-learn-turn-simulator': '虚拟学习者 Learn 回合模拟器',
};

const statusToHealth = (status?: SkillConfigSummaryRow['status']): AdminRegistryAgent['status'] => {
  if (status === 'working') return 'healthy';
  if (status === 'simplified') return 'warning';
  if (status === 'placeholder' || status === 'mock') return 'error';
  return 'idle';
};

const toSkillRuntimeNode = (skill: SkillConfigSummaryRow, runtimeInfo?: AdminSkillRuntimeInfo): AdminRegistryAgent => {
  const callCount = Number(runtimeInfo?.stats?.callCount || 0);
  const successRate = Number.isFinite(Number(runtimeInfo?.stats?.successRate))
    ? Number((Number(runtimeInfo?.stats?.successRate || 0) * 100).toFixed(1))
    : (skill.status === 'placeholder' || skill.status === 'mock' ? 0 : 100);
  const avgDuration = Number(runtimeInfo?.stats?.avgLatency || 0);
  return {
    agentId: skill.skillId,
    name: skillNameMap[skill.skillId] || skill.displayName || skill.skillId,
    type: skill.tier || runtimeInfo?.category || 'chat',
    role: 'skill',
    kind: 'skill',
    aliases: [],
    lifecycleStatus: 'published',
    status: statusToHealth(skill.status),
    callCount,
    successRate,
    avgDuration,
    lastActivity: runtimeInfo?.lastCalledAt || skill.lastCalledAt || null,
    version: runtimeInfo?.version || '1.0.0',
  };
};

const filteredAgents = computed(() => {
  return agents.value.filter(agent => {
    const byKeyword = !keyword.value || `${agent.agentId} ${agent.name}`.toLowerCase().includes(keyword.value.toLowerCase());
    const byKind = !nodeKind.value || agent.kind === nodeKind.value;
    const byLifecycle = !lifecycle.value || agent.lifecycleStatus === lifecycle.value;
    const byHealth = !health.value || agent.status === health.value;
    const byAttention = !onlyAttention.value || isAttentionAgent(agent);
    return byKeyword && byKind && byLifecycle && byHealth && byAttention;
  });
});

const isAttentionAgent = (agent: AdminRegistryAgent) => {
  return agent.status === 'warning' || agent.status === 'error' || agent.callCount === 0;
};

const loadRegistry = async () => {
  loading.value = true;
  try {
    const [response, skillResponse, skillRuntimeResponse]: any = await Promise.all([
      adminAgentsApi.getRegistry(),
      adminSkillsApi.getSkillModelConfigs(),
      adminAxios.get('/admin/skills'),
    ]);

    const runtimeAgents = response.data.data.agents || [];
    const runtimeSkillList = skillRuntimeResponse.data?.data || [];
    const runtimeSkillMap = new Map<string, AdminSkillRuntimeInfo>(
      (Array.isArray(runtimeSkillList) ? runtimeSkillList : []).map((item: AdminSkillRuntimeInfo) => [item.name, item])
    );
    const skillNodes = ((skillResponse.data?.data || []) as SkillConfigSummaryRow[])
      .filter((skill) => PLATFORM_NODE_SKILLS.has(skill.skillId))
      .map((skill) => toSkillRuntimeNode(skill, runtimeSkillMap.get(skill.skillId)));

    agents.value = [...runtimeAgents, ...skillNodes];
    summary.value = buildAgentSummary(agents.value);
    void loadPromptSummaries(agents.value.filter((item) => item.kind !== 'orchestrator'));
  } catch (error) {
    console.error('加载 Agent 注册列表失败:', error);
    toast.error('加载 Agent 注册列表失败');
  } finally {
    loading.value = false;
  }
};

const normalizePromptRecord = (value: any): PromptVersionSummary | null => {
  if (!value || typeof value !== 'object') return null;
  return {
    id: value.id || value.promptId || '',
    name: value.name,
    version: value.version,
    versionLabel: value.versionLabel,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    publishedAt: value.publishedAt,
    systemPrompt: value.systemPrompt,
    temperature: value.temperature,
    maxTokens: value.maxTokens
  };
};

const formatPromptVersion = (prompt: PromptVersionSummary | null | undefined) => {
  if (!prompt) return '-';
  if (prompt.id === '__code_fallback__') return 'built-in';
  if (prompt.versionLabel) return prompt.versionLabel;
  if (prompt.version !== undefined && prompt.version !== null && prompt.version !== '') return `v${prompt.version}`;
  return '-';
};

const getPromptStatusLabel = (status?: string | null) => {
  if (!status) return '未知';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE') return '已生效';
  if (normalized === 'BUILT_IN') return '代码内置';
  if (normalized === 'ARCHIVED') return '已归档';
  if (normalized === 'DRAFT') return '草稿';
  if (normalized === 'PUBLISHED') return '已发布';
  if (normalized === 'STAGING') return '预发布';
  return '未知';
};

const getPromptStatusTagType = (status?: string | null) => {
  if (!status) return 'info';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'PUBLISHED') return 'success';
  if (normalized === 'BUILT_IN') return 'info';
  if (normalized === 'STAGING') return 'warning';
  if (normalized === 'ARCHIVED') return 'info';
  if (normalized === 'DRAFT') return 'info';
  return 'info';
};

const seedCorePrompts = async () => {
  try {
    const response: any = await adminAgentPromptsApi.seedCorePrompts();
    const created = response.data?.data?.result?.created || [];
    const skipped = response.data?.data?.result?.skipped || [];
    const parts = [];
    if (created.length) parts.push(`已创建 ${created.join('、')}`);
    if (skipped.length) parts.push(`已跳过 ${skipped.join('、')}`);
    toast.success(parts.join('；') || '核心 Prompt 已初始化');
    await loadRegistry();
  } catch (error) {
    console.error('初始化核心 Prompt 失败:', error);
    toast.error('初始化核心 Prompt 失败');
  }
};

const getPromptSummary = (agentId: string) => {
  return promptSummaries.value[agentId];
};

const isNotFoundError = (error: unknown) => {
  return typeof error === 'object'
    && error !== null
    && 'response' in error
    && (error as { response?: { status?: number } }).response?.status === 404;
};

const setPromptSummary = (agentId: string, summary: PromptSummaryState) => {
  promptSummaries.value = {
    ...promptSummaries.value,
    [agentId]: summary
  };
};

const pickBestPrompt = (prompts: PromptVersionSummary[]) => {
  if (!Array.isArray(prompts) || prompts.length === 0) return null;

  const activePrompt = prompts.find(prompt => (prompt.status || '').toUpperCase() === 'ACTIVE');
  if (activePrompt) return activePrompt;

  return prompts[0] || null;
};

const buildCodeFallbackPrompt = (agentId: string): PromptVersionSummary | null => {
  const fallbackMap: Record<string, { name: string; systemPrompt: string; temperature?: number; maxTokens?: number }> = {
    'path-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.5,
      maxTokens: 10000,
    },
    'teaching-turn-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.7,
      maxTokens: 4000,
    },
    'session-wrapup-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.7,
      maxTokens: 4000,
    },
    'skill:peer-reinforcement': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.7,
      maxTokens: 4000,
    }
  };

  const fallback = fallbackMap[agentId];
  if (!fallback) return null;

  return {
    id: '__code_fallback__',
    name: fallback.name,
    versionLabel: 'built-in',
    status: 'BUILT_IN',
    systemPrompt: fallback.systemPrompt,
    temperature: fallback.temperature,
    maxTokens: fallback.maxTokens,
  };
};

const promptSourceLabel = (source: 'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service') => {
  if (source === 'db-active') return '数据库已生效';
  if (source === 'db-versioned-no-active') return '数据库未生效';
  if (source === 'orchestrator-no-direct-prompt') return '不直接管理';
  if (source === 'legacy-service') return '旧服务映射';
  return '代码内置';
};

const formatPromptSourceSummary = (source: 'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service') => {
  if (source === 'db-active') return '当前线上已接管到数据库中的生效版本。';
  if (source === 'db-versioned-no-active') return '数据库里已有版本，但当前还没有明确切到生效版本。';
  if (source === 'orchestrator-no-direct-prompt') return '这条运行定义本身不直接持有单一提示词，请到编排监控或高级编排配置查看。';
  if (source === 'legacy-service') return '当前名称更接近旧服务概念，需要先确认真实运行 ID。';
  return '当前大概率仍走代码内置提示词，适合尽快迁到版本化管理。';
};

const promptSourceTagType = (source: 'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service') => {
  if (source === 'db-active') return 'success';
  if (source === 'db-versioned-no-active') return 'warning';
  if (source === 'orchestrator-no-direct-prompt') return 'warning';
  if (source === 'legacy-service') return 'info';
  return 'info';
};

const getPromptLookupId = (node: AdminRegistryAgent) => {
  if (node.kind === 'skill') {
    if (node.agentId.startsWith('skill:')) {
      return node.agentId;
    }
    return `skill:${node.agentId}`;
  }
  return node.agentId;
};

const getSkillRuntimeName = (nodeId: string) => {
  return nodeId.startsWith('skill:') ? nodeId.slice('skill:'.length) : nodeId;
};

const promptEmptyDescription = computed(() => {
  if (currentPromptSource.value === 'orchestrator-no-direct-prompt') {
    return '当前页面仅展示 Agent，编排器 Prompt 请到 Orchestrator Registry 查看';
  }
  if (currentPromptSource.value === 'legacy-service') {
    return '该条目当前更像旧服务概念，不对应独立的数据库 Prompt 管理';
  }
  if (currentPromptSource.value === 'code-fallback') {
    return '当前 Agent 暂无数据库 Prompt，运行时可能仍使用代码内置 Prompt';
  }
  return '当前 Agent 暂无活跃 Prompt';
});

const loadPromptSummaries = async (registryAgents: AdminRegistryAgent[]) => {
  await Promise.allSettled(
    registryAgents.map(async (agent) => {
      const promptLookupId = getPromptLookupId(agent);
      setPromptSummary(agent.agentId, {
        loading: true,
        versionLabel: '',
        status: '',
        statusLabel: '',
        existsWithoutActive: false
      });

      try {
        const versionsResponse: any = await adminAgentPromptsApi.getPromptVersions({ agentId: promptLookupId });
        const promptList = versionsResponse.data?.data?.list || versionsResponse.data?.data || [];
        const prompts = Array.isArray(promptList)
          ? promptList.map(normalizePromptRecord).filter(Boolean) as PromptVersionSummary[]
          : [];
        const prompt = pickBestPrompt(prompts);

        if (!prompt) {
          if (agent.kind === 'skill') {
            try {
              const effectiveSkillResponse: any = await adminSkillsApi.getEffectiveSkillPrompt(getSkillRuntimeName(agent.agentId));
              const effectiveSource = effectiveSkillResponse.data?.data?.data?.source || effectiveSkillResponse.data?.data?.source || '';

              if (effectiveSource === 'generated-default') {
                setPromptSummary(agent.agentId, {
                  loading: false,
                  versionLabel: 'generated',
                  status: 'GENERATED',
                  statusLabel: '默认草案',
                  existsWithoutActive: false,
                });
                return;
              }

              if (effectiveSource === 'code-fallback') {
                setPromptSummary(agent.agentId, {
                  loading: false,
                  versionLabel: 'built-in',
                  status: 'FALLBACK',
                  statusLabel: '代码内置',
                  existsWithoutActive: false,
                });
                return;
              }

              if (!effectiveSource) {
                setPromptSummary(agent.agentId, {
                  loading: false,
                  versionLabel: '',
                  status: 'PROMPT_MISSING',
                  statusLabel: '缺少 Prompt',
                  existsWithoutActive: false,
                });
                return;
              }
            } catch {
              setPromptSummary(agent.agentId, {
                loading: false,
                versionLabel: '',
                status: 'PROMPT_MISSING',
                statusLabel: '缺少 Prompt',
                existsWithoutActive: false,
              });
              return;
            }
          }

          setPromptSummary(agent.agentId, {
            loading: false,
            versionLabel: '',
            status: '',
            statusLabel: '',
            existsWithoutActive: false
          });
          return;
        }

        setPromptSummary(agent.agentId, {
          loading: false,
          versionLabel: formatPromptVersion(prompt),
          status: prompt.status || '',
          statusLabel: getPromptStatusLabel(prompt.status),
          existsWithoutActive: (prompt.status || '').toUpperCase() !== 'ACTIVE'
        });
      } catch {
        setPromptSummary(agent.agentId, {
          loading: false,
          versionLabel: '',
          status: '',
          statusLabel: '',
          existsWithoutActive: false
        });
      }
    })
  );
};

const loadPromptDetails = async (agentId: string) => {
  promptDrawerLoading.value = true;
  currentPromptActive.value = null;
  currentPromptVersions.value = [];
  currentPromptSource.value = 'code-fallback';
  promptExpanded.value = false;

  const promptManagementMode = currentDesign.value?.runtime.promptManagement?.mode;
  if (promptManagementMode === 'orchestrator-no-direct-prompt') {
    currentPromptSource.value = 'orchestrator-no-direct-prompt';
    promptDrawerLoading.value = false;
    return;
  }

  if (promptManagementMode === 'legacy-service') {
    currentPromptSource.value = 'legacy-service';
    promptDrawerLoading.value = false;
    return;
  }

  try {
    const response: any = await adminAgentPromptsApi.getPromptVersions({ agentId });
    const versions = response.data?.data?.list || response.data?.items || [];
    currentPromptVersions.value = Array.isArray(versions)
      ? versions.map(normalizePromptRecord).filter(Boolean).slice(0, 20) as PromptVersionSummary[]
      : [];

    const bestPrompt = pickBestPrompt(currentPromptVersions.value);
    if (bestPrompt?.id) {
      currentPromptSource.value = ((bestPrompt.status || '').toUpperCase() === 'ACTIVE') ? 'db-active' : 'db-versioned-no-active';
      try {
        const detailResponse: any = await adminAgentPromptsApi.getPromptDetail(bestPrompt.id);
        currentPromptActive.value = normalizePromptRecord(detailResponse.data?.data) || bestPrompt;
      } catch (detailError) {
        if (!isNotFoundError(detailError)) {
          console.error('加载 Prompt 详情失败:', detailError);
        }
        currentPromptActive.value = bestPrompt;
      }
    } else {
      currentPromptActive.value = buildCodeFallbackPrompt(agentId);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error('加载 Prompt 版本列表失败:', error);
      toast.error('加载 Prompt 信息失败');
    } else {
      currentPromptActive.value = buildCodeFallbackPrompt(agentId);
    }
  }

  promptDrawerLoading.value = false;
};

interface SchemaRow {
  path: string;
  type: string;
  required: 'yes' | 'no';
  requiredLabel: string;
  description: string;
  semanticLabel: string;
}

const schemaFieldLabelMap: Record<string, string> = {
  goal: '学习目标',
  metadata: '补充元信息',
  conversationHistory: '对话历史',
  success: '执行结果',
  userVisible: '用户可见回复',
  internal: '内部结构',
  'internal.core': '核心判断',
  'internal.core.stage': '当前阶段',
  'internal.core.confidence': '置信度',
  'internal.core.isCompleted': '是否完成',
  'internal.ext': '扩展结构',
  'internal.ext.goalConversation': '目标对话扩展数据',
  renderHints: '渲染提示',
  schemaVersion: '协议版本'
};

const inferSchemaFieldLabel = (path: string) => {
  if (!path) return '根节点';
  if (schemaFieldLabelMap[path]) return schemaFieldLabelMap[path];
  const leafKey = path.replace(/\[\]$/g, '').split('.').pop() || path;
  if (schemaFieldLabelMap[leafKey]) return schemaFieldLabelMap[leafKey];
  return leafKey
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
};

const buildSchemaPreview = (schema: any): string => {
  const walk = (node: any): any => {
    if (!node || typeof node !== 'object') return 'any';

    if (node.type === 'object' && node.properties) {
      const result: Record<string, any> = {};
      Object.keys(node.properties).forEach((key) => {
        result[key] = walk(node.properties[key]);
      });
      return result;
    }

    if (node.type === 'array') {
      return [walk(node.items || { type: 'any' })];
    }

    if (Array.isArray(node.enum) && node.enum.length > 0) {
      return `${node.type || 'enum'} (${node.enum.join(' | ')})`;
    }

    return node.type || 'any';
  };

  if (!schema) return '暂无协议定义';
  return JSON.stringify(walk(schema), null, 2);
};

const toSchemaRows = (schema: any): SchemaRow[] => {
  if (!schema || typeof schema !== 'object') return [];
  const rows: SchemaRow[] = [];

  const walk = (node: any, path: string, requiredList: string[] = []) => {
    if (!node || typeof node !== 'object') return;
    const props = node.properties || {};
    const currentRequired = Array.isArray(node.required) ? node.required : requiredList;

    for (const key of Object.keys(props)) {
      const child = props[key] || {};
      const childPath = path ? `${path}.${key}` : key;
      rows.push({
        path: childPath,
        type: child.type || (child.properties ? 'object' : 'any'),
        required: currentRequired.includes(key) ? 'yes' : 'no',
        requiredLabel: currentRequired.includes(key) ? '是' : '否',
        description: child.description || '',
        semanticLabel: inferSchemaFieldLabel(childPath)
      });

      if (child.type === 'object' && child.properties) {
        walk(child, childPath, Array.isArray(child.required) ? child.required : []);
      }
      if (child.type === 'array' && child.items && child.items.properties) {
        walk({ properties: child.items.properties, required: child.items.required || [] }, `${childPath}[]`);
      }
    }
  };

  walk(schema, '');
  return rows;
};

const inputSchemaRows = computed(() => toSchemaRows(currentDesign.value?.definition.inputSchema));
const outputSchemaRows = computed(() => toSchemaRows(currentDesign.value?.definition.outputSchema));
const inputSchemaPreview = computed(() => buildSchemaPreview(currentDesign.value?.definition.inputSchema));
const outputSchemaPreview = computed(() => buildSchemaPreview(currentDesign.value?.definition.outputSchema));
const designSurfaceLabel = computed(() => {
  const kind = currentDesign.value?.runtime.kind;
  if (kind === 'orchestrator') return '编排视图';
  if (kind === 'skill') return '能力节点';
  return '运行定义';
});

const prettyJson = (value: any) => {
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value, null, 2);
};

const openDesign = async (agent: AdminRegistryAgent) => {
  designDrawerVisible.value = true;
  designLoading.value = true;
  currentDesign.value = null;
  currentPromptActive.value = null;
  currentPromptVersions.value = [];
  currentModelConfig.value = null;
  promptExpanded.value = false;
  agentPreviewOutput.value = null;
  agentPreviewInputText.value = '';

  const agentId = agent.agentId;

  try {
    const designResponse = await adminAgentsApi.getAgentDesign(agentId);
    currentDesign.value = (designResponse as any).data.data;

    if (currentDesign.value?.samples?.agentCallLogs?.length) {
      const latestLog = currentDesign.value.samples.agentCallLogs[0];
      if (latestLog.input) {
        agentPreviewInputText.value = JSON.stringify(latestLog.input, null, 2);
      }
    }

    const [promptResult, modelConfigResult] = await Promise.allSettled([
      loadPromptDetails(agentId),
      loadModelConfig(agentId)
    ]);

    if (promptResult.status === 'rejected' && !isNotFoundError(promptResult.reason)) {
      console.error('加载 Prompt 信息失败:', promptResult.reason);
    }

    if (modelConfigResult.status === 'rejected' && !isNotFoundError(modelConfigResult.reason)) {
      console.error('加载模型配置失败:', modelConfigResult.reason);
    }
  } catch (error) {
    console.error('加载 Agent 设计失败:', error);
    toast.error('加载 Agent 设计失败');
  } finally {
    designLoading.value = false;
  }
};

const openNode = async (agent: AdminRegistryAgent) => {
  if (agent.kind === 'skill') {
    currentSkillNodeId.value = agent.agentId;
    skillWorkbenchVisible.value = true;
    return;
  }

  await openDesign(agent);
};

const openRequestedAgentFromQuery = async () => {
  const agentId = typeof route.query.agentId === 'string' ? route.query.agentId.trim() : '';
  if (!agentId || !agents.value.length) return;

  const matchedAgent = agents.value.find((item) => item.agentId === agentId);
  if (!matchedAgent) return;

  if (currentDesign.value?.agentId === agentId && designDrawerVisible.value) return;

  await openNode(matchedAgent);

  const nextQuery = { ...route.query };
  delete nextQuery.agentId;
  router.replace({ path: route.path, query: nextQuery });
};

const loadModelConfig = async (agentId: string) => {
  modelConfigLoading.value = true;
  try {
    const response = await adminAxios.get(`/admin/agent-model-configs/${agentId}`);
    currentModelConfig.value = response.data?.data || null;
  } catch (error) {
    currentModelConfig.value = null;
  } finally {
    modelConfigLoading.value = false;
  }
};

const updateModelConfigEnabled = async () => {
  if (!currentModelConfig.value) return;
  try {
    await adminAxios.put(`/admin/agent-model-configs/${currentModelConfig.value.agentId}`, {
      enabled: currentModelConfig.value.enabled
    });
    toast.success('状态已更新');
  } catch (error) {
    toast.error('更新失败');
    currentModelConfig.value.enabled = !currentModelConfig.value.enabled;
  }
};

const runAgentPreview = async () => {
  if (!currentDesign.value?.agentId || !agentPreviewInputText.value.trim()) return;

  let parsedInput: any;
  try {
    parsedInput = JSON.parse(agentPreviewInputText.value);
  } catch {
    toast.error('Sample Input 不是合法 JSON');
    return;
  }

  agentPreviewLoading.value = true;
  try {
    const res = await adminAgentsApi.testAgent(currentDesign.value.agentId, parsedInput);
    agentPreviewOutput.value = res.data?.data?.output ?? null;
  } catch (error: any) {
    toast.error(error?.response?.data?.error || 'Agent 预览失败');
    agentPreviewOutput.value = { error: error?.response?.data?.error || 'Agent 预览失败' };
  } finally {
    agentPreviewLoading.value = false;
  }
};

const openEditModelConfigDialog = () => {
  if (!currentModelConfig.value) return;
  modelConfigEditForm.value = {
    ...currentModelConfig.value,
    thinkingMode: currentModelConfig.value.thinkingMode || 'default',
    reasoningEffort: currentModelConfig.value.reasoningEffort || 'default'
  };
  modelConfigEditDialogVisible.value = true;
};

const saveModelConfig = async () => {
  if (!modelConfigEditForm.value.agentId) return;
  modelConfigSaving.value = true;
  try {
    await adminAxios.put(`/admin/agent-model-configs/${modelConfigEditForm.value.agentId}`, {
      tier: modelConfigEditForm.value.tier,
      model: modelConfigEditForm.value.model,
      thinkingMode: modelConfigEditForm.value.thinkingMode,
      reasoningEffort: modelConfigEditForm.value.reasoningEffort,
      enabled: modelConfigEditForm.value.enabled
    });
    toast.success('配置已更新');
    modelConfigEditDialogVisible.value = false;
    if (currentDesign.value) {
      await loadModelConfig(currentDesign.value.agentId);
    }
  } catch (error) {
    toast.error('保存失败');
  } finally {
    modelConfigSaving.value = false;
  }
};

const thinkingTagType = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return 'warning';
  if (thinkingMode === 'disabled') return 'success';
  return 'info';
};

const effortTagType = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'high') return 'warning';
  if (reasoningEffort === 'max') return 'danger';
  return 'info';
};

const formatThinkingMode = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return '开启';
  if (thinkingMode === 'disabled') return '关闭';
  return '模型默认';
};

const formatReasoningEffort = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'high') return '高强度';
  if (reasoningEffort === 'max') return '最高强度';
  return '模型默认';
};

const formatTime = (time: string | null) => {
  if (!time) return '从未';
  return new Date(time).toLocaleString('zh-CN');
};

const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '-';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

const getLifecycleTagType = (status: string) => {
  if (status === 'published') return 'success';
  if (status === 'staging') return 'warning';
  return 'info';
};

const getLifecycleLabel = (status: string) => {
  if (status === 'published') return '已发布';
  if (status === 'staging') return '预发布';
  if (status === 'draft') return '草稿';
  return status || '未知';
};

const getHealthTagType = (status: string) => {
  if (status === 'healthy') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'error') return 'danger';
  return 'info';
};

const getHealthLabel = (status: string) => {
  if (status === 'healthy') return '健康';
  if (status === 'warning') return '预警';
  if (status === 'error') return '异常';
  if (status === 'idle') return '空闲';
  return status || '未知';
};

const getRuntimeRole = (_agent: AdminRegistryAgent): 'agent' => 'agent';

const getKindLabel = (kind?: string) => {
  if (kind === 'skill') return '主链 Skill';
  if (kind === 'orchestrator') return '编排器';
  if (kind === 'alias') return '兼容别名';
  return 'Agent 节点';
};

const formatTypeLabel = (type?: string) => {
  if (!type) return '-';
  if (type === 'custom') return '自定义';
  if (type === 'system') return '系统';
  return type;
};

const formatCategoryLabel = (category?: string) => {
  if (!category) return '-';
  if (category === 'standard') return '标准';
  return category;
};

const formatRuntimeRoleLabel = (role?: 'agent' | 'orchestrator') => {
  if (role === 'orchestrator') return '编排角色';
  return '执行角色';
};

const formatIoContractLabel = (version?: 'legacy' | 'agent-output-v1') => {
  if (version === 'agent-output-v1') return 'Agent 输出协议 v1';
  if (version === 'legacy') return '历史协议';
  return '-';
};

const formatTierLabel = (tier?: string) => {
  if (tier === 'reasoning') return '推理层';
  if (tier === 'chat') return '对话层';
  return tier || '未配置';
};

const getKindTagType = (kind?: string) => {
  if (kind === 'skill') return 'success';
  if (kind === 'orchestrator') return 'warning';
  if (kind === 'alias') return 'info';
  return 'info';
};

const isLegacyAliasDesign = (design: AgentDesignDetail | null) => {
  if (!design) return false;
  return design.requestedAgentId !== design.agentId;
};

const getRuntimeRoleLabel = (agent: AdminRegistryAgent) => {
  return getRuntimeRole(agent);
};

const getRuntimeRoleTagType = (_agent: AdminRegistryAgent) => 'info';

const rateClass = (rate: number) => {
  if (rate >= 95) return 'rate-good';
  if (rate >= 80) return 'rate-mid';
  return 'rate-bad';
};

const promptPreviewText = computed(() => currentPromptActive.value?.systemPrompt?.trim() || '');

const visiblePromptText = computed(() => {
  const text = promptPreviewText.value;
  if (!text) return '暂无 Prompt 内容';
  if (promptExpanded.value) return text;

  const lines = text.split('\n');
  if (lines.length <= 8) return text;
  return `${lines.slice(0, 8).join('\n')}\n\n...`;
});

const openCreatePromptDialog = () => {
  editMode.value = false;
  editingPromptId.value = null;
  const nextVersion = (Number(currentPromptVersions.value[0]?.version) || 0) + 1;
  newPromptForm.value = {
    name: `v${nextVersion}`,
    description: '',
    systemPrompt: currentPromptActive.value?.systemPrompt || '',
    temperature: 0.7,
    maxTokens: 4000
  };
  createPromptDialogVisible.value = true;
};

const openForkFromActive = () => {
  if (!currentPromptActive.value) return;
  editMode.value = false;
  editingPromptId.value = null;
  const nextVersion = (Number(currentPromptVersions.value[0]?.version) || 0) + 1;
  newPromptForm.value = {
    name: `v${nextVersion}-fork`,
    description: `基于 ${formatPromptVersion(currentPromptActive.value)} 修改`,
    systemPrompt: currentPromptActive.value.systemPrompt || '',
    temperature: 0.7,
    maxTokens: 4000
  };
  createPromptDialogVisible.value = true;
};

const editPromptVersion = async (version: PromptVersionSummary) => {
  promptDetailLoading.value = true;
  
  try {
    const res: any = await adminAgentPromptsApi.getPromptDetail(version.id);
    const prompt = res.data?.data;
    
    if ((version.status || '').toUpperCase() === 'DRAFT') {
      editMode.value = true;
      editingPromptId.value = version.id;
      newPromptForm.value = {
        name: prompt.name || '',
        description: prompt.description || '',
        systemPrompt: prompt.systemPrompt || '',
        temperature: prompt.temperature ?? 0.7,
        maxTokens: prompt.maxTokens ?? 4000
      };
    } else {
      editMode.value = false;
      editingPromptId.value = null;
      const nextVersion = (Number(currentPromptVersions.value[0]?.version) || 0) + 1;
      newPromptForm.value = {
        name: `v${nextVersion}-修改`,
        description: `基于 ${formatPromptVersion(version)} 修改`,
        systemPrompt: prompt.systemPrompt || '',
        temperature: prompt.temperature ?? 0.7,
        maxTokens: prompt.maxTokens ?? 4000
      };
    }
    createPromptDialogVisible.value = true;
  } catch (error) {
    toast.error('加载 Prompt 详情失败');
  } finally {
    promptDetailLoading.value = false;
  }
};

const createPromptDraft = async () => {
  if (!currentDesign.value?.agentId) return;
  if (!newPromptForm.value.name || !newPromptForm.value.systemPrompt) {
    toast.error('请填写版本名称和 System Prompt');
    return;
  }
  
  creatingPrompt.value = true;
  try {
    await adminAgentPromptsApi.createPrompt({
      agentId: currentDesign.value.agentId,
      name: newPromptForm.value.name,
      description: newPromptForm.value.description,
      systemPrompt: newPromptForm.value.systemPrompt,
      temperature: newPromptForm.value.temperature,
      maxTokens: newPromptForm.value.maxTokens
    });
    
    toast.success('Prompt 草稿已创建');
    createPromptDialogVisible.value = false;
    await loadPromptDetails(currentDesign.value.agentId);
  } catch (error) {
    toast.error('创建失败');
  } finally {
    creatingPrompt.value = false;
  }
};

const updatePromptDraft = async () => {
  if (!editingPromptId.value) return;
  if (!newPromptForm.value.name || !newPromptForm.value.systemPrompt) {
    toast.error('请填写版本名称和 System Prompt');
    return;
  }
  
  updatingPrompt.value = true;
  try {
    await adminAgentPromptsApi.updatePrompt(editingPromptId.value, {
      name: newPromptForm.value.name,
      description: newPromptForm.value.description,
      systemPrompt: newPromptForm.value.systemPrompt,
      temperature: newPromptForm.value.temperature,
      maxTokens: newPromptForm.value.maxTokens
    });
    
    toast.success('草稿已更新');
    createPromptDialogVisible.value = false;
    await loadPromptDetails(currentDesign.value?.agentId || '');
  } catch (error) {
    toast.error('更新失败');
  } finally {
    updatingPrompt.value = false;
  }
};

const createAndPublishPrompt = async () => {
  if (!currentDesign.value?.agentId) return;
  if (!newPromptForm.value.name || !newPromptForm.value.systemPrompt) {
    toast.error('请填写版本名称和 System Prompt');
    return;
  }
  
  creatingPrompt.value = true;
  try {
    const createRes: any = await adminAgentPromptsApi.createPrompt({
      agentId: currentDesign.value.agentId,
      name: newPromptForm.value.name,
      description: newPromptForm.value.description,
      systemPrompt: newPromptForm.value.systemPrompt,
      temperature: newPromptForm.value.temperature,
      maxTokens: newPromptForm.value.maxTokens
    });
    
    const newPromptId = createRes.data?.id || createRes.data?.data?.id;
    if (newPromptId) {
      await adminAgentPromptsApi.publishPrompt(newPromptId);
      toast.success('已创建并发布');
      createPromptDialogVisible.value = false;
      await loadPromptDetails(currentDesign.value.agentId);
    } else {
      toast.error('创建失败，未获取到 Prompt ID');
    }
  } catch (error) {
    toast.error('创建或发布失败');
  } finally {
    creatingPrompt.value = false;
  }
};

const publishPromptVersion = async (promptId: string) => {
  publishingId.value = promptId;
  try {
    await adminAgentPromptsApi.publishPrompt(promptId);
    toast.success('已发布此版本');
    await loadPromptDetails(currentDesign.value?.agentId || '');
  } catch (error) {
    toast.error('发布失败');
  } finally {
    publishingId.value = null;
  }
};

const deletePromptDraft = async (promptId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此版本？此操作不可恢复。', '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    
    await adminAgentPromptsApi.deletePrompt(promptId);
    toast.success('已删除');
    await loadPromptDetails(currentDesign.value?.agentId || '');
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error('删除失败');
    }
  }
};

const buildAgentSummary = (items: AdminRegistryAgent[]) => {
  const now = Date.now();
  const active24h = items.filter((a) => a.lastActivity && (now - new Date(a.lastActivity).getTime()) <= 24 * 3600000).length;
  const neverCalled = items.filter((a) => !a.callCount).length;
  const unhealthy = items.filter((a) => a.status === 'warning' || a.status === 'error').length;
  return {
    total: items.length,
    active24h,
    neverCalled,
    unhealthy,
  };
};

onMounted(async () => {
  await loadRegistry();
  await openRequestedAgentFromQuery();
});

watch(
  () => [route.query.agentId, agents.value.length] as const,
  async () => {
    await openRequestedAgentFromQuery();
  }
);
</script>

<style scoped>
.agent-registry-page {
  padding: 1.25rem;
  position: relative;
}

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 24px; border: 1px solid rgba(205, 216, 238, 0.9); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94)); backdrop-filter: blur(16px); margin-bottom: 16px; box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08); }
.page-hero__title.admin-page-title { margin: 8px 0 0; font-size: 1.6rem; font-weight: 700; color: #22344d; letter-spacing: -0.03em; display: flex; align-items: center; gap: 8px; }
.admin-page-title__icon { font-size: 1.25rem; color: var(--color-primary); }
.page-hero__subtitle { margin: 6px 0 0; color: #62758f; font-size: 0.95rem; line-height: 1.65; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: rgba(52, 120, 246, 0.08); color: #2d6df2; font-size: 12px; font-weight: 700; }


.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card { border-radius: 18px; border: 1px solid rgba(205, 216, 238, 0.9); background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 255, 0.96)); box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08); overflow: hidden; }
.registry-btn,
.table-link-btn {
  border-radius: 14px;
  font-weight: 700;
}

.registry-btn--primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
}

.registry-btn--ghost {
  color: #335aa4;
  border: 1px solid rgba(52, 120, 246, 0.2);
  background: rgba(255, 255, 255, 0.92);
}

.table-link-btn {
  min-height: 30px;
  padding: 0 12px;
  color: var(--color-primary-dark, #1f57cc);
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(244, 249, 255, 0.96);
}

.registry-btn--primary:hover,
.registry-btn--ghost:hover,
.table-link-btn:hover {
  transform: translateY(-1px);
}

.summary-card .label {
  font-size: 0.75rem;
  color: #7b8ba3;
  font-weight: 600;
}

.summary-card .value {
  font-size: 2rem;
  font-weight: 800;
  margin-top: 0.35rem;
  color: #22344d;
  line-height: 1;
  letter-spacing: -0.04em;
}

.summary-card .value.danger {
  color: var(--color-danger);
}

.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--orange .value { color: #ea580c; }
.summary-card--red .value { color: #dc2626; }

.admin-list-card {
  width: 100%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 0.75rem;
  position: relative;
  z-index: 1;
  backdrop-filter: blur(20px);
  box-shadow: 0 18px 40px rgba(42, 72, 128, 0.1);
}

.admin-list-card :deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

.admin-list-card :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
  font-size: 0.8125rem;
  color: #7085a6;
}

.admin-list-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.015);
}

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

.admin-list-card :deep(.el-table .el-table__row) {
  position: relative;
}

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell:first-child::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #3478f6, #8d6bff);
}

.admin-list-card :deep(.el-table td.el-table__cell) {
  border-bottom-color: rgba(52, 120, 246, 0.04);
}

.filters {
  margin-bottom: 1rem;
  padding: 16px 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 255, 0.92));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
}

.search {
  width: 220px;
}

.select {
  width: 120px;
}

.rate-good {
  color: #16a34a;
  font-weight: 700;
}

.rate-mid {
  color: #ea580c;
  font-weight: 600;
}

.rate-bad {
  color: #dc2626;
  font-weight: 700;
}

.type-cell {
  white-space: nowrap;
}

.agent-cell {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.agent-cell__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.agent-cell__name {
  color: #22344d;
  font-size: 0.95rem;
  line-height: 1.3;
}

.agent-cell__id,
.agent-cell__meta {
  color: #73839a;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-cell {
  display: grid;
  gap: 6px;
}

.status-cell__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-cell__label {
  min-width: 28px;
  color: #7b8ba3;
  font-size: 0.75rem;
  font-weight: 600;
}

.metrics-cell {
  display: grid;
  gap: 4px;
}

.metrics-cell__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #22344d;
  font-size: 12px;
}

.metrics-cell__row--sub {
  color: #73839a;
}

.prompt-cell {
  display: grid;
  gap: 6px;
}

.prompt-cell__version {
  color: #22344d;
  font-size: 0.9rem;
  font-weight: 700;
}

.prompt-cell__muted {
  color: #8b9ab0;
  font-size: 12px;
}

:deep(.summary-card .el-card__body) {
  padding: 16px 18px;
}

:deep(.filters .el-input__wrapper),
:deep(.filters .el-select__wrapper) {
  border-radius: 12px;
}

.design-drawer {
  padding-right: 0.4rem;
  display: grid;
  gap: 16px;
}

.design-masthead {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: 18px;
  padding: 22px 24px;
  border-radius: 28px;
  border: 1px solid rgba(196, 210, 236, 0.95);
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(243, 247, 255, 0.96));
  box-shadow: 0 18px 42px rgba(42, 72, 128, 0.1);
}

.design-masthead__main,
.design-masthead__status {
  min-width: 0;
}

.design-masthead__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.design-masthead__title-row h3 {
  margin: 0;
  font-size: 1.65rem;
  line-height: 1.2;
  color: #22344d;
  letter-spacing: -0.03em;
}

.design-masthead__subtitle {
  margin: 10px 0 0;
  color: #62758f;
  line-height: 1.7;
  max-width: 760px;
}

.design-masthead__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 16px;
  color: #7085a6;
  font-size: 0.875rem;
}

.design-masthead__status {
  display: grid;
  gap: 12px;
}

.design-signal-card,
.design-panel,
.runtime-glance-card,
.overview-strip-card,
.story-card,
.flow-story-step {
  border: 1px solid rgba(205, 216, 238, 0.86);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
}

.design-signal-card {
  border-radius: 22px;
  padding: 16px 18px;
  display: grid;
  gap: 10px;
}

.design-signal-card__label,
.runtime-glance-card__label,
.kv-item__label,
.overview-strip-card__label,
.story-card__label {
  color: #7b8ba3;
  font-size: 0.78rem;
  font-weight: 700;
}

.design-signal-card strong,
.overview-strip-card strong,
.story-card strong {
  color: #22344d;
  font-size: 1rem;
  line-height: 1.35;
}

.design-signal-card p,
.design-panel__header p,
.runtime-glance-card p,
.overview-strip-card p,
.story-card p,
.flow-story-step__body p,
.flow-story-step__body span {
  margin: 0;
  color: #7085a6;
  font-size: 0.875rem;
  line-height: 1.6;
}

.design-banner {
  margin-top: -2px;
}

.design-overview-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.overview-strip-card {
  border-radius: 20px;
  padding: 16px 18px;
  display: grid;
  gap: 8px;
}

.design-layout-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr);
  gap: 16px;
}

.design-layout-grid__main,
.design-layout-grid__aside {
  display: grid;
  gap: 16px;
  align-content: start;
}

.design-panel {
  border-radius: 22px;
  padding: 18px 20px;
}

.design-panel--story {
  padding-bottom: 20px;
}

.design-panel--aside {
  position: sticky;
  top: 0;
}

.design-panel--chips {
  padding-bottom: 16px;
}

.design-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.design-panel__header--tight {
  margin-bottom: 10px;
}

.design-panel__header h4 {
  margin: 0;
  color: #22344d;
  font-size: 1rem;
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.story-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 0.9fr));
  gap: 12px;
}

.story-card {
  border-radius: 18px;
  padding: 16px;
  display: grid;
  gap: 8px;
}

.story-card--primary {
  background:
    radial-gradient(circle at top left, rgba(52, 120, 246, 0.14), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(243, 247, 255, 0.97));
}

.kv-item {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(245, 248, 255, 0.82);
  border: 1px solid rgba(214, 223, 239, 0.86);
}

.kv-item__value {
  color: #22344d;
  font-size: 0.95rem;
  line-height: 1.5;
  word-break: break-word;
}

.runtime-glance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.runtime-glance-grid--stacked {
  grid-template-columns: minmax(0, 1fr);
}

.runtime-glance-card {
  border-radius: 16px;
  padding: 14px 16px;
  display: grid;
  gap: 8px;
}

.runtime-glance-card strong {
  color: #22344d;
  line-height: 1.5;
}

.design-inline-note {
  margin-top: 12px;
}

.flow-story-rail {
  display: grid;
  gap: 10px;
}

.flow-story-step {
  border-radius: 18px;
  padding: 14px 16px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.flow-story-step__index {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.14), rgba(141, 107, 255, 0.16));
  color: #2350b8;
  font-weight: 800;
}

.flow-story-step__body {
  display: grid;
  gap: 4px;
}

.flow-story-step__body strong {
  color: #22344d;
  line-height: 1.45;
  word-break: break-word;
}

.chip-section {
  margin-top: 0;
  padding: 0;
  background: transparent;
  border-radius: 0;
}

.chip-section--contract {
  display: grid;
  gap: 12px;
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.chip-row:last-child {
  margin-bottom: 0;
}

.chip-row--stacked {
  align-items: flex-start;
  margin-bottom: 0;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.chip-label {
  min-width: 84px;
  color: #7b8ba3;
  font-size: 0.78rem;
  font-weight: 700;
}

.empty {
  color: #8b9ab0;
}

.design-tabs {
  margin-top: 2px;
}

.design-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}

.design-tabs :deep(.el-tabs__item) {
  font-weight: 700;
}

.protocol-panel {
  display: grid;
  gap: 14px;
}

.protocol-overview-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.1fr);
  gap: 14px;
}

.protocol-tip-card,
.protocol-json-card {
  min-height: 100%;
}

.protocol-tip-list {
  margin: 0;
  padding-left: 18px;
  color: #62758f;
  line-height: 1.7;
}

.protocol-tip-list li + li {
  margin-top: 6px;
}

.protocol-json-card .sample-json {
  margin: 0;
}

.sample-block {
  margin-bottom: 1rem;
}

.sample-block h4 {
  margin: 0 0 0.55rem;
  color: var(--text-primary);
}

.sample-json {
  font-family: monospace;
  font-size: 0.75rem;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 1rem;
  border-radius: var(--radius-md);
  overflow: auto;
  max-height: 300px;
}

.sample-call-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  margin-bottom: 12px;
  color: #7085a6;
  font-size: 0.85rem;
}

.prompt-panel {
  display: grid;
  gap: 1rem;
  min-height: 200px;
  min-width: 0;
}

.prompt-summary-card,
.prompt-text-card,
.prompt-versions-card {
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 0.9rem;
  min-width: 0;
  overflow: hidden;
}

.prompt-summary-card {
  display: grid;
  gap: 0.7rem;
}

.prompt-summary-card__row,
.prompt-text-card__header,
.prompt-versions-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.prompt-summary-card__label,
.prompt-versions-card__meta {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.prompt-text-card__header h4,
.prompt-versions-card__header h4 {
  margin: 0;
  color: var(--text-primary);
}

.prompt-text-card__content {
  margin-top: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

.prompt-versions-table {
  margin-top: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

:deep(.prompt-versions-table .el-table) {
  width: 100%;
  min-width: 0;
}

:deep(.prompt-versions-table .el-table__inner-wrapper) {
  min-width: 0;
}

:deep(.prompt-versions-table .el-table__body-wrapper) {
  overflow-x: auto;
}

.prompt-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.prompt-notice {
  margin-bottom: 0.25rem;
}

.prompt-actions .el-button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.prompt-versions-table :deep(.el-table__fixed-right) {
  background: rgba(255, 255, 255, 0.72);
}

.prompt-versions-table :deep(.el-button + .el-button) {
  margin-left: 0.25rem;
}

.params-cell {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.model-config-panel {
  padding: 0.25rem 0 0;
}

.model-config-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
  border: 1px solid rgba(205, 216, 238, 0.86);
  border-radius: 18px;
  padding: 1rem 1rem 0.9rem;
  margin-bottom: 1rem;
}

.model-config-card__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.model-config-card__label {
  color: var(--text-secondary);
  font-size: 0.875rem;
  min-width: 80px;
}

.model-config-edit-btn {
  margin-top: 0.5rem;
}

.contract-grid--preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.contract-card {
  padding: 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--glass-bg-light);
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  overflow: hidden;
}

.contract-card .chip-label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #7085a6;
  margin-bottom: 0.5rem;
  display: block;
}

.preview-textarea :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.875rem;
  border-radius: 16px;
  background: rgba(52, 120, 246, 0.03);
  border-color: rgba(52, 120, 246, 0.08);
}

@media (max-width: 960px) {
  .design-masthead,
  .design-overview-strip,
  .design-layout-grid,
  .protocol-overview-grid,
  .story-grid,
  .kv-grid,
  .runtime-glance-grid,
  .contract-grid--preview {
    grid-template-columns: minmax(0, 1fr);
  }

  .design-masthead {
    padding: 18px;
  }

  .design-panel {
    padding: 16px;
  }

  .design-panel--aside {
    position: static;
  }

  .chip-row--stacked {
    flex-direction: column;
    gap: 8px;
  }

  .chip-label {
    min-width: 0;
  }
}

</style>
