import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const WALMART_ITEM_ANCESTORS = [
    'div[role="group"][data-item-id]',
    '[data-item-id]',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const walmartSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: [
        'div[role="group"][data-item-id]',
        '[data-item-id]',
    ],
    itemIdAttrs: ['data-item-id'],
    titleSelectors: [
        'h3[data-automation-id="product-title"]',
        '[data-automation-id="product-title"]',
    ],
    subtitleSelectors: [
        'span[data-testid="product-reviews"]',
        'div[data-testid="product-ratings"]',
    ],
    linkSelectors: [
        'a.w-100.h-100.z-1.hide-sibling-opacity.absolute[href*="/ip/"]',
        'a[href*="/ip/"]',
    ],
    priceSelectors: [
        '[data-automation-id="product-price"]',
        '[data-testid="price-wrap"]',
        '[itemprop="price"]',
        'span.f6.f5-l',
    ],
    imageSelectors: [
        'img[data-testid="productTileImage"]',
        'img[loading="eager"]',
        'img',
    ],
    shopSelectors: [
        '[data-testid="product-seller-info"]',
        '[data-automation-id="fulfillment-badge"]',
    ],
    badgeSelectors: [
        '[data-testid="list-view-badge"]',
        '[data-testid="custom-product-badge"]',
        '[data-testid="variant-pill"]',
    ],
    itemAncestorSelectors: WALMART_ITEM_ANCESTORS,
};

export const walmartProductDetailScene = {
    titleSelectors: [
        'h1[data-automation-id="product-title"]',
        'h1[itemprop="name"]',
        'h1',
    ],
    priceSelectors: [
        '[data-testid="price-wrap"]',
        '[data-automation-id="product-price"]',
        '[itemprop="price"]',
    ],
    imageSelectors: [
        'img[data-testid="hero-image"]',
        'img[src*="i5.walmartimages.com"]',
        'img[src*="walmartimages.com"]',
    ],
    shopSelectors: [
        '[data-testid="sold-and-shipped-by"]',
        'a[href*="/seller/"]',
        '[data-automation-id="sold-and-shipped-by"]',
    ],
    descriptionSelectors: [
        '[data-testid="product-description-content"]',
        '#product-description',
        '[itemprop="description"]',
        '[data-testid="specifications"]',
    ],
};

export const walmartShopHotProductsScene = {
    itemSelectors: [
        'div[role="group"][data-item-id]',
        '[data-item-id]',
        'a[href*="/ip/"]',
    ],
    titleSelectors: [...walmartSearchScene.titleSelectors],
    subtitleSelectors: [...walmartSearchScene.subtitleSelectors],
    linkSelectors: [...walmartSearchScene.linkSelectors],
    priceSelectors: [...walmartSearchScene.priceSelectors],
    imageSelectors: [...walmartSearchScene.imageSelectors],
    shopSelectors: [...walmartSearchScene.shopSelectors],
    badgeSelectors: [...walmartSearchScene.badgeSelectors],
    itemAncestorSelectors: WALMART_ITEM_ANCESTORS,
};
