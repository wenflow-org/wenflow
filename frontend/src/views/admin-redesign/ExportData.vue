<template>
  <div class="mk-page">
    <div class="mk-status mk-status--ok">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">数据导出</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">CSV 下载 · UTF-8（Excel 可直接打开）</span>
    </div>

    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">业务数据</h4>
        <span class="mk-card__meta">导出前请确认数据范围</span>
      </div>
      <div class="ex-body">
        <div v-for="item in exports" :key="item.key" class="ex-row">
          <div class="ex-row__text">
            <strong>{{ item.label }}</strong>
            <span>{{ item.desc }}</span>
          </div>
          <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting === item.key" @click="doExport(item.key)">
            {{ exporting === item.key ? '导出中…' : '导出 CSV' }}
          </button>
        </div>
      </div>
    </section>

    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">观测与审计</h4>
        <span class="mk-card__meta">执行日志与审计日志行数较多，导出前可选限制</span>
      </div>
      <div class="ex-body">
        <div v-for="item in auditExports" :key="item.key" class="ex-row">
          <div class="ex-row__text">
            <strong>{{ item.label }}</strong>
            <span>{{ item.desc }}</span>
          </div>
          <div class="ex-row__actions">
            <select v-model="limits[item.key]" class="mk-filter__select" :disabled="exporting === item.key">
              <option :value="1000">1000 行</option>
              <option :value="5000">5000 行</option>
              <option :value="20000">20000 行</option>
            </select>
            <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting === item.key" @click="doExport(item.key)">
              {{ exporting === item.key ? '导出中…' : '导出 CSV' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">导出说明</h4>
      </div>
      <div class="ex-body ex-notes">
        <ul>
          <li>导出的 CSV 带 UTF-8 BOM，Excel / WPS 双击可直接打开，中文不乱码。</li>
          <li>执行日志默认导出最近 1000 条，可切换行数上限；其余业务表导出最近 20000 条。</li>
          <li>用户导出默认排除虚拟学习者与测试账号；如需全量请在后端接口加 includeTest=1。</li>
          <li>导出为只读操作，不产生审计记录；敏感字段（密码哈希、API Key）一律不包含。</li>
        </ul>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { errMsg } from './live'
import { adminAxios } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface ExportDef {
  key: string
  label: string
  desc: string
  limit?: boolean
}

const exports: ExportDef[] = [
  { key: 'users', label: '用户', desc: '全部真实用户：ID / 姓名 / 邮箱 / 角色 / XP / 等级 / 注册与登录时间' },
  { key: 'teaching-sessions', label: '教学会话', desc: '会话：学科 / 主题 / 任务类型 / 模式 / 状态 / 时长 / 起止时间' },
  { key: 'feedback', label: '用户反馈', desc: '反馈：评分 / 难度 / 评论 / 处理状态 / 时间' },
  { key: 'goal-conversations', label: '目标对话', desc: '目标澄清：状态 / 阶段 / 描述 / 创建与更新时间' },
]

const auditExports: ExportDef[] = [
  { key: 'agent-logs', label: '执行日志', desc: 'Agent 调用：成功 / 耗时 / 错误码与分类 / 模型 / Token', limit: true },
  { key: 'audit-logs', label: '审计日志', desc: '管理操作审计：动作 / 目标 / 方法 / 路径 / 状态码 / IP', limit: true },
]

/* 默认值必须落在下拉选项集内（1000/5000/20000），否则 select 初始显示空白 */
const limits = reactive<Record<string, number>>({ 'agent-logs': 1000, 'audit-logs': 1000 })
const exporting = ref('')

async function doExport(key: string) {
  exporting.value = key
  try {
    const limit = limits[key]
    const params = limit ? `?limit=${limit}` : ''
    const response = await adminAxios.get(`/admin/export/${key}${params}`, { responseType: 'blob' })
    const disposition = String(response.headers['content-disposition'] || '')
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    const filename = match ? decodeURIComponent(match[1]) : `${key}-${Date.now()}.csv`
    const url = URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('导出成功，已开始下载')
  } catch (e) {
    toast.error(`导出失败：${errMsg(e)}`)
  } finally {
    exporting.value = ''
  }
}
</script>

<style scoped>
.ex-body { padding: 8px 14px 12px; display: grid; gap: 2px; }
.ex-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 2px;
  border-bottom: 1px solid #f6f7f9;
  flex-wrap: wrap;
}
.ex-row:last-child { border-bottom: none; }
.ex-row__text { display: grid; gap: 2px; min-width: 0; }
.ex-row__text strong { font-size: 13px; }
.ex-row__text span { font-size: 12px; color: var(--mk-muted); max-width: 640px; }
.ex-row__actions { display: flex; align-items: center; gap: 8px; }
.ex-row__actions .mk-filter__select { min-width: 110px; height: 30px; padding: 3px 8px; }

.ex-notes ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 12.5px; color: var(--mk-muted); }

@media (min-width: 2000px) {
  .ex-row__text strong { font-size: 14.5px; }
  .ex-row__text span { font-size: 13.5px; }
}
</style>
