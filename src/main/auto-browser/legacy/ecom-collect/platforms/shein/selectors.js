import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const sheinSearchScene = {
    buildUrl: ({ keyword, page = 1 }) => `https://us.shein.com/pdsearch/${encodeURIComponent(keyword)}/?page=${page}`,
    itemSelectors: ['a[href*="-cat-"]', 'a[href*="-p-"]'],
    titleSelectors: ['[class*="product-item__name"]', '[class*="goods-title"]'],
    linkSelectors: ['a[href*="-p-"]'],
    priceSelectors: ['[class*="sale-price"]', '[class*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: [],
    badgeSelectors: ['[class*="discount"]', '[class*="tag"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const sheinProductDetailScene = {
    titleSelectors: ['.product-intro__head h1', 'h1', '[class*="product-intro__head-name"]'],
    priceSelectors: ['.productPrice__main', '.productPriceContainer .productPrice__main', '[class*="product-intro__head-price"]'],
    imageSelectors: ['img'],
    shopSelectors: [],
    descriptionSelectors: ['[class*="product-intro__description"]', '[class*="product-intro__text"]'],
};

export const sheinHotProductsScene = {
    itemSelectors: ['a[href*="-p-"]'],
    titleSelectors: ['[class*="product-item__name"]', '[class*="goods-title"]'],
    linkSelectors: ['a[href*="-p-"]'],
    priceSelectors: ['[class*="sale-price"]', '[class*="price"]'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
