import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const RAKUTEN_ITEM_ANCESTORS = [
    '.searchresultitem',
    '.dui-card',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const rakutenSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/?p=${page}`,
    itemSelectors: [
        '.searchresultitem',
    ],
    itemIdAttrs: ['data-sku'],
    titleSelectors: [
        '[class*="title-link--"]',
        'a[href*="item.rakuten.co.jp"]',
        'a[href*="grp"]',
    ],
    linkSelectors: [
        '[class*="title-link--"]',
        'a[href*="item.rakuten.co.jp"]',
        'a[href*="grp"]',
    ],
    priceSelectors: [
        '[class*="price--3zUvK"]',
        '[class*="main-price-value--"]',
        '[class*="important"]',
    ],
    imageSelectors: [
        '[class*="image--x5mNi"] img',
        '[class*="image-wrapper"] img',
        'img[src*="tshop.r10s.jp"]',
    ],
    shopSelectors: [
        '[class*="simpleshop"]',
        '[class*="shopName"]',
    ],
    badgeSelectors: [
        '[class*="rating"]',
        '[class*="badge"]',
    ],
    itemAncestorSelectors: RAKUTEN_ITEM_ANCESTORS,
};

export const rakutenProductDetailScene = {
    titleSelectors: [
        '[class*="item_name"]',
        '#item_name',
        'h1',
    ],
    priceSelectors: [
        '[class*="price--"]',
        '#priceCalculationArea [class*="price"]',
        '[class*="important"]',
    ],
    imageSelectors: [
        '[class*="item_image"] img',
        '#imgslider img',
        '[class*="gallery"] img',
    ],
    shopSelectors: [
        '[class*="shop_name"] a',
        '[class*="shop-name"]',
    ],
    descriptionSelectors: [
        '[class*="item_description"]',
        '#item_desc',
    ],
};

export const rakutenShopHotProductsScene = {
    itemSelectors: [
        '[class*="ranking-item"]',
        '.searchresultitem',
        '.dui-card',
    ],
    titleSelectors: [
        '[class*="title-link--"]',
        'a[href*="item.rakuten.co.jp"]',
    ],
    linkSelectors: [
        '[class*="title-link--"]',
        'a[href*="item.rakuten.co.jp"]',
    ],
    priceSelectors: [
        '[class*="price--"]',
        '[class*="important"]',
    ],
    imageSelectors: [
        '[class*="image"] img',
        'img[src*="tshop.r10s.jp"]',
    ],
    badgeSelectors: [
        '[class*="ranking"]',
        '[class*="rating"]',
    ],
    itemAncestorSelectors: RAKUTEN_ITEM_ANCESTORS,
};
