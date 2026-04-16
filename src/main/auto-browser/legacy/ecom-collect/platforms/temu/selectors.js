import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const temuSearchScene = {
    buildUrl: ({ keyword, page = 1 }) => `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: ['a[href*="-g-"]', '[data-testid*="product"]'],
    titleSelectors: ['[class*="title"]', '[data-testid*="title"]'],
    linkSelectors: ['a[href*="-g-"]'],
    priceSelectors: ['[class*="price"]', '[data-testid*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="shop"]'],
    badgeSelectors: ['[class*="tag"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const temuProductDetailScene = {
    titleSelectors: ['h1', '[class*="product-title"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="shop"]'],
    descriptionSelectors: ['[class*="description"]'],
};

export const temuShopHotProductsScene = {
    itemSelectors: ['a[href*="-g-"]'],
    titleSelectors: ['[class*="title"]'],
    linkSelectors: ['a[href*="-g-"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
