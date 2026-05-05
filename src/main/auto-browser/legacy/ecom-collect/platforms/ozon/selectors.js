import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const OZON_ITEM_ANCESTORS = [
    '.tile-root',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const ozonSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.ozon.ru/search/?text=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: [
        '.tile-root',
    ],
    itemIdAttrs: [],
    titleSelectors: [
        '.tile-root a[href*="/product/"] span.tsBody500Medium',
        '.tile-root a[href*="/product/"] span[class*="tsBody"]',
        '.tile-root a[href*="/product/"]:not(:first-of-type)',
        'a[href*="/product/"]',
    ],
    linkSelectors: [
        'a[href*="/product/"]',
    ],
    priceSelectors: [
        '[class*="tsHeadline500Medium"]',
        '[class*="c35_3_16-a1"][class*="tsHeadline"]',
        'span[class*="c35_3_16-a1"]:first-of-type',
    ],
    imageSelectors: [
        'img[src*="ir.ozone.ru"]',
        'img[src*="multimedia"]',
        'img',
    ],
    shopSelectors: [
        '[class*="brand"]',
    ],
    badgeSelectors: [
        '[class*="badge"]',
        '[class*="sale"]',
    ],
    itemAncestorSelectors: OZON_ITEM_ANCESTORS,
};

export const ozonProductDetailScene = {
    titleSelectors: [
        'h1',
        '[class*="product-title"]',
    ],
    priceSelectors: [
        '[class*="price"]',
    ],
    imageSelectors: [
        'img[src*="ir.ozone.ru"]',
        'img[src*="multimedia"]',
    ],
    shopSelectors: [
        '[class*="seller"]',
        '[class*="brand"]',
    ],
    descriptionSelectors: [
        '[class*="description"]',
        '[class*="detail"]',
    ],
};

export const ozonShopHotProductsScene = {
    itemSelectors: [
        '.tile-root',
    ],
    titleSelectors: [
        'a[href*="/product/"]',
    ],
    linkSelectors: [
        'a[href*="/product/"]',
    ],
    priceSelectors: [
        '[class*="price"]',
    ],
    imageSelectors: [
        'img[src*="ir.ozone.ru"]',
        'img[src*="multimedia"]',
    ],
    badgeSelectors: [],
    itemAncestorSelectors: OZON_ITEM_ANCESTORS,
};
