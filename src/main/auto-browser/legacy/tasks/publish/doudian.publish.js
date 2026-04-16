import { publishToDoudian as runDoudianPublish } from '../../platforms/doudian.js';

export const DOUDIAN_PUBLISH_TASK_KEY = 'publish:doudian';

export async function executeDoudianPublishTask(payload = {}) {
    return await runDoudianPublish(payload);
}

export default executeDoudianPublishTask;
