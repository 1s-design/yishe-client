import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const COUPANG_ITEM_ANCESTORS = [
    'li[class*="product"]',
    '[class*="search-product"]',
    '.baby-product',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const coupangSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: [
        'li[class*="product"]',
        '[class*="search-product"]',
        '.baby-product',
    ],
    itemIdAttrs: ['data-product-id', 'data-id'],
    titleSelectors: [
        '.name',
        '[class*="product-name"]',
        'div[class*="name"]',
        'a[class*="name"]',
    ],
    linkSelectors: [
        'a[class*="product-link"]',
        'a[href*="/vp/products/"]',
        'a.search-product-link',
    ],
    priceSelectors: [
        '.price-value',
        '[class*="price"] strong',
        '.price em',
        '[class*="price-value"]',
    ],
    imageSelectors: [
        'img[class*="product-img"]',
        'img[src*="thumbnail"]',
        '.image img',
    ],
    shopSelectors: [
        '[class*="seller"]',
        '.product-vendor',
    ],
    badgeSelectors: [
        '[class*="badge"]',
        '.rocket-badge',
        '[class*="label"]',
        '.rating-star',
    ],
    itemAncestorSelectors: COUPANG_ITEM_ANCESTORS,
};

export const coupangProductDetailScene = {
    titleSelectors: [
        'h1[class*="product-title"]',
        '.prod-buy-header__title',
        'h2[class*="title"]',
    ],
    priceSelectors: [
        '.total-price strong',
        '.prod-price .price-value',
        '[class*="price"] .price-value',
    ],
    imageSelectors: [
        '.prod-image__img img',
        '[class*="product-image"] img',
        '.image-slider img',
    ],
    shopSelectors: [
        '[class*="seller"]',
        '.prod-sale-vendor-name',
        '[class*="vendor"]',
    ],
    descriptionSelectors: [
        '.prod-description',
        '[class*="product-description"]',
        '.product-detail',
    ],
};

export const coupangShopHotProductsScene = {
    itemSelectors: [
        'li[class*="product"]',
        '.baby-product',
        '[class*="search-product"]',
    ],
    titleSelectors: [
        '.name',
        '[class*="product-name"]',
    ],
    linkSelectors: [
        'a[class*="product-link"]',
        'a[href*="/vp/products/"]',
    ],
    priceSelectors: [
        '.price-value',
        '[class*="price"] strong',
    ],
    imageSelectors: [
        'img[class*="product-img"]',
        'img[src*="thumbnail"]',
    ],
    badgeSelectors: [
        '[class*="badge"]',
        '.rocket-badge',
    ],
    itemAncestorSelectors: COUPANG_ITEM_ANCESTORS,
};
