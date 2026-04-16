import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const aliexpressSearchScene = {
    buildUrl: ({ keyword, page = 1 }) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: ['a[href*="/item/"]'],
    itemIdAttrs: ['data-product-id', 'data-item-id'],
    titleSelectors: ['[role="heading"]', 'h3.lw_k4', '[class*="lw_an"]', '[class*="lw_k4"]', '[class*="multi--title"]'],
    linkSelectors: ['a[href*="/item/"]'],
    priceSelectors: ['.lw_el[aria-label]', '.lw_kt', '[class*="lw_el"]', '[class*="lw_kt"]', '[class*="price-sale"]', '[class*="price-current"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="store-name"]', '[class*="manhattan--store"]'],
    badgeSelectors: ['[class*="tag"]', '[class*="rating"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const aliexpressProductDetailScene = {
    titleSelectors: ['h1', '[class*="product-title"]'],
    priceSelectors: ['[class*="product-price-current"]', '[class*="price--currentPrice"]'],
    imageSelectors: ['img'],
    shopSelectors: ['a[href*="/store/"]', '[class*="store-name"]'],
    descriptionSelectors: ['[class*="product-description"]', '#nav-description'],
};

export const aliexpressShopHotProductsScene = {
    itemSelectors: ['a[href*="/item/"]'],
    titleSelectors: ['[class*="title"]'],
    linkSelectors: ['a[href*="/item/"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
