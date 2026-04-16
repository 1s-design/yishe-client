import { publishToKuaishou as runKuaishouPublish } from '../../platforms/kuaishou.js';

export const KUAISHOU_PUBLISH_TASK_KEY = 'publish:kuaishou';

export async function executeKuaishouPublishTask(payload = {}) {
    return await runKuaishouPublish(payload);
}

export default executeKuaishouPublishTask;
