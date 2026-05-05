import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const REDDIT_ITEM_ANCESTORS = [
    '[data-testid="post-container"]',
    'article',
    '[role="article"]',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const redditSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.reddit.com/search/?q=${encodeURIComponent(keyword)}`,
    itemSelectors: [
        '[data-testid="post-container"]',
        'article',
        '[role="article"]',
    ],
    itemIdAttrs: ['data-testid'],
    titleSelectors: [
        '[data-testid="post-title"]',
        'h3',
        'h2',
        '[class*="title"]',
    ],
    linkSelectors: [
        'a[href*="/comments/"]',
        '[data-testid="post-title"] a',
    ],
    priceSelectors: [],
    imageSelectors: [
        'img[src*="preview.redd.it"]',
        'img[src*="i.redd.it"]',
        'img',
    ],
    shopSelectors: [],
    badgeSelectors: [
        '[class*="flair"]',
        '[class*="tag"]',
    ],
    itemAncestorSelectors: REDDIT_ITEM_ANCESTORS,
};

export const redditProductDetailScene = {
    titleSelectors: [
        '[data-testid="post-title"]',
        'h1',
    ],
    priceSelectors: [],
    imageSelectors: [
        'img[src*="preview.redd.it"]',
        'img[src*="i.redd.it"]',
    ],
    shopSelectors: [
        '[class*="author"]',
    ],
    descriptionSelectors: [
        '[data-testid="post-content"]',
        '[class*="content"]',
    ],
};

export const redditShopHotProductsScene = {
    itemSelectors: [
        '[data-testid="post-container"]',
        'article',
    ],
    titleSelectors: [
        '[data-testid="post-title"]',
        'h3',
    ],
    linkSelectors: [
        'a[href*="/comments/"]',
    ],
    priceSelectors: [],
    imageSelectors: [
        'img[src*="preview.redd.it"]',
    ],
    badgeSelectors: [
        '[class*="flair"]',
    ],
    itemAncestorSelectors: REDDIT_ITEM_ANCESTORS,
};
