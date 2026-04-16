import { publishToTiktok as runTiktokPublish } from '../../platforms/tiktok.js';

export const TIKTOK_PUBLISH_TASK_KEY = 'publish:tiktok';

export async function executeTiktokPublishTask(payload = {}) {
    return await runTiktokPublish(payload);
}

export default executeTiktokPublishTask;
