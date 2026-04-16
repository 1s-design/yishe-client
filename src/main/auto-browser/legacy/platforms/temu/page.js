import {
    PLATFORM_NAME,
    TEMU_EDIT_URL_KEYWORD,
    TEMU_CATEGORY_URL_KEYWORD
} from './constants.js';
import {
    logger
} from '../../utils/logger.js';

export async function getBodyPreviewText(page, limit = 1200) {
    return await page.evaluate((maxLength) => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, maxLength), limit).catch(() => '');
}

export async function findFirstVisibleSelector(page, selectors = []) {
    for (const selector of selectors) {
        try {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (!count) {
                continue;
            }
            for (let index = 0; index < Math.min(count, 4); index += 1) {
                const candidate = locator.nth(index);
                if (await candidate.isVisible().catch(() => false)) {
                    return { selector, locator: candidate, index, count };
                }
            }
        } catch {
            // ignore invalid selector or detached element
        }
    }
    return null;
}

export async function waitForVisibleSelector(page, selectors = [], timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const matched = await findFirstVisibleSelector(page, selectors);
        if (matched) {
            return matched;
        }
        await page.waitForTimeout(500);
    }
    return null;
}

export async function clickVisibleSelector(page, selectors = [], options = {}) {
    const matched = await findFirstVisibleSelector(page, selectors);
    if (!matched) {
        return null;
    }

    try {
        await matched.locator.click(options);
        return {
            clicked: true,
            selector: matched.selector,
            index: matched.index
        };
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}点击选择器失败，准备降级点击`, {
            selector: matched.selector,
            message: error?.message || String(error)
        });
    }

    const clicked = await page.evaluate(({ selector, index }) => {
        const elements = Array.from(document.querySelectorAll(selector));
        const element = elements[index];
        if (!element) {
            return false;
        }
        element.click();
        return true;
    }, {
        selector: matched.selector,
        index: matched.index
    }).catch(() => false);

    return clicked ? {
        clicked: true,
        selector: matched.selector,
        index: matched.index,
        fallback: true
    } : null;
}

export async function clickClickableByText(page, texts = [], options = {}) {
    const candidates = Array.from(new Set(texts.map((item) => String(item || '').replace(/\s+/g, ' ').trim()).filter(Boolean)));
    if (!candidates.length) {
        return null;
    }

    const selector = options.selector || 'button,[role="button"],a,span,div';
    const exact = options.exact === true;

    return await page.evaluate(({ selector: clickableSelector, exactMatch, targetTexts }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };
        const isDisabled = (element) => {
            const className = normalize(element.className);
            return element.hasAttribute('disabled')
                || element.getAttribute('aria-disabled') === 'true'
                || className.includes('disabled')
                || className.includes('loading');
        };

        const elements = Array.from(document.querySelectorAll(clickableSelector)).filter(isVisible);

        for (const targetText of targetTexts) {
            const normalizedTarget = normalize(targetText);
            const matched = elements.find((element) => {
                const text = normalize(element.innerText || element.textContent);
                if (!text || isDisabled(element)) {
                    return false;
                }
                return exactMatch ? text === normalizedTarget : text.includes(normalizedTarget);
            });

            if (matched) {
                matched.click();
                return {
                    text: normalize(matched.innerText || matched.textContent),
                    tagName: matched.tagName,
                    className: normalize(matched.className)
                };
            }
        }

        return null;
    }, {
        selector,
        exactMatch: exact,
        targetTexts: candidates
    }).catch(() => null);
}

export async function clickButtonByText(page, texts = [], options = {}) {
    const candidates = Array.from(new Set(
        texts
            .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
    ));
    if (!candidates.length) {
        return null;
    }

    const selectors = Array.isArray(options.selectors) && options.selectors.length
        ? options.selectors
        : ['button', '[role="button"]'];
    const exact = options.exact !== false;

    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isDisabled = async (locator) => {
        try {
            return await locator.evaluate((element) => {
                const normalizeClass = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                const className = normalizeClass(element.className);
                return element.hasAttribute('disabled')
                    || element.getAttribute('aria-disabled') === 'true'
                    || className.includes('disabled')
                    || className.includes('loading');
            });
        } catch {
            return false;
        }
    };

    for (const targetText of candidates) {
        const normalizedTargetText = normalize(targetText);
        for (const selector of selectors) {
            let count = 0;
            try {
                count = await page.locator(selector).count();
            } catch {
                count = 0;
            }

            for (let index = 0; index < count; index += 1) {
                const locator = page.locator(selector).nth(index);
                const visible = await locator.isVisible().catch(() => false);
                if (!visible) {
                    continue;
                }
                if (await isDisabled(locator)) {
                    continue;
                }

                const text = normalize(
                    await locator.innerText().catch(async () =>
                        await locator.textContent().catch(() => '')
                    )
                );
                if (!text) {
                    continue;
                }

                const matched = exact
                    ? text === normalizedTargetText
                    : text.includes(normalizedTargetText);
                if (!matched) {
                    continue;
                }

                try {
                    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
                    await locator.click(options.clickOptions || {});
                    return {
                        text,
                        selector,
                        index,
                        exactMatch: exact
                    };
                } catch (error) {
                    logger.warn(`${PLATFORM_NAME}点击按钮文字失败，准备降级点击`, {
                        selector,
                        index,
                        text,
                        message: error?.message || String(error)
                    });
                }

                const fallbackClicked = await locator.evaluate((element) => {
                    element.click();
                    return true;
                }).catch(() => false);

                if (fallbackClicked) {
                    return {
                        text,
                        selector,
                        index,
                        exactMatch: exact,
                        fallback: true
                    };
                }
            }
        }
    }

    return null;
}

export function resolveTemuFrameworkStage(pageUrl) {
    const currentUrl = String(pageUrl || '');
    if (currentUrl.includes(TEMU_EDIT_URL_KEYWORD)) {
        return 'edit_page_ready';
    }
    if (currentUrl.includes(TEMU_CATEGORY_URL_KEYWORD)) {
        return 'category_selection_pending';
    }
    return 'page_opened';
}

export async function collectTemuFrameworkSnapshot(page) {
    return await page.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const buttons = Array.from(document.querySelectorAll('button,[role="button"]')).filter(isVisible).map((element) => normalize(element.textContent)).filter(Boolean).slice(0, 12);
        const inputs = Array.from(document.querySelectorAll('input,textarea')).filter(isVisible).map((element) => ({
            placeholder: element.getAttribute('placeholder') || '',
            type: element.getAttribute('type') || element.tagName.toLowerCase()
        })).slice(0, 20);

        return {
            url: window.location.href,
            title: document.title,
            bodyPreview: normalize(document.body?.innerText || '').slice(0, 1200),
            buttons,
            inputs
        };
    }).catch(() => ({ url: '', title: '', bodyPreview: '', buttons: [], inputs: [] }));
}

export async function collectTemuEditPageStructure(page) {
    return await page.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const resolveElementLabel = (element) => {
            if (!(element instanceof HTMLElement)) return '';
            const labelledById = element.getAttribute('aria-labelledby');
            if (labelledById) {
                const labelledByElement = document.getElementById(labelledById);
                const labelledByText = normalize(labelledByElement?.textContent || '');
                if (labelledByText) return labelledByText;
            }
            const placeholder = normalize(element.getAttribute('placeholder') || '');
            if (placeholder) return placeholder;
            const labelFromFor = element.id ? normalize(document.querySelector(`label[for="${element.id}"]`)?.textContent || '') : '';
            if (labelFromFor) return labelFromFor;
            return normalize(element.closest('label,[class*="form-item"],[class*="field"],[class*="row"],[class*="item"]')?.querySelector('label,[class*="label"],[class*="title"],[class*="name"]')?.textContent || '');
        };
        const buttons = Array.from(document.querySelectorAll('button,[role="button"]')).filter(isVisible).map((element) => ({ text: normalize(element.textContent), disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true', tag: element.tagName.toLowerCase() })).filter((item) => item.text).slice(0, 30);
        const inputs = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"]')).filter(isVisible).map((element) => ({ tag: element.tagName.toLowerCase(), type: element.getAttribute('type') || (element.getAttribute('contenteditable') === 'true' ? 'contenteditable' : ''), name: element.getAttribute('name') || '', label: resolveElementLabel(element), placeholder: element.getAttribute('placeholder') || '' })).slice(0, 50);
        const sectionSelectors = ['section', 'form', 'fieldset', '[class*="section"]', '[class*="block"]', '[class*="panel"]', '[class*="card"]', '[class*="group"]', '[class*="wrapper"]'];
        const uniqueSections = new Set();
        const sections = [];
        for (const selector of sectionSelectors) {
            const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
            for (const element of elements) {
                if (uniqueSections.has(element)) continue;
                uniqueSections.add(element);
                const title = normalize(element.querySelector('h1,h2,h3,h4,label,[class*="title"],[class*="heading"],[class*="label"],[class*="name"]')?.textContent || '');
                const textPreview = normalize(element.textContent || '').slice(0, 160);
                const inputCount = element.querySelectorAll('input,textarea,select,[contenteditable="true"]').length;
                const buttonCount = element.querySelectorAll('button,[role="button"]').length;
                if (!title && !textPreview && !inputCount && !buttonCount) continue;
                sections.push({ tag: element.tagName.toLowerCase(), className: normalize(element.className || '').slice(0, 120), title, inputCount, buttonCount, textPreview });
                if (sections.length >= 24) break;
            }
            if (sections.length >= 24) break;
        }
        const forms = Array.from(document.querySelectorAll('form')).filter(isVisible).map((element) => ({ inputCount: element.querySelectorAll('input,textarea,select,[contenteditable="true"]').length, buttonCount: element.querySelectorAll('button,[role="button"]').length, textPreview: normalize(element.textContent || '').slice(0, 180) })).slice(0, 8);
        return { title: document.title, url: window.location.href, bodyPreview: normalize(document.body?.innerText || '').slice(0, 1500), sectionCount: sections.length, buttonCount: buttons.length, inputCount: inputs.length, formCount: forms.length, sections, buttons, inputs, forms };
    }).catch(() => ({ title: '', url: '', bodyPreview: '', sectionCount: 0, buttonCount: 0, inputCount: 0, formCount: 0, sections: [], buttons: [], inputs: [], forms: [] }));
}
