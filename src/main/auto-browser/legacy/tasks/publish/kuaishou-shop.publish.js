import { publishToKuaishouShop as runKuaishouShopPublish } from '../../platforms/kuaishouShop.js';

export const KUAISHOU_SHOP_PUBLISH_TASK_KEY = 'publish:kuaishou_shop';

export async function executeKuaishouShopPublishTask(payload = {}) {
    return await runKuaishouShopPublish(payload);
}

export default executeKuaishouShopPublishTask;
