import {
    PLATFORM_NAME,
    TEMU_CATEGORY_URL_KEYWORD,
    TEMU_CATEGORY_KEYWORD_INPUT_SELECTORS,
    TEMU_CATEGORY_CASCADER_WRAPPER_SELECTOR,
    TEMU_CATEGORY_ITEM_SELECTORS,
    TEMU_NEXT_STEP_LABELS,
    TEMU_EDIT_HINT_SELECTORS,
    TEMU_EDIT_URL_KEYWORD,
    TEMU_CATEGORY_SELECT_TIMEOUT
} from './constants.js';
import {
    limitText,
    normalizeText,
    dedupeStrings,
    resolveTemuCategoryIntent
} from './utils.js';
import {
    waitForVisibleSelector,
    findFirstVisibleSelector,
    clickVisibleSelector,
    clickClickableByText,
    resolveTemuFrameworkStage
} from './page.js';
import {
    logger
} from '../../utils/logger.js';

export async function ensureTemuCreatePage(page, createUrl) {
    const currentStage = resolveTemuFrameworkStage(page.url());
    if (currentStage === 'edit_page_ready' || currentStage === 'category_selection_pending') {
        return { success: true, stage: currentStage, currentUrl: page.url() };
    }
    logger.info(`${PLATFORM_NAME}准备回到商品创建页`, { currentUrl: page.url(), createUrl });
    await page.goto(createUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3000);
    return { success: true, stage: resolveTemuFrameworkStage(page.url()), currentUrl: page.url() };
}

async function inspectTemuCascaderColumns(page) {
    return await page.evaluate((wrapperSelector) => {
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

        const container = document.querySelector(wrapperSelector);
        if (!(container instanceof HTMLElement) || !isVisible(container)) {
            return {
                found: false,
                columnCount: 0,
                columns: []
            };
        }

        const columns = Array.from(container.children)
            .filter((item) => item instanceof HTMLDivElement && isVisible(item))
            .map((column, columnIndex) => {
                const ul = Array.from(column.querySelectorAll('ul'))
                    .find((item) => item instanceof HTMLElement && isVisible(item));
                const liNodes = (ul ? Array.from(ul.children) : Array.from(column.querySelectorAll('li')))
                    .filter((item) => item instanceof HTMLElement && item.tagName.toLowerCase() === 'li' && isVisible(item));

                const items = liNodes
                    .map((item) => normalize(item.innerText || item.textContent))
                    .filter(Boolean)
                    .slice(0, 30);

                return {
                    index: columnIndex,
                    itemCount: items.length,
                    items
                };
            })
            .filter((column) => column.itemCount > 0);

        return {
            found: true,
            columnCount: columns.length,
            columns
        };
    }, TEMU_CATEGORY_CASCADER_WRAPPER_SELECTOR).catch(() => ({
        found: false,
        columnCount: 0,
        columns: []
    }));
}

async function waitForTemuCascaderReady(page, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = await inspectTemuCascaderColumns(page);
        if (state.found && state.columns.length > 0) {
            return {
                ready: true,
                ...state
            };
        }
        await page.waitForTimeout(500);
    }

    return {
        ready: false,
        found: false,
        columnCount: 0,
        columns: []
    };
}

async function clickTemuCascaderColumnItem(page, columnIndex, targetText) {
    const normalizedTarget = normalizeText(targetText).toLowerCase();
    if (!normalizedTarget) {
        return {
            success: false,
            reason: 'empty_category_segment'
        };
    }

    return await page.evaluate(({ wrapperSelector, currentColumnIndex, matcher }) => {
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

        const container = document.querySelector(wrapperSelector);
        if (!(container instanceof HTMLElement) || !isVisible(container)) {
            return {
                success: false,
                reason: 'cascader_wrapper_not_found'
            };
        }

        const columns = Array.from(container.children)
            .filter((item) => item instanceof HTMLDivElement && isVisible(item));
        const column = columns[currentColumnIndex];
        if (!(column instanceof HTMLElement)) {
            return {
                success: false,
                reason: 'cascader_column_not_found',
                availableColumnCount: columns.length
            };
        }

        const ul = Array.from(column.querySelectorAll('ul'))
            .find((item) => item instanceof HTMLElement && isVisible(item));
        const liNodes = (ul ? Array.from(ul.children) : Array.from(column.querySelectorAll('li')))
            .filter((item) => item instanceof HTMLElement && item.tagName.toLowerCase() === 'li' && isVisible(item));
        const items = liNodes
            .map((item) => ({
                element: item,
                text: normalize(item.innerText || item.textContent)
            }))
            .filter((item) => item.text);

        const exactMatch = items.find((item) => item.text.toLowerCase() === matcher);
        const containsMatch = items.find((item) => item.text.toLowerCase().includes(matcher));
        const matched = exactMatch || containsMatch || null;

        if (!matched?.element) {
            return {
                success: false,
                reason: 'cascader_item_not_found',
                availableItems: items.map((item) => item.text).slice(0, 20)
            };
        }

        matched.element.click();
        return {
            success: true,
            matchedText: matched.text,
            availableItems: items.map((item) => item.text).slice(0, 20)
        };
    }, {
        wrapperSelector: TEMU_CATEGORY_CASCADER_WRAPPER_SELECTOR,
        currentColumnIndex: columnIndex,
        matcher: normalizedTarget
    }).catch((error) => ({
        success: false,
        reason: 'cascader_item_click_failed',
        message: error?.message || String(error)
    }));
}

async function waitForTemuCascaderNextColumn(page, nextColumnIndex, previousColumns = [], timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    const baselineItems = Array.isArray(previousColumns?.[nextColumnIndex]?.items)
        ? previousColumns[nextColumnIndex].items
        : [];
    const baselineSignature = baselineItems.join('||');

    while (Date.now() < deadline) {
        const state = await inspectTemuCascaderColumns(page);
        const nextColumn = state.columns?.[nextColumnIndex];
        const nextItems = Array.isArray(nextColumn?.items) ? nextColumn.items : [];
        const nextSignature = nextItems.join('||');

        if (nextItems.length > 0) {
            if (!baselineSignature || nextSignature !== baselineSignature || Date.now() + 2_000 > deadline) {
                return {
                    ready: true,
                    columns: state.columns,
                    nextColumn
                };
            }
        }

        await page.waitForTimeout(500);
    }

    return {
        ready: false,
        columns: previousColumns
    };
}

async function selectTemuCategoryByCascaderPath(page, categoryPathSegments = []) {
    const segments = categoryPathSegments.map((item) => normalizeText(item)).filter(Boolean);
    if (!segments.length) {
        return {
            success: false,
            reason: 'missing_category_path_segments'
        };
    }

    const cascaderState = await waitForTemuCascaderReady(page);
    if (!cascaderState.ready) {
        return {
            success: false,
            reason: 'cascader_not_ready'
        };
    }

    const clickedItems = [];
    let latestColumns = cascaderState.columns;

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const clickResult = await clickTemuCascaderColumnItem(page, index, segment);
        if (!clickResult.success) {
            return {
                success: false,
                reason: clickResult.reason || 'cascader_item_not_found',
                failedSegment: segment,
                columnIndex: index,
                clickedItems,
                cascaderColumns: latestColumns,
                clickResult
            };
        }

        clickedItems.push({
            columnIndex: index,
            text: clickResult.matchedText
        });

        logger.info(`${PLATFORM_NAME}类目级联点击成功`, {
            columnIndex: index,
            segment,
            matchedText: clickResult.matchedText
        });

        if (index < segments.length - 1) {
            const nextColumnState = await waitForTemuCascaderNextColumn(page, index + 1, latestColumns);
            if (!nextColumnState.ready) {
                return {
                    success: false,
                    reason: 'cascader_next_column_not_ready',
                    failedSegment: segment,
                    columnIndex: index + 1,
                    clickedItems,
                    cascaderColumns: latestColumns
                };
            }
            latestColumns = nextColumnState.columns;
        } else {
            await page.waitForTimeout(800);
            const latestState = await inspectTemuCascaderColumns(page);
            latestColumns = latestState.columns;
        }
    }

    return {
        success: true,
        clickedItems,
        cascaderColumns: latestColumns
    };
}

async function waitForTemuCategoryPageReady(page) {
    if (resolveTemuFrameworkStage(page.url()) === 'edit_page_ready') {
        return { ready: true, stage: 'edit_page_ready' };
    }

    const cascaderState = await waitForTemuCascaderReady(page, 5_000);
    if (cascaderState.ready) {
        return {
            ready: true,
            stage: 'category_selection_pending',
            selector: TEMU_CATEGORY_CASCADER_WRAPPER_SELECTOR,
            columnCount: cascaderState.columnCount
        };
    }

    const input = await waitForVisibleSelector(page, TEMU_CATEGORY_KEYWORD_INPUT_SELECTORS, 15_000);
    if (!input) {
        return { ready: false, stage: resolveTemuFrameworkStage(page.url()) };
    }
    return { ready: true, stage: 'category_selection_pending', selector: input.selector };
}

async function listTemuCategoryItems(page) {
    const items = [];
    for (const selector of TEMU_CATEGORY_ITEM_SELECTORS) {
        try {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (!count) continue;
            for (let index = 0; index < Math.min(count, 30); index += 1) {
                const item = locator.nth(index);
                if (!(await item.isVisible().catch(() => false))) continue;
                const text = normalizeText(await item.innerText().catch(() => ''));
                if (!text) continue;
                items.push({ selector, index, text });
            }
            if (items.length > 0) break;
        } catch {
            // ignore and continue
        }
    }
    return items;
}

async function searchTemuCategory(page, pageOperator, keyword) {
    const normalizedKeyword = limitText(keyword, 60);
    if (!normalizedKeyword) return { success: false, reason: 'empty_keyword' };
    const input = await waitForVisibleSelector(page, TEMU_CATEGORY_KEYWORD_INPUT_SELECTORS, 10_000);
    if (!input) return { success: false, reason: 'keyword_input_not_found' };
    logger.info(`${PLATFORM_NAME}类目搜索`, { keyword: normalizedKeyword, selector: input.selector });
    await pageOperator.fillInput(page, input.selector, normalizedKeyword, { delay: 50 });
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(1800);
    const items = await listTemuCategoryItems(page);
    return {
        success: items.length > 0,
        keyword: normalizedKeyword,
        selector: input.selector,
        itemCount: items.length,
        itemTexts: items.slice(0, 8).map((item) => item.text)
    };
}

async function clickTemuCategoryItem(page, candidateTexts = [], options = {}) {
    const items = await listTemuCategoryItems(page);
    if (!items.length) return { success: false, reason: 'category_items_not_found' };
    const normalizedTargets = dedupeStrings(candidateTexts);
    const matchers = normalizedTargets.map((item) => item.toLowerCase());
    const fallbackAllowed = options.allowFallback !== false;
    let targetItem = null;
    for (const matcher of matchers) {
        targetItem = items.find((item) => item.text.toLowerCase() === matcher);
        if (targetItem) break;
        targetItem = items.find((item) => item.text.toLowerCase().includes(matcher));
        if (targetItem) break;
    }
    if (!targetItem && fallbackAllowed) targetItem = items[0];
    if (!targetItem) return { success: false, reason: 'category_item_no_match', items: items.slice(0, 10) };
    const locator = page.locator(targetItem.selector).nth(targetItem.index);
    try {
        await locator.click();
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}点击类目项失败，准备降级点击`, {
            item: targetItem,
            message: error?.message || String(error)
        });
        await page.evaluate(({ selector, index }) => {
            const element = document.querySelectorAll(selector)?.[index];
            if (element instanceof HTMLElement) element.click();
        }, { selector: targetItem.selector, index: targetItem.index });
    }
    await page.waitForTimeout(1200);
    return { success: true, clickedItem: targetItem, items: items.slice(0, 10) };
}

async function clickTemuNextStep(page) {
    const selectorClick = await clickVisibleSelector(page, ['button:has-text("下一步")', '[role="button"]:has-text("下一步")']);
    if (selectorClick) return { success: true, method: 'selector', detail: selectorClick };
    const textClick = await clickClickableByText(page, TEMU_NEXT_STEP_LABELS);
    if (textClick) return { success: true, method: 'text', detail: textClick };
    return { success: false, reason: 'next_button_not_found' };
}

async function waitForTemuEditPage(page, timeoutMs = TEMU_CATEGORY_SELECT_TIMEOUT) {
    const deadline = Date.now() + timeoutMs;
    let stableRounds = 0;
    let lastSignature = '';

    while (Date.now() < deadline) {
        const currentUrl = String(page.url() || '');
        if (currentUrl.includes(TEMU_EDIT_URL_KEYWORD)) {
            await page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => {});
            await page.waitForLoadState('load', { timeout: 2_000 }).catch(() => {});

            const editHint = await findFirstVisibleSelector(page, TEMU_EDIT_HINT_SELECTORS);
            const structureState = await page.evaluate((hintSelectors) => {
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

                const visibleInputs = Array.from(
                    document.querySelectorAll('input,textarea,select,[contenteditable="true"]')
                ).filter(isVisible);
                const visibleButtons = Array.from(
                    document.querySelectorAll('button,[role="button"]')
                ).filter(isVisible);
                const visibleForms = Array.from(document.querySelectorAll('form')).filter(isVisible);
                const matchedHintSelector = hintSelectors.find((selector) => {
                    try {
                        return Array.from(document.querySelectorAll(selector)).some(isVisible);
                    } catch {
                        return false;
                    }
                }) || '';

                return {
                    title: normalize(document.title),
                    matchedHintSelector,
                    visibleInputCount: visibleInputs.length,
                    visibleButtonCount: visibleButtons.length,
                    visibleFormCount: visibleForms.length
                };
            }, TEMU_EDIT_HINT_SELECTORS).catch(() => ({
                title: '',
                matchedHintSelector: '',
                visibleInputCount: 0,
                visibleButtonCount: 0,
                visibleFormCount: 0
            }));

            const ready = !!editHint
                || !!structureState.matchedHintSelector
                || structureState.visibleInputCount > 0
                || structureState.visibleFormCount > 0;

            if (ready) {
                const signature = [
                    currentUrl,
                    structureState.title,
                    structureState.visibleInputCount,
                    structureState.visibleButtonCount,
                    structureState.visibleFormCount
                ].join('::');

                stableRounds = signature === lastSignature ? stableRounds + 1 : 1;
                lastSignature = signature;

                if (stableRounds >= 2) {
                    return {
                        success: true,
                        currentUrl,
                        matchedSelector: editHint?.selector || structureState.matchedHintSelector || '',
                        visibleInputCount: structureState.visibleInputCount,
                        visibleButtonCount: structureState.visibleButtonCount,
                        visibleFormCount: structureState.visibleFormCount,
                        stableRounds
                    };
                }
            }
        }

        const editHint = await findFirstVisibleSelector(page, TEMU_EDIT_HINT_SELECTORS);
        if (editHint && !currentUrl.includes(TEMU_CATEGORY_URL_KEYWORD)) {
            return { success: true, currentUrl, matchedSelector: editHint.selector };
        }
        await page.waitForTimeout(800);
    }
    return { success: false, currentUrl: page.url() };
}

export async function performTemuCategorySelection(page, publishInfo, pageOperator) {
    const categoryIntent = resolveTemuCategoryIntent(publishInfo);
    if (!categoryIntent.primaryKeyword) {
        return {
            success: true,
            skipped: true,
            reason: 'missing_category_keyword',
            categoryIntent
        };
    }

    const categoryPageState = await waitForTemuCategoryPageReady(page);
    if (!categoryPageState.ready) {
        return {
            success: false,
            reason: 'category_page_not_ready',
            categoryIntent,
            currentUrl: page.url()
        };
    }

    if (categoryPageState.stage === 'edit_page_ready') {
        return {
            success: true,
            skipped: true,
            reason: 'already_in_edit_page',
            categoryIntent,
            currentUrl: page.url()
        };
    }

    let searchResult = null;
    let clickedItems = [];

    if (categoryIntent.categoryPathSegments.length > 0) {
        const cascaderResult = await selectTemuCategoryByCascaderPath(page, categoryIntent.categoryPathSegments);
        if (!cascaderResult.success) {
            return {
                success: false,
                reason: cascaderResult.reason,
                categoryIntent,
                clickedItems: cascaderResult.clickedItems || [],
                cascaderColumns: cascaderResult.cascaderColumns || [],
                failedSegment: cascaderResult.failedSegment || ''
            };
        }

        clickedItems = (cascaderResult.clickedItems || []).map((item) => ({
            selector: TEMU_CATEGORY_CASCADER_WRAPPER_SELECTOR,
            index: item.columnIndex,
            text: item.text
        }));
        searchResult = {
            success: true,
            keyword: categoryIntent.categoryPathSegments[0],
            method: 'cascader_path',
            itemCount: clickedItems.length,
            itemTexts: clickedItems.map((item) => item.text)
        };
    } else {
        for (const keyword of categoryIntent.searchKeywords.slice(0, 4)) {
            searchResult = await searchTemuCategory(page, pageOperator, keyword);
            if (searchResult.success) break;
        }
        if (!searchResult?.success) {
            return {
                success: false,
                reason: 'category_search_no_result',
                categoryIntent,
                searchResult
            };
        }

        for (const segment of categoryIntent.categoryPathSegments) {
            const stepSelection = await clickTemuCategoryItem(page, [segment], { allowFallback: false });
            if (!stepSelection.success) break;
            clickedItems.push(stepSelection.clickedItem);
        }

        if (!clickedItems.length) {
            const selectionResult = await clickTemuCategoryItem(page, [...categoryIntent.selectionTexts, searchResult.keyword]);
            if (!selectionResult.success) {
                return {
                    success: false,
                    reason: selectionResult.reason,
                    categoryIntent,
                    searchResult,
                    selectionResult
                };
            }
            clickedItems.push(selectionResult.clickedItem);
        }
    }

    const nextStepResult = await clickTemuNextStep(page);
    if (!nextStepResult.success) {
        return {
            success: false,
            reason: nextStepResult.reason,
            categoryIntent,
            searchResult,
            clickedItems
        };
    }

    await page.waitForTimeout(1500);
    const editPageState = await waitForTemuEditPage(page);
    if (!editPageState.success) {
        return {
            success: false,
            reason: 'edit_page_not_reached',
            categoryIntent,
            searchResult,
            clickedItems,
            currentUrl: editPageState.currentUrl
        };
    }

    return {
        success: true,
        categoryIntent,
        searchResult,
        clickedItems,
        currentUrl: page.url()
    };
}
