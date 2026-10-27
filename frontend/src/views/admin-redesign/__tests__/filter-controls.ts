import type { DOMWrapper, VueWrapper } from '@vue/test-utils';

/**
 * 卡头「带标签的胶囊下拉」（MkPillSelect）的测试助手。
 *
 * 2026-10-27 表头统一后，**单选维度**不再是 `.mk-pill` chip 组，而是
 * `<label class="mk-pill mk-pillselect">` 包一个原生 select；计数进入 option 文案
 * （如「管理员（2）」）。原来的 `findAll('.mk-pill')` + `trigger('click')` 断言全部失效，
 * 统一改走这三个函数，避免每个测试文件各写一套查询。
 */
export function filterSelect(w: VueWrapper<any>, dimLabel: string) {
  const label = w
    .findAll('label.mk-pillselect')
    .find((l) => l.find('.mk-pillselect__k').text() === dimLabel);
  if (!label) throw new Error(`filter select not found: ${dimLabel}`);
  return label.find('select');
}

/** 取某维某档的 option（文案含计数，按前缀匹配）。 */
export function filterOption(
  w: VueWrapper<any>,
  dimLabel: string,
  optionLabelPrefix: string
): DOMWrapper<HTMLOptionElement> {
  const opt = filterSelect(w, dimLabel)
    .findAll('option')
    .find((o) => o.text().startsWith(optionLabelPrefix));
  if (!opt) throw new Error(`option not found: ${dimLabel} / ${optionLabelPrefix}`);
  return opt as unknown as DOMWrapper<HTMLOptionElement>;
}

/** 选中某档并触发 change —— 等价于旧实现里点一下对应的 pill。 */
export async function chooseFilter(
  w: VueWrapper<any>,
  dimLabel: string,
  optionLabelPrefix: string
): Promise<void> {
  const opt = filterOption(w, dimLabel, optionLabelPrefix);
  await filterSelect(w, dimLabel).setValue(opt.element.value);
}
