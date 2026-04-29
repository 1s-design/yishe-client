import { publishToTaobao as runTaobaoPublish } from '../../platforms/taobao.js';

export const TAOBAO_PUBLISH_TASK_KEY = 'publish:taobao';

export async function executeTaobaoPublishTask(payload = {}) {
    return await runTaobaoPublish(payload);
}

export default executeTaobaoPublishTask;
