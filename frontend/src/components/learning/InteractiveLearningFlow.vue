<template>
  <div class="interactive-learning-flow">
    <div class="progress-indicator">
      <el-steps :active="currentStepIndex" simple finish-status="success">
        <el-step title="激活" :description="stepStatus.activation" />
        <el-step title="学习" :description="stepStatus.learning" />
        <el-step title="检查" :description="stepStatus.check" />
      </el-steps>
    </div>
    
    <div class="content-area">
      <transition name="slide-fade" mode="out-in">
        <ActivationCard
          v-if="stage === 'ACTIVATION'"
          key="activation"
          :question="sessionData.activationQuestion"
          @submit="handleActivationSubmit"
          @skip="handleActivationSkip"
        />
        
        <ContentSegment
          v-else-if="isSegmentStage"
          :key="`segment-${currentSegmentIndex}`"
          :content="currentSegment?.content || ''"
          :thinkingPause="currentSegment?.thinkingPause"
          @submitResponse="handleSegmentResponse"
          @continue="handleSegmentContinue"
        />
        
        <UnderstandingCheck
          v-else-if="stage === 'CHECK'"
          key="check"
          ref="checkRef"
          :question="checkQuestion"
          @check="handleCheck"
          @review="handleReview"
          @complete="handleComplete"
        />
        
        <div v-else-if="stage === 'COMPLETED'" key="completed" class="completed-area">
          <div class="completed-icon">
            <el-icon><SuccessFilled /></el-icon>
          </div>
          <h2>学习完成</h2>
          <p>你已经完成了本次学习内容</p>
          <el-button type="primary" size="large" @click="restart">
            开始新的学习
          </el-button>
        </div>
      </transition>
    </div>

    <div v-if="showNavigation" class="navigation-area">
      <el-button 
        v-if="canGoBack"
        text
        @click="goBack"
      >
        <el-icon><ArrowLeft /></el-icon>
        上一步
      </el-button>
      <div class="progress-info">
        <el-progress 
          :percentage="progressPercentage" 
          :stroke-width="8"
          :show-text="false"
        />
        <span class="progress-text">{{ currentStepIndex + 1 }} / {{ totalSteps }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { SuccessFilled, ArrowLeft } from '@element-plus/icons-vue'
import ActivationCard from './ActivationCard.vue'
import ContentSegment from './ContentSegment.vue'
import UnderstandingCheck from './UnderstandingCheck.vue'

type Stage = 'ACTIVATION' | 'SEGMENT_1' | 'SEGMENT_2' | 'SEGMENT_3' | 'CHECK' | 'COMPLETED'

interface ThinkingPause {
  question: string
  type: 'open' | 'choice'
  options?: string[]
}

interface ContentSegmentData {
  content: string
  thinkingPause?: ThinkingPause
}

interface SessionData {
  activationQuestion: string
  segments: ContentSegmentData[]
  checkQuestion: string
}

interface Props {
  data?: SessionData
  showNavigation?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  data: () => ({
    activationQuestion: '你对这个主题有什么了解？',
    segments: [
      {
        content: '### 第一段内容\n\n这是第一段学习内容，介绍基础概念。\n\n- 要点一\n- 要点二\n- 要点三',
        thinkingPause: {
          question: '你觉得这些概念之间有什么联系？',
          type: 'open'
        }
      },
      {
        content: '### 第二段内容\n\n这是第二段学习内容，深入讲解核心原理。\n\n```javascript\nconst example = "code block";\n```',
        thinkingPause: {
          question: '以下哪些是正确的说法？',
          type: 'choice',
          options: ['选项 A', '选项 B', '选项 C', '选项 D']
        }
      },
      {
        content: '### 第三段内容\n\n这是第三段学习内容，总结实践应用。\n\n> 重要提示：实践是学习的关键！'
      }
    ],
    checkQuestion: '请用自己的话总结今天学到的内容？'
  }),
  showNavigation: true
})

const emit = defineEmits<{
  activationSubmit: [response: string]
  activationSkip: []
  segmentResponse: [segmentIndex: number, response: string]
  segmentContinue: [segmentIndex: number]
  check: [answer: string]
  review: []
  complete: []
  restart: []
}>()

const stage = ref<Stage>('ACTIVATION')
const sessionData = ref<SessionData>(props.data)
const userResponses = ref<string[]>([])
const checkRef = ref<InstanceType<typeof UnderstandingCheck> | null>(null)

const stages: Stage[] = ['ACTIVATION', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3', 'CHECK', 'COMPLETED']

const currentSegmentIndex = computed(() => {
  if (stage.value === 'SEGMENT_1') return 0
  if (stage.value === 'SEGMENT_2') return 1
  if (stage.value === 'SEGMENT_3') return 2
  return -1
})

const currentSegment = computed(() => {
  if (currentSegmentIndex.value >= 0 && sessionData.value.segments[currentSegmentIndex.value]) {
    return sessionData.value.segments[currentSegmentIndex.value]
  }
  return null
})

const isSegmentStage = computed(() => 
  ['SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3'].includes(stage.value)
)

const currentStepIndex = computed(() => {
  switch (stage.value) {
    case 'ACTIVATION':
      return 0
    case 'SEGMENT_1':
    case 'SEGMENT_2':
    case 'SEGMENT_3':
      return 1
    case 'CHECK':
      return 2
    case 'COMPLETED':
      return 3
    default:
      return 0
  }
})

const totalSteps = computed(() => 4)

const progressPercentage = computed(() => {
  return Math.round((currentStepIndex.value / (totalSteps.value - 1)) * 100)
})

const checkQuestion = computed(() => sessionData.value.checkQuestion)

const canGoBack = computed(() => {
  const currentIndex = stages.indexOf(stage.value)
  return currentIndex > 0 && stage.value !== 'COMPLETED'
})

const stepStatus = computed(() => ({
  activation: stage.value === 'ACTIVATION' ? '进行中' : 
              stages.indexOf(stage.value) > 0 ? '已完成' : '',
  learning: isSegmentStage.value ? `第 ${currentSegmentIndex.value + 1} 段` :
           stages.indexOf(stage.value) > 3 ? '已完成' : '',
  check: stage.value === 'CHECK' ? '进行中' : 
         stage.value === 'COMPLETED' ? '已完成' : ''
}))

const nextStage = () => {
  const currentIndex = stages.indexOf(stage.value)
  if (currentIndex < stages.length - 1) {
    stage.value = stages[currentIndex + 1]
  }
}

const goBack = () => {
  const currentIndex = stages.indexOf(stage.value)
  if (currentIndex > 0) {
    stage.value = stages[currentIndex - 1]
  }
}

const handleActivationSubmit = (response: string) => {
  userResponses.value.push(response)
  emit('activationSubmit', response)
  nextStage()
}

const handleActivationSkip = () => {
  emit('activationSkip')
  nextStage()
}

const handleSegmentResponse = (response: string) => {
  if (currentSegmentIndex.value >= 0) {
    userResponses.value.push(response)
    emit('segmentResponse', currentSegmentIndex.value, response)
  }
}

const handleSegmentContinue = () => {
  if (currentSegmentIndex.value >= 0) {
    emit('segmentContinue', currentSegmentIndex.value)
  }
  nextStage()
}

const handleCheck = (answer: string) => {
  userResponses.value.push(answer)
  emit('check', answer)
}

const handleReview = () => {
  emit('review')
  stage.value = 'SEGMENT_1'
}

const handleComplete = () => {
  emit('complete')
  nextStage()
}

const restart = () => {
  stage.value = 'ACTIVATION'
  userResponses.value = []
  emit('restart')
}

const setCheckFeedback = (feedback: { level: 'passed' | 'vague' | 'deviation'; message: string; hint?: string; needReview: boolean }) => {
  checkRef.value?.setFeedback(feedback)
}

const setSessionData = (data: SessionData) => {
  sessionData.value = data
}

watch(() => props.data, (newData) => {
  sessionData.value = newData
}, { deep: true })

defineExpose({
  setCheckFeedback,
  setSessionData,
  restart,
  currentStage: stage,
  userResponses
})
</script>

<style scoped lang="scss">
.interactive-learning-flow {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.progress-indicator {
  margin-bottom: 24px;
  padding: 16px 24px;
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);

  :deep(.el-steps--simple) {
    background: transparent;
    padding: 0;
  }

  :deep(.el-step__title) {
    font-size: 14px;
  }

  :deep(.el-step__description) {
    font-size: 12px;
    padding-right: 8px;
  }
}

.content-area {
  min-height: 400px;
}

.completed-area {
  text-align: center;
  padding: 60px 24px;
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);

  .completed-icon {
    margin-bottom: 24px;

    .el-icon {
      font-size: 80px;
      color: var(--el-color-success);
    }
  }

  h2 {
    font-size: 24px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-bottom: 12px;
  }

  p {
    font-size: 16px;
    color: var(--el-text-color-secondary);
    margin-bottom: 32px;
  }
}

.navigation-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24px;
  padding: 16px 24px;
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);

  .progress-info {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    max-width: 200px;

    .el-progress {
      flex: 1;
    }

    .progress-text {
      font-size: 14px;
      color: var(--el-text-color-secondary);
      white-space: nowrap;
    }
  }
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from {
  transform: translateX(20px);
  opacity: 0;
}

.slide-fade-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}

@media (max-width: 768px) {
  .interactive-learning-flow {
    padding: 12px;
  }

  .progress-indicator {
    padding: 12px 16px;
    margin-bottom: 16px;

    :deep(.el-step__title) {
      font-size: 12px;
    }

    :deep(.el-step__description) {
      display: none;
    }
  }

  .completed-area {
    padding: 40px 16px;

    .completed-icon .el-icon {
      font-size: 60px;
    }

    h2 {
      font-size: 20px;
    }

    p {
      font-size: 14px;
    }
  }

  .navigation-area {
    flex-direction: column;
    gap: 16px;

    .progress-info {
      width: 100%;
      max-width: none;
    }
  }
}
</style>