import { publishToWeibo as runWeiboPublish } from '../../platforms/weibo.js';

export const WEIBO_PUBLISH_TASK_KEY = 'publish:weibo';

export async function executeWeiboPublishTask(payload = {}) {
    return await runWeiboPublish(payload);
}

export default executeWeiboPublishTask;
