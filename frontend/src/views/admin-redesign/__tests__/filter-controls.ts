import type { DOMWrapper, VueWrapper } from '@vue/test-utils';

/**
 * 卡头「带标签的胶囊下拉」（MkPillSelect）的测试助手。
 *
 * 2026-10-27 表头统一后，**单选维度**不再是 `.mk-pill` chip 组，而是
 * `<div class="mk-pillselect-wrap">` 里一枚 `button[role=combobox]` + 自绘 listbox
 * （原生 `<select>` 的弹层无法与页面浮层同语言，2026-10-27 用户「这个下拉，完全没有设计」）。
 * 计数进入 option 文案（如「管理员（2）」）。查询统一走这里，避免每个测试文件各写一套。
 */

/** 某维的包裹层（含触发器与弹层）：按可见维度名定位 */
function filterWrap(w: VueWrapper<any>, dimLabel: string) {
  const wrap = w
    .findAll('.mk-pillselect-wrap')
    .find((x) => x.find('.mk-pillselect__k').text() === dimLabel);
  if (!wrap) throw new Error(`filter select not found: ${dimLabel}`);
  return wrap;
}

/** 触发器本身（`data-value` 携带当前值，等价于旧原生 select 的 .value） */
export function filterTrigger(w: VueWrapper<any>, dimLabel: string) {
  return filterWrap(w, dimLabel).find('button.mk-pillselect');
}

/** 当前选中值；未选任何档时为空串（「全部…」的 value 由页面给） */
export function filterValue(w: VueWrapper<any>, dimLabel: string): string {
  return filterTrigger(w, dimLabel).attributes('data-value') ?? '';
}

/** 全部选项文案（v-show 只改 display，选项始终在 DOM 里，无需先展开） */
export function filterOptions(w: VueWrapper<any>, dimLabel: string): string[] {
  return filterWrap(w, dimLabel)
    .findAll('.mk-pillselect__option')
    .map((o) => o.text());
}

/** 取某维某档的 option（文案含计数，按前缀匹配）。 */
export function filterOption(
  w: VueWrapper<any>,
  dimLabel: string,
  optionLabelPrefix: string
): DOMWrapper<Element> {
  const opt = filterWrap(w, dimLabel)
    .findAll('.mk-pillselect__option')
    .find((o) => o.text().startsWith(optionLabelPrefix));
  if (!opt) throw new Error(`option not found: ${dimLabel} / ${optionLabelPrefix}`);
  return opt;
}

/** 展开下拉并点选某档 —— 等价于真实用户的开弹层 + 点选项。 */
export async function chooseFilter(
  w: VueWrapper<any>,
  dimLabel: string,
  optionLabelPrefix: string
): Promise<void> {
  const opt = filterOption(w, dimLabel, optionLabelPrefix);
  await filterTrigger(w, dimLabel).trigger('click');
  await opt.trigger('click');
}
