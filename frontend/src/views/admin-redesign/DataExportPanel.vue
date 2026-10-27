<template>
  <!-- 数据导出面板（原「系统工具」页 Tab2；2026-10-16 用户拍板该场景解散并入运营中心：
       本组件作为运营中心宿主的一个页签体渲染，id/role=tabpanel/aria-labelledby 由宿主透传落到本根节点）。
       原型表单形态：范围 chips 多选 + 右对齐「开始导出」；时间范围 / JSONL 格式后端导出接口不支持，
       不渲染假控件。 -->
  <div class="exp-body">
    <div class="mk-field">
      <span class="mk-field__label">导出范围</span>
      <div class="mk-pills" role="group" aria-label="导出范围多选">
        <button
          v-for="item in exportDefs"
          :key="item.key"
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': exportSel.includes(item.key) }"
          :aria-pressed="exportSel.includes(item.key)"
          :title="item.desc"
          :disabled="exporting !== ''"
          @click="toggleExport(item.key)"
        >{{ item.label }}</button>
      </div>
    </div>
    <!-- label 包裹而非 div（审核 #176）：与同页另三处 .mk-field 同构，select 拿到可访问名 -->
    <label v-if="exportSel.some((k) => LOG_EXPORT_KEYS.has(k))" class="mk-field exp-limit">
      <span class="mk-field__label">日志行数上限</span>
      <MkSelect
        v-model="logLimit"
        :options="LOG_LIMIT_OPTIONS"
        aria-label="日志行数上限"
        :disabled="exporting !== ''"
      />
    </label>
    <div class="exp-foot">
      <span class="exp-hint">已选 {{ exportSel.length }} 项</span>
      <button
        type="button"
        class="mk-btn mk-btn--primary exp-go"
        :disabled="!exportSel.length || exporting !== ''"
        @click="runExport"
      >{{ exporting !== '' ? '导出中…' : '开始导出' }}</button>
    </div>
    <ul class="exp-notes">
      <li>导出为只读操作，不含敏感字段。</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { errMsg } from './live'
import { adminAxios } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { askConfirm } from './useConfirm'
import MkSelect from '@/components/mk/MkSelect.vue'

/* 数据导出（原「系统工具」页 Tab2 整体迁入，2026-10-16）：多表 CSV 快照导出。
   各列表页有就地导出（导出本页/选中项），这里是「一次勾多张表打包拿快照」的唯一入口。 */

interface ExportDef {
  key: string
  label: string
  desc: string
}

const exportDefs: ExportDef[] = [
  { key: 'users', label: '用户', desc: '全部账号（不含虚拟学习者）：ID / 姓名 / 邮箱 / 角色 / XP / 等级 / 注册与登录时间' },
  { key: 'teaching-sessions', label: '教学会话', desc: '会话：学科 / 主题 / 任务类型 / 模式 / 状态 / 时长 / 起止时间' },
  { key: 'feedback', label: '用户反馈', desc: '反馈：评分 / 难度 / 评论 / 处理状态 / 时间' },
  { key: 'goal-conversations', label: '目标对话', desc: '目标澄清：状态 / 阶段 / 描述 / 创建与更新时间' },
  { key: 'agent-logs', label: '执行日志', desc: 'Agent 调用：成功 / 耗时 / 错误码与分类 / 模型 / Token' },
  { key: 'audit-logs', label: '审计日志', desc: '管理操作审计：动作 / 目标 / 方法 / 路径 / 状态码 / IP' },
]

/** 只有日志类导出支持行数上限（后端 ?limit=）；业务表固定最近 20000 条 */
const LOG_EXPORT_KEYS = new Set(['agent-logs', 'audit-logs'])
const logLimit = ref<number>(1000)
const LOG_LIMIT_OPTIONS = [
  { value: 1000, label: '1000 行' },
  { value: 5000, label: '5000 行' },
  { value: 20000, label: '20000 行' }
]

const exportSel = ref<string[]>([])
function toggleExport(key: string) {
  exportSel.value = exportSel.value.includes(key)
    ? exportSel.value.filter((k) => k !== key)
    : [...exportSel.value, key]
}

const exporting = ref('')

async function doExport(key: string) {
  exporting.value = key
  try {
    const params = LOG_EXPORT_KEYS.has(key) ? `?limit=${logLimit.value}` : ''
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

/** 顺序导出所选项（共用 exporting 守卫，按钮同时禁用防并发）。
    审核 #177：先快照数组再遍历——此前 for…of 直接迭代 ref，导出中途改选会改到本次导出集，
    与实时变的「已选 N 项」提示不一致（chips 现已随 exporting 禁用，快照是第二道保险）。 */
async function runExport() {
  const keys = [...exportSel.value]
  if (!keys.length) return
  /* 导出口径写进确认框：勾选多表时用户未必记得「日志按行数、业务表固定 2 万条」的差异，
     且导出文件含邮箱/IP 等个人数据，落盘前明确范围与用途。 */
  const labels = keys.map((k) => exportDefs.find((d) => d.key === k)?.label || k)
  const logKeys = keys.filter((k) => LOG_EXPORT_KEYS.has(k))
  const ranges: string[] = []
  if (logKeys.length) ranges.push(`日志类最近 ${logLimit.value} 行`)
  if (keys.length > logKeys.length) ranges.push('业务表最近 20000 条')
  const ok = await askConfirm({
    title: '确认导出',
    message: `将导出 ${labels.join('、')}（共 ${keys.length} 项，${ranges.join('，')}）。文件含账号联系方式与操作日志，请按数据安全规范保存。`,
    confirmText: '开始导出',
  })
  if (!ok) return
  for (const key of keys) {
    if (exporting.value !== '') return
    await doExport(key)
  }
}
</script>

<style scoped>
.exp-body {
  padding: 16px;
  display: grid;
  gap: 16px;
  align-content: start;
}
.exp-limit { max-width: 320px; }
.exp-foot { display: flex; align-items: center; gap: 12px; }
.exp-go { margin-left: auto; }
.exp-hint { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.exp-notes {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--mk-line);
  display: grid;
  gap: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
</style>
