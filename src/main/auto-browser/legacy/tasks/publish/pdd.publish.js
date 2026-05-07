import { publishToPdd as runPddPublish } from '../../platforms/pdd.js';

export const PDD_PUBLISH_TASK_KEY = 'publish:pdd';

export async function executePddPublishTask(payload = {}) {
    return await runPddPublish(payload);
}

export default executePddPublishTask;
