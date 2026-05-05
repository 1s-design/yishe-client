import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const PINTEREST_ITEM_ANCESTORS = [
    '[class*="PinCard"]',
    '.PinCard__imageWrapper',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const pinterestSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`,
    itemSelectors: [
        '[class*="PinCard__imageWrapper"]',
        '[data-test-id="pin"]',
        '[class*="pin"]',
    ],
    itemIdAttrs: ['data-pin-id'],
    titleSelectors: [
        '[class*="title"]',
        'a[href*="/pin/"]',
    ],
    linkSelectors: [
        'a[href*="/pin/"]',
    ],
    priceSelectors: [
        '[class*="price"]',
    ],
    imageSelectors: [
        'img[src*="pinimg.com"]',
        'img',
    ],
    shopSelectors: [],
    badgeSelectors: [],
    itemAncestorSelectors: PINTEREST_ITEM_ANCESTORS,
};

export const pinterestProductDetailScene = {
    titleSelectors: [
        'h1',
        '[class*="title"]',
    ],
    priceSelectors: [
        '[class*="price"]',
    ],
    imageSelectors: [
        'img[src*="pinimg.com"]',
    ],
    shopSelectors: [
        '[class*="author"]',
    ],
    descriptionSelectors: [
        '[class*="description"]',
    ],
};

export const pinterestShopHotProductsScene = {
    itemSelectors: [
        '[class*="PinCard__imageWrapper"]',
    ],
    titleSelectors: [
        '[class*="title"]',
    ],
    linkSelectors: [
        'a[href*="/pin/"]',
    ],
    priceSelectors: [
        '[class*="price"]',
    ],
    imageSelectors: [
        'img[src*="pinimg.com"]',
    ],
    badgeSelectors: [],
    itemAncestorSelectors: PINTEREST_ITEM_ANCESTORS,
};
