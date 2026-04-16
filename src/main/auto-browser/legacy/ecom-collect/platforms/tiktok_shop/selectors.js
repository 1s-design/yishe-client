import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const tiktokShopSearchScene = {
    buildUrl: ({ keyword }) => `https://shop.tiktok.com/search?q=${encodeURIComponent(keyword)}`,
    itemSelectors: ['a[href*="/product/"]', '[data-testid*="product"]'],
    titleSelectors: ['[data-testid*="title"]', '[class*="title"]'],
    linkSelectors: ['a[href*="/product/"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="shop"]'],
    badgeSelectors: ['[class*="tag"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const tiktokShopProductDetailScene = {
    titleSelectors: ['h1', '[data-testid*="title"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['a[href*="/shop/"]'],
    descriptionSelectors: ['[class*="description"]'],
};

export const tiktokShopHotProductsScene = {
    itemSelectors: ['a[href*="/product/"]'],
    titleSelectors: ['[class*="title"]'],
    linkSelectors: ['a[href*="/product/"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
