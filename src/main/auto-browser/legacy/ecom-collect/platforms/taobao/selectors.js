import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const taobaoSearchScene = {
    buildUrl: ({ keyword }) => `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}&tab=all`,
    singlePage: true,
    itemSelectors: ['a[href*="item.taobao.com/item.htm"]', '[data-index]'],
    titleSelectors: ['[class*="Title--title"]', '[class*="title"]'],
    linkSelectors: ['a[href*="item.taobao.com/item.htm"]'],
    priceSelectors: ['[class*="Price--price"]', '[class*="priceInt"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="ShopInfo"]', '[class*="shop"]'],
    badgeSelectors: ['[class*="Tag"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const taobaoProductDetailScene = {
    titleSelectors: ['h1', '[class*="ItemHeader--mainTitle"]'],
    priceSelectors: ['[class*="Price--priceText"]'],
    imageSelectors: ['img'],
    shopSelectors: ['a[href*="shop"]'],
    descriptionSelectors: ['[class*="descV8-singleImage"]', '#description'],
};

export const taobaoHotProductsScene = {
    itemSelectors: ['a[href*="item.taobao.com/item.htm"]'],
    titleSelectors: ['[class*="title"]'],
    linkSelectors: ['a[href*="item.taobao.com/item.htm"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
