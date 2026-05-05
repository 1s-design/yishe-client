import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const XIAOHONGSHU_ITEM_ANCESTORS = [
    '[class*="note-item"]',
    '[class*="NoteItem"]',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const xiaohongshuSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes&type=51`,
    itemSelectors: [
        '[class*="note-item"]',
        '[class*="NoteItem"]',
        'section[class*="note"]',
    ],
    itemIdAttrs: ['data-note-id'],
    titleSelectors: [
        '[class*="title"]',
        '[class*="note-text"]',
        'a[class*="title"]',
    ],
    linkSelectors: [
        'a[href*="/explore/"]',
        'a[href*="/discovery/item/"]',
    ],
    priceSelectors: [],
    imageSelectors: [
        'img[src*="xhscdn.com"]',
        'img[src*="sns-img"]',
        'img',
    ],
    shopSelectors: [
        '[class*="author"]',
        '[class*="nickname"]',
    ],
    badgeSelectors: [
        '[class*="tag"]',
    ],
    itemAncestorSelectors: XIAOHONGSHU_ITEM_ANCESTORS,
};

export const xiaohongshuProductDetailScene = {
    titleSelectors: [
        '[class*="title"]',
        '#detail-title',
    ],
    priceSelectors: [
        '[class*="price"]',
    ],
    imageSelectors: [
        'img[src*="xhscdn.com"]',
    ],
    shopSelectors: [
        '[class*="author"]',
        '[class*="nickname"]',
    ],
    descriptionSelectors: [
        '[class*="desc"]',
        '[class*="content"]',
    ],
};

export const xiaohongshuShopHotProductsScene = {
    itemSelectors: [
        '[class*="note-item"]',
        '[class*="NoteItem"]',
    ],
    titleSelectors: [
        '[class*="title"]',
    ],
    linkSelectors: [
        'a[href*="/explore/"]',
    ],
    priceSelectors: [],
    imageSelectors: [
        'img[src*="xhscdn.com"]',
    ],
    badgeSelectors: [],
    itemAncestorSelectors: XIAOHONGSHU_ITEM_ANCESTORS,
};
