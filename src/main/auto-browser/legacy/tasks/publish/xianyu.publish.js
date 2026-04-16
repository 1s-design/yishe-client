import { publishToXianyu as runXianyuPublish } from '../../platforms/xianyu.js';

export const XIANYU_PUBLISH_TASK_KEY = 'publish:xianyu';

export async function executeXianyuPublishTask(payload = {}) {
    return await runXianyuPublish(payload);
}

export default executeXianyuPublishTask;
