import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const NEWEGG_ITEM_ANCESTORS = [
    '.item-cell',
    '.item-container',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const neweggSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.newegg.com/p/pl?d=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: ['.item-cell', '.item-container'],
    itemIdAttrs: ['id'],
    titleSelectors: ['.item-title'],
    subtitleSelectors: [
        '.item-features li',
        '.item-branding',
    ],
    linkSelectors: ['a.item-title', 'a.item-img'],
    priceSelectors: ['.price-current'],
    imageSelectors: ['a.item-img img', '.item-img img'],
    shopSelectors: [
        '.item-sellers .d2c-section-title span',
        '.item-branding',
    ],
    badgeSelectors: [
        '.item-promo',
        '.price-ship',
    ],
    itemAncestorSelectors: NEWEGG_ITEM_ANCESTORS,
};

export const neweggProductDetailScene = {
    titleSelectors: ['h1.product-title'],
    priceSelectors: [
        '.product-buy-box .price-current',
        '.product-wrap .price-current',
        'li.price-current',
    ],
    imageSelectors: [
        '.product-view-img-original',
        '#product-overview img',
        '.swiper-slide img',
    ],
    shopSelectors: [
        'a[href*="/Seller-Store/"] strong',
        'a[href*="/Seller-Store/"]',
        '.seller-store-link',
    ],
    descriptionSelectors: [
        '.product-bullets',
        '#overview-content',
        '#product-details .tab-panes',
    ],
};

export const neweggShopHotProductsScene = {
    itemSelectors: ['.item-cell', '.item-container', 'a.item-title'],
    titleSelectors: [...neweggSearchScene.titleSelectors],
    subtitleSelectors: [...neweggSearchScene.subtitleSelectors],
    linkSelectors: [...neweggSearchScene.linkSelectors],
    priceSelectors: [...neweggSearchScene.priceSelectors],
    imageSelectors: [...neweggSearchScene.imageSelectors],
    shopSelectors: [...neweggSearchScene.shopSelectors],
    badgeSelectors: [...neweggSearchScene.badgeSelectors],
    itemAncestorSelectors: NEWEGG_ITEM_ANCESTORS,
};
