import { publishToDouyin as runDouyinPublish } from '../../platforms/douyin.js';

export const DOUYIN_PUBLISH_TASK_KEY = 'publish:douyin';

export async function executeDouyinPublishTask(payload = {}) {
    return await runDouyinPublish(payload);
}

export default executeDouyinPublishTask;
