import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const MERCADOLIBRE_ITEM_ANCESTORS = [
    '.ui-search-result',
    '.andes-card',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const mercadolibreSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        `https://listado.mercadolibre.com.mx/${encodeURIComponent(keyword)}_Desde_${(page - 1) * 50 + 1}`,
    itemSelectors: [
        '.ui-search-result',
        '.andes-card',
        'li.ui-search-layout__item',
    ],
    itemIdAttrs: ['data-id'],
    titleSelectors: [
        'h2.ui-search-item__title',
        '.ui-search-item__title',
        'a[class*="title"]',
    ],
    linkSelectors: [
        'a.ui-search-link',
        'a[href*="mercadolibre.com"]',
        'h2 a',
    ],
    priceSelectors: [
        '.price-tag-fraction',
        '[class*="price"] .fraction',
        '.andes-money-amount__fraction',
    ],
    imageSelectors: [
        '.ui-search-result-image img',
        'img[src*="mlstatic"]',
        'img[data-src]',
    ],
    shopSelectors: [
        '.ui-search-item__brand',
        '[class*="seller"]',
    ],
    badgeSelectors: [
        '.ui-search-item__highlight',
        '[class*="badge"]',
        '[class*="highlight"]',
    ],
    itemAncestorSelectors: MERCADOLIBRE_ITEM_ANCESTORS,
};

export const mercadolibreProductDetailScene = {
    titleSelectors: [
        'h1.ui-pdp-title',
        '.ui-pdp-title',
        'h1[class*="title"]',
    ],
    priceSelectors: [
        '.andes-money-amount__fraction',
        '.price-tag-fraction',
        '[class*="price"] .fraction',
    ],
    imageSelectors: [
        '.ui-pdp-gallery__figure img',
        'img[src*="mlstatic"]',
    ],
    shopSelectors: [
        '.ui-pdp-seller__header__title',
        '[class*="seller"]',
    ],
    descriptionSelectors: [
        '.ui-pdp-description',
        '[class*="description"]',
    ],
};

export const mercadolibreShopHotProductsScene = {
    itemSelectors: [
        '.ui-search-result',
        '.andes-card',
        'li.ui-search-layout__item',
    ],
    titleSelectors: [
        'h2.ui-search-item__title',
        '.ui-search-item__title',
    ],
    linkSelectors: [
        'a.ui-search-link',
        'a[href*="mercadolibre.com"]',
    ],
    priceSelectors: [
        '.price-tag-fraction',
        '.andes-money-amount__fraction',
    ],
    imageSelectors: [
        'img[src*="mlstatic"]',
    ],
    badgeSelectors: [
        '[class*="highlight"]',
    ],
    itemAncestorSelectors: MERCADOLIBRE_ITEM_ANCESTORS,
};
