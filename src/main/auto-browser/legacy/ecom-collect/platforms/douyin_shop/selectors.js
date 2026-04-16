import { SHARED_LIST_ITEM_ANCESTORS } from '../shared.js';

async function prepareDouyinSearchPage({ page, keyword }) {
    await page.evaluate(() => {
        document
            .querySelectorAll('[id*="login-full-panel"], .oMpq4HiN, .GzPW6isY')
            .forEach((node) => node.remove());
    }).catch(() => {});

    const searchInput = page.locator('input[data-e2e="searchbar-input"], input[placeholder*="搜索"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
    await searchInput.fill(keyword);

    const searchButton = page.locator('button[data-e2e="searchbar-button"]').first();
    if (await searchButton.count()) {
        await searchButton.click({ force: true, timeout: 10_000 }).catch(async () => {
            await page.evaluate(() => {
                document.querySelector('button[data-e2e="searchbar-button"]')?.click();
            });
        });
    } else {
        await searchInput.press('Enter').catch(async () => {
            await page.keyboard.press('Enter');
        });
    }

    await page.waitForTimeout(3_000);
}

export const douyinShopSearchScene = {
    buildUrl: () => 'https://www.douyin.com/jingxuan',
    itemSelectors: ['a[href*="/product/"]', '[data-e2e*="product"]'],
    titleSelectors: ['[data-e2e*="title"]', '[class*="title"]'],
    linkSelectors: ['a[href*="/product/"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['[class*="shop"]'],
    badgeSelectors: ['[class*="tag"]'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
    preparePage: prepareDouyinSearchPage,
};

export const douyinShopProductDetailScene = {
    titleSelectors: ['h1', '[class*="title"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    shopSelectors: ['a[href*="/shop/"]'],
    descriptionSelectors: ['[class*="description"]'],
};

export const douyinShopHotProductsScene = {
    itemSelectors: ['a[href*="/product/"]'],
    titleSelectors: ['[class*="title"]'],
    linkSelectors: ['a[href*="/product/"]'],
    priceSelectors: ['[class*="price"]'],
    imageSelectors: ['img'],
    itemAncestorSelectors: SHARED_LIST_ITEM_ANCESTORS,
};
