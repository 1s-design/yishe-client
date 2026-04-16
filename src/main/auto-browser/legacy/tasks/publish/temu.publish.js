import { publishToTemu as runTemuPublish } from '../../platforms/temu/index.js';

export const TEMU_PUBLISH_TASK_KEY = 'publish:temu';

export async function executeTemuPublishTask(payload = {}) {
    return await runTemuPublish(payload);
}

export default executeTemuPublishTask;

