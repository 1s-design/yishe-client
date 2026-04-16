import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const EBAY_ITEM_ANCESTORS = [
    'li.s-item',
    '.srp-results li',
    '[data-view*="mi:"]',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const ebaySearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&_pgn=${page}`,
    itemSelectors: ['li.s-item[data-viewport]', 'li.s-item'],
    itemIdAttrs: ['id', 'data-view'],
    titleSelectors: [
        '.s-item__title .ux-textspans',
        '.s-item__title span[role="heading"]',
        '.s-item__title',
    ],
    subtitleSelectors: [
        '.s-item__subtitle',
        '.SECONDARY_INFO',
        '.s-item__dynamic.s-item__subtitle',
    ],
    linkSelectors: ['a.s-item__link', 'a[href*="/itm/"]'],
    priceSelectors: [
        '.s-item__price',
        '.s-item__detail--primary .s-item__price',
    ],
    imageSelectors: [
        '.s-item__image img',
        '.s-item__image-wrapper img',
    ],
    shopSelectors: [
        '.s-item__seller-info-text',
        '.s-item__seller-info-text .ux-textspans',
        '.s-item__subtitle',
    ],
    badgeSelectors: [
        '.s-item__purchase-options-with-icon',
        '.s-item__hotness',
        '.s-item__dynamic .SECONDARY_INFO',
        '.s-item__bids',
    ],
    itemAncestorSelectors: EBAY_ITEM_ANCESTORS,
};

export const ebayProductDetailScene = {
    titleSelectors: [
        '[data-testid="x-item-title"] .ux-textspans--BOLD',
        '.x-item-title__mainTitle .ux-textspans--BOLD',
        '.x-item-title .ux-textspans--BOLD',
    ],
    priceSelectors: [
        '[data-testid="x-price-primary"] .ux-textspans',
        '.x-price-primary .ux-textspans',
        '.display-price .ux-textspans',
        '.notranslate',
    ],
    imageSelectors: [
        '.ux-image-grid img',
        '.x-photos-min-view img',
        '.ux-image-carousel-item img',
        '.ux-image-filmstrip-item img',
    ],
    shopSelectors: [
        '[data-testid="x-sellercard-atf"] .ux-textspans--BOLD',
        '.x-sellercard-atf .ux-textspans--BOLD',
        '.x-store-information__store-name .ux-textspans--BOLD',
    ],
    descriptionSelectors: [
        '#viTabs_0_is',
        '[data-testid="x-item-condition"]',
        '.x-item-condition-text',
        '.ux-labels-values--condition',
        '.ux-layout-section__textual-display',
        '.x-store-information',
    ],
};

export const ebayShopHotProductsScene = {
    itemSelectors: ['li.s-item[data-viewport]', 'li.s-item', 'a[href*="/itm/"]'],
    titleSelectors: [...ebaySearchScene.titleSelectors],
    linkSelectors: [...ebaySearchScene.linkSelectors],
    priceSelectors: [...ebaySearchScene.priceSelectors],
    imageSelectors: [...ebaySearchScene.imageSelectors],
    shopSelectors: [...ebaySearchScene.shopSelectors],
    badgeSelectors: [...ebaySearchScene.badgeSelectors],
    itemAncestorSelectors: EBAY_ITEM_ANCESTORS,
};
