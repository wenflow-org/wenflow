export interface TestSiteNavItem {
  to: string;
  label: string;
  isActive?: boolean;
}

export const TEST_SITE_BASE = '/admin/test';

export const TEST_SITE_NAV_ITEMS: TestSiteNavItem[] = [
  { to: `${TEST_SITE_BASE}/dashboard`, label: '测试学习台' },
  { to: `${TEST_SITE_BASE}/goal-full`, label: '测试目标规划' },
  { to: `${TEST_SITE_BASE}/learning-paths`, label: '测试学习路径' },
  { to: `${TEST_SITE_BASE}/learning-state`, label: '测试学习状态' },
  { to: `${TEST_SITE_BASE}/achievements`, label: '测试成就' },
];

export const TEST_SITE_PATHS = {
  dashboard: `${TEST_SITE_BASE}/dashboard`,
  goalFull: `${TEST_SITE_BASE}/goal-full`,
  learningPaths: `${TEST_SITE_BASE}/learning-paths`,
  learningPathDetail: `${TEST_SITE_BASE}/learning-path`,
  learningState: `${TEST_SITE_BASE}/learning-state`,
  achievements: `${TEST_SITE_BASE}/achievements`,
  learn: `${TEST_SITE_BASE}/learn`,
  learnEvaluation: `${TEST_SITE_BASE}/learn`,
};

export function getTestSitePath(key: keyof typeof TEST_SITE_PATHS, param?: string | number): string {
  const base = TEST_SITE_PATHS[key];
  if (param) {
    return `${base}/${param}`;
  }
  return base;
}

export function getTestSiteNavItems(activePath?: string): TestSiteNavItem[] {
  if (!activePath) return TEST_SITE_NAV_ITEMS;
  
  return TEST_SITE_NAV_ITEMS.map(item => ({
    ...item,
    isActive: activePath.startsWith(item.to)
  }));
}