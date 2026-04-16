import { publishToYouTube as runYoutubePublish } from '../../platforms/youtube.js';

export const YOUTUBE_PUBLISH_TASK_KEY = 'publish:youtube';

export async function executeYoutubePublishTask(payload = {}) {
    return await runYoutubePublish(payload);
}

export default executeYoutubePublishTask;
