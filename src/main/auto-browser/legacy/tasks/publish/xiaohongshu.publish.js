import { publishToXiaohongshu as runXiaohongshuPublish } from '../../platforms/xiaohongshu.js';

export const XIAOHONGSHU_PUBLISH_TASK_KEY = 'publish:xiaohongshu';

export async function executeXiaohongshuPublishTask(payload = {}) {
    return await runXiaohongshuPublish(payload);
}

export default executeXiaohongshuPublishTask;
