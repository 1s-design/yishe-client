import { uploadTemuImagesToCloud } from './imageUpload.js';

const TEMU_REAL_PICTURE_UPLOAD_TAG = 'flash-tag';
const TEMU_REAL_PICTURE_STORE_IMAGE_URL =
  'https://agentseller.temu.com/api/galerie/v3/store_image?sdk_version=js-0.0.33&tag_name=flash-tag';

export async function uploadTemuRealPictureImagesToCloud(page, imageSources = [], options = {}) {
  return uploadTemuImagesToCloud(page, imageSources, {
    ...options,
    resourceLabel: options.resourceLabel || '实拍图',
    uploadTag: TEMU_REAL_PICTURE_UPLOAD_TAG,
    storeImageUrl: TEMU_REAL_PICTURE_STORE_IMAGE_URL
  });
}
