import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const alibaba1688SearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}&beginPage=${Math.max(1, page)}`,
    itemSelectors: [
        '[data-offerid]',
        'a[href*="detail.1688.com/offer/"]',
        '[class*="offer-card"]',
    ],
    titleSelectors: [
        '[title]',
        'h2',
        '[class*="title"]',
        '[class*="subject"]',
        'img[alt]',
    ],
    linkSelectors: ['a[href*="detail.1688.com/offer/"]'],
    priceSelectors: [
        '[class*="price"]',
        '[class*="Price"]',
        '[data-role*="price"]',
    ],
    imageSelectors: ['img'],
    shopSelectors: [
        '[class*="company"]',
        '[class*="shop"]',
        '[class*="seller"]',
        '[class*="merchant"]',
    ],
    badgeSelectors: [
        '[class*="tag"]',
        '[class*="service"]',
        '[class*="icon"]',
    ],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const alibaba1688ProductDetailScene = {
    titleSelectors: ['h1', '[class*="title"]', '[data-name="title"]'],
    priceSelectors: [
        '[class*="price"]',
        '[class*="reference"]',
        '[data-role*="price"]',
    ],
    imageSelectors: ['img'],
    shopSelectors: [
        'a[href*="company"]',
        '[class*="company"]',
        '[class*="shop"]',
        '[class*="seller"]',
    ],
    descriptionSelectors: [
        '[class*="detail-content"]',
        '[class*="desc"]',
        '#desc-lazyload-container',
        '#mod-detail-description',
    ],
};

export const alibaba1688HotProductsScene = {
    itemSelectors: ['a[href*="detail.1688.com/offer/"]'],
    titleSelectors: ['[title]', '[class*="title"]', 'img[alt]'],
    linkSelectors: ['a[href*="detail.1688.com/offer/"]'],
    priceSelectors: ['[class*="price"]', '[class*="Price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="company"]', '[class*="shop"]'],
    badgeSelectors: ['[class*="tag"]', '[class*="service"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
