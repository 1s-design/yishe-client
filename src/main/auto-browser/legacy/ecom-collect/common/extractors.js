import { DEFAULT_MAX_ITEMS, SERIALIZABLE_SCENE_FIELDS } from './constants.js';

export function buildSerializableSceneConfig(sceneConfig = {}) {
    return SERIALIZABLE_SCENE_FIELDS.reduce((result, field) => {
        const value = sceneConfig?.[field];
        if (Array.isArray(value)) {
            result[field] = value.map((item) => String(item || '').trim()).filter(Boolean);
        } else if (typeof value === 'string' && value.trim()) {
            result[field] = [value.trim()];
        }
        return result;
    }, {});
}

export async function extractListRecords(page, sceneConfig, options = {}) {
    const maxItems = Math.max(1, Math.min(500, Number(options.maxItems) || DEFAULT_MAX_ITEMS));

    return page.evaluate(
        ({ sceneConfig, maxItems }) => {
            const toText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
            const pickNode = (root, selector) => {
                if (!root || !selector) return null;
                if (selector === ':scope') return root;
                if (typeof root.matches === 'function' && root.matches(selector)) {
                    return root;
                }
                return root.querySelector(selector);
            };

            const pickText = (root, selectors = []) => {
                for (const selector of selectors || []) {
                    const node = pickNode(root, selector);
                    const text = toText(node?.textContent || '');
                    if (text) return text;
                }
                return '';
            };

            const pickAttr = (root, selectors = [], attrs = []) => {
                for (const selector of selectors || []) {
                    const node = pickNode(root, selector);
                    if (!node) continue;
                    for (const attr of attrs) {
                        const value = node.getAttribute?.(attr);
                        if (value && String(value).trim()) {
                            return String(value).trim();
                        }
                    }
                }
                return '';
            };

            const pickImageUrl = (root, selectors = []) => {
                const value = pickAttr(root, selectors, ['src', 'data-src', 'data-lazy-src', 'data-original']);
                if (value) return value;

                const srcset = pickAttr(root, selectors, ['srcset', 'data-srcset']);
                if (srcset) {
                    const items = String(srcset)
                        .split(',')
                        .map((item) => item.trim().split(' ')[0])
                        .filter(Boolean);
                    if (items.length) {
                        return items[items.length - 1];
                    }
                }
                return '';
            };

            const uniqueRoots = [];
            const rootSet = new Set();
            const pushRoot = (node) => {
                if (!node || rootSet.has(node)) return;
                rootSet.add(node);
                uniqueRoots.push(node);
            };

            for (const selector of sceneConfig.itemSelectors || []) {
                document.querySelectorAll(selector).forEach((node) => pushRoot(node));
            }

            if (uniqueRoots.length === 0) {
                for (const selector of sceneConfig.linkSelectors || []) {
                    document.querySelectorAll(selector).forEach((node) => {
                        let root = node;
                        for (const ancestorSelector of sceneConfig.itemAncestorSelectors || []) {
                            const matched = node.closest?.(ancestorSelector);
                            if (matched) {
                                root = matched;
                                break;
                            }
                        }
                        pushRoot(root);
                    });
                }
            }

            const records = [];
            const seenKeys = new Set();

            for (const root of uniqueRoots) {
                if (records.length >= maxItems) break;

                const title =
                    pickText(root, sceneConfig.titleSelectors) ||
                    pickText(root, sceneConfig.linkSelectors) ||
                    pickAttr(root, sceneConfig.linkSelectors, ['aria-label', 'title']) ||
                    pickAttr(root, sceneConfig.imageSelectors, ['alt', 'title']);
                const subtitle = pickText(root, sceneConfig.subtitleSelectors);
                const priceText = pickText(root, sceneConfig.priceSelectors);
                const shopName = pickText(root, sceneConfig.shopSelectors);
                const badgeText = pickText(root, sceneConfig.badgeSelectors);
                const link = pickAttr(root, sceneConfig.linkSelectors, ['href']);
                const imageUrl = pickImageUrl(root, sceneConfig.imageSelectors);
                const recordKey =
                    pickAttr(root, [':scope'], sceneConfig.itemIdAttrs || []) ||
                    link ||
                    title;

                const normalizedKey = toText(recordKey);
                if (!normalizedKey || seenKeys.has(normalizedKey)) continue;
                if (!title && !link) continue;

                seenKeys.add(normalizedKey);

                records.push({
                    recordKey: normalizedKey,
                    title,
                    subtitle,
                    priceText,
                    shopName,
                    badgeText,
                    sourceUrl: link || '',
                    imageUrl,
                    cardText: toText(root.textContent || '').slice(0, 500),
                    capturedAt: new Date().toISOString(),
                });
            }

            return {
                count: records.length,
                records,
            };
        },
        {
            sceneConfig,
            maxItems,
        },
    );
}

export async function extractDetailRecord(page, sceneConfig) {
    return page.evaluate(({ sceneConfig }) => {
        const toText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
        const pickText = (selectors = []) => {
            for (const selector of selectors || []) {
                const node = document.querySelector(selector);
                const text = toText(node?.textContent || '');
                if (text) return text;
            }
            return '';
        };

        const pickImageUrls = (selectors = []) => {
            const urls = [];
            const seen = new Set();
            for (const selector of selectors || []) {
                document.querySelectorAll(selector).forEach((node) => {
                    const src =
                        node.getAttribute?.('src') ||
                        node.getAttribute?.('data-src') ||
                        node.getAttribute?.('data-lazy-src');
                    if (src && !seen.has(src)) {
                        seen.add(src);
                        urls.push(src);
                    }
                });
            }
            return urls.slice(0, 20);
        };

        const record = {
            recordKey: location.href,
            sourceUrl: location.href,
            title: pickText(sceneConfig.titleSelectors),
            priceText: pickText(sceneConfig.priceSelectors),
            shopName: pickText(sceneConfig.shopSelectors),
            descriptionText: pickText(sceneConfig.descriptionSelectors).slice(0, 3000),
            imageUrls: pickImageUrls(sceneConfig.imageSelectors),
            pageTitle: document.title || '',
            capturedAt: new Date().toISOString(),
        };

        return {
            count: record.title || record.sourceUrl ? 1 : 0,
            records: [record],
        };
    }, { sceneConfig });
}

export function buildKeywordList(configData = {}) {
    const set = new Set();
    const singleKeyword = String(configData.keyword || '').trim();
    if (singleKeyword) {
        set.add(singleKeyword);
    }
    if (Array.isArray(configData.keywords)) {
        configData.keywords
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .forEach((item) => set.add(item));
    }
    return Array.from(set);
}
