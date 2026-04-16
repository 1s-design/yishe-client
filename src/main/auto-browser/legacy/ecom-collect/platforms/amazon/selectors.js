import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

export const AMAZON_BESTSELLER_ITEM_ANCESTORS = [
    '[class*="p13n-sc-uncoverable-faceout"]',
    '[class*="zg"]',
    ...SHARED_LIST_ITEM_ANCESTORS,
];

export const amazonSearchScene = {
    buildUrl: ({ keyword, page = 1 }) => `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&page=${page}`,
    itemSelectors: ['[data-component-type="s-search-result"][data-asin]'],
    itemIdAttrs: ['data-asin'],
    titleSelectors: ['h2 a span', 'h2 span'],
    linkSelectors: ['h2 a.a-link-normal', 'a.a-link-normal.s-no-outline'],
    priceSelectors: ['.a-price .a-offscreen', '.a-price-whole'],
    imageSelectors: ['img.s-image'],
    shopSelectors: ['.s-line-clamp-1 .a-size-base-plus', '.a-row.a-size-base.a-color-secondary'],
    badgeSelectors: ['.a-badge-label-inner', '.a-icon-alt'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};

export const amazonProductDetailScene = {
    titleSelectors: ['#productTitle'],
    priceSelectors: ['.a-price .a-offscreen', '#corePrice_feature_div .a-offscreen'],
    imageSelectors: ['#landingImage', '#imgTagWrapperId img'],
    shopSelectors: ['#bylineInfo', '#sellerProfileTriggerId'],
    descriptionSelectors: ['#feature-bullets', '#productFactsDesktop_feature_div'],
};

export const amazonShopHotProductsScene = {
    itemSelectors: ['[class*="p13n-sc-uncoverable-faceout"]', '[data-component-type="s-search-result"][data-asin]', 'a[href*="/dp/"]'],
    titleSelectors: ['[class*="p13n-sc-truncated"]', '[class*="line-clamp"]', 'h2 a span', '[data-asin] h2 span'],
    linkSelectors: ['h2 a.a-link-normal', 'a[href*="/dp/"]'],
    priceSelectors: ['[class*="p13n-sc-price"]', '.a-price .a-offscreen', '[class*="price"]'],
    imageSelectors: ['img'],
    badgeSelectors: ['.a-icon-alt', '[class*="review"]'],
    itemAncestorSelectors: AMAZON_BESTSELLER_ITEM_ANCESTORS,
};
