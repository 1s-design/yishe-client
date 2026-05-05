import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const SHOPEE_ITEM_ANCESTORS = [
    '.shopee-search-item-result__item',
    '[data-sqe="item"]',
    '.col-xs-2-4',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const shopeeSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://shopee.co.jp/search?keyword=${encodeURIComponent(keyword)}&page=${page - 1}`,
    itemSelectors: [
        '.shopee-search-item-result__item',
        '[data-sqe="item"]',
        '.col-xs-2-4',
        'a[data-sqe="link"]',
    ],
    itemIdAttrs: ['data-itemid', 'data-shopid'],
    titleSelectors: [
        '[data-sqe="name"]',
        '.ie3A\\\\+n',
        '.shopee-search-item-result__item .line-clamp',
        'div[class*="name"]',
    ],
    linkSelectors: [
        'a[data-sqe="link"]',
        'a[href*="-i."]',
        'a[href*="/product/"]',
    ],
    priceSelectors: [
        '[class*="price"]',
        '.ZEgDH9',
        'span[class*="price"]',
    ],
    imageSelectors: [
        'img[class*="image"]',
        'img[src*="shopeesz"]',
        'img[data-src]',
    ],
    shopSelectors: [
        '[class*="shop"]',
        '[class*="seller"]',
    ],
    badgeSelectors: [
        '[class*="badge"]',
        '[class*="label"]',
        '.tag',
    ],
    itemAncestorSelectors: SHOPEE_ITEM_ANCESTORS,
};

export const shopeeProductDetailScene = {
    titleSelectors: [
        '.attROD',
        '[class*="product-brief__name"]',
        'h1[class*="name"]',
        '.product-title',
    ],
    priceSelectors: [
        '.pqTWkA',
        '[class*="product-price"]',
        'div[class*="price"]',
    ],
    imageSelectors: [
        'img[class*="product-image"]',
        '.product-image img',
        '[class*="gallery"] img',
    ],
    shopSelectors: [
        '[class*="shop-name"]',
        '.shop-profile__name',
        '[class*="seller-name"]',
    ],
    descriptionSelectors: [
        '.product-detail__description',
        '[class*="description"]',
        '.product-detail',
    ],
};

export const shopeeShopHotProductsScene = {
    itemSelectors: [
        '.shop-search-item-result',
        '.col-xs-2-4',
        '[data-sqe="item"]',
    ],
    titleSelectors: [
        '[data-sqe="name"]',
        '.ie3A\\\\+n',
        'div[class*="name"]',
    ],
    linkSelectors: [
        'a[data-sqe="link"]',
        'a[href*="-i."]',
    ],
    priceSelectors: [
        '[class*="price"]',
        'span[class*="price"]',
    ],
    imageSelectors: [
        'img[class*="image"]',
        'img[src*="shopeesz"]',
    ],
    badgeSelectors: [
        '[class*="badge"]',
    ],
    itemAncestorSelectors: SHOPEE_ITEM_ANCESTORS,
};
