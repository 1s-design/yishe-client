import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

async function prepareJdSearchPage({ page, keyword, pageNo }) {
    if (pageNo > 1) {
        return;
    }

    const searchInput = page.locator('input[aria="搜索"], input[class*="search_input"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
    await searchInput.fill(keyword);

    const searchButton = page.locator('button[class*="search_btn"]').first();
    if (await searchButton.count()) {
        await searchButton.click({ force: true, timeout: 10_000 }).catch(async () => {
            await page.evaluate(() => {
                document.querySelector('button[class*="search_btn"]')?.click();
            });
        });
    } else {
        await searchInput.press('Enter').catch(async () => {
            await page.keyboard.press('Enter');
        });
    }

    await page.waitForTimeout(3_000);
}

export const jdSearchScene = {
    buildUrl: ({ keyword, page = 1 }) =>
        page <= 1
            ? 'https://hk.jd.com/'
            : `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&page=${Math.max(1, page * 2 - 1)}`,
    itemSelectors: ['.gl-item[data-sku]', 'li.gl-item'],
    itemIdAttrs: ['data-sku'],
    titleSelectors: ['.p-name em', '.p-name'],
    linkSelectors: ['.p-name a'],
    priceSelectors: ['.p-price strong', '.p-price'],
    imageSelectors: ['.p-img img', '.p-img source'],
    shopSelectors: ['.p-shop a', '.curr-shop-hd'],
    badgeSelectors: ['.p-icons i'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
    preparePage: prepareJdSearchPage,
};

export const jdProductDetailScene = {
    titleSelectors: ['.sku-name'],
    priceSelectors: ['.p-price .price', '.summary-price .p-price'],
    imageSelectors: ['#spec-img', '#spec-n1 img'],
    shopSelectors: ['#crumb-wrap .item a', '#shop-name'],
    descriptionSelectors: ['#detail', '#J-detail'],
};

export const jdHotProductsScene = {
    itemSelectors: ['.recommend_list .item', '.gl-item[data-sku]', '.jGoodsList li'],
    itemIdAttrs: ['clstag', 'data-sku'],
    titleSelectors: ['.item_title', '.p-name em', '.p-name'],
    linkSelectors: ['.p-name a'],
    priceSelectors: ['.price', '.p-price strong', '.p-price'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
