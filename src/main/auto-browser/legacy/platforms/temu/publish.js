import { getOrCreateBrowser } from '../../services/BrowserService.js';
import { PageOperator } from '../../services/PageOperator.js';
import { logger } from '../../utils/logger.js';
import { PLATFORM_NAME } from './constants.js';
import {
    normalizeTemuSettings,
    pushTrace,
    resolveTemuCategoryIntent
} from './utils.js';
import {
    resolveTemuLoginState
} from './login.js';
import {
    ensureTemuCreatePage,
    performTemuCategorySelection
} from './category.js';
import {
    resolveTemuFrameworkStage,
    collectTemuFrameworkSnapshot,
    collectTemuEditPageStructure
} from './page.js';
import {
    runTemuLoginSmallFeature
} from './smallFeatures.js';
import {
    bindTemuUploadedImagesToEditPage,
    createTemuLiveRequestCapture,
    uploadTemuPublishImages
} from './imageUpload.js';
import {
    fillTemuPublishBasicInfo
} from './editForm.js';
import {
    hasTemuProductTemplate,
    publishTemuByProductTemplate
} from './templatePublish.js';

export async function publishToTemu(publishInfo = {}) {
    const pageOperator = new PageOperator();
    const settings = normalizeTemuSettings(publishInfo);
    let page = null;
    let shouldKeepPageOpen = settings.keepPageOpen;
    let requestCapture = null;
    let publishImageUploadResult = null;
    let publishImageBindResult = null;
    let publishBasicInfoResult = null;
    const executionTrace = [];

    try {
        logger.info(`${PLATFORM_NAME}发布骨架启动`, {
            createUrl: settings.createUrl,
            needLogin: settings.needLogin,
            hasAccount: !!settings.account,
            hasPassword: !!settings.password,
            keepPageOpen: settings.keepPageOpen
        });
        pushTrace(executionTrace, 'start', 'success', {
            createUrl: settings.createUrl,
            needLogin: settings.needLogin,
            keepPageOpen: settings.keepPageOpen
        });

        const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
        page = await browser.newPage({ foreground: true });
        await pageOperator.setupAntiDetection(page);

        if (hasTemuProductTemplate(publishInfo)) {
            pushTrace(executionTrace, 'detect_product_template_publish', 'success', {
                mode: 'template_api_publish'
            });

            return await publishTemuByProductTemplate(page, publishInfo, {
                executionTrace,
                shouldKeepPageOpen
            });
        }

        requestCapture = createTemuLiveRequestCapture(page.context());

        logger.info(`${PLATFORM_NAME}准备打开商品创建页: ${settings.createUrl}`);
        await page.goto(settings.createUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(4000);
        pushTrace(executionTrace, 'open_create_page', 'success', {
            currentUrl: page.url()
        });

        let loginState = await resolveTemuLoginState(page);
        logger.info(`${PLATFORM_NAME}登录检测结果: ${loginState.loggedIn ? '已登录' : '未登录'}`, loginState);
        pushTrace(executionTrace, 'check_login_state', loginState.loggedIn ? 'success' : 'pending', loginState);

        if (!loginState.loggedIn) {
            if (settings.needLogin) {
                const loginResult = await runTemuLoginSmallFeature({
                    ...publishInfo,
                    account: settings.account,
                    password: settings.password,
                    loginUrl: settings.loginUrl,
                    keepPageOpen: true,
                    profileId: publishInfo?.profileId
                }, {
                    page,
                    pageOperator
                });
                if (!loginResult.success) {
                    pushTrace(executionTrace, 'perform_login', 'failed', {
                        reason: loginResult.data?.loginState?.reason || loginResult.message,
                        currentUrl: page.url()
                    });
                    const snapshot = await collectTemuFrameworkSnapshot(page);
                    return {
                        success: false,
                        message: loginResult.message || `${PLATFORM_NAME}自动登录失败`,
                        data: {
                            frameworkReady: false,
                            loginRequired: true,
                            autoLoginAttempted: true,
                            autoLoginSuccess: false,
                            currentUrl: page.url(),
                            pageTitle: snapshot.title,
                            detectedButtons: snapshot.buttons,
                            detectedInputs: snapshot.inputs,
                            loginState: loginResult.data?.loginState || null,
                            bodyPreview: loginResult.data?.bodyPreview || snapshot.bodyPreview,
                            loginFeatureResult: loginResult.data || null,
                            executionTrace,
                            pageKeptOpen: shouldKeepPageOpen
                        }
                    };
                }

                pushTrace(executionTrace, 'perform_login', 'success', {
                    via: 'temu_login_small_feature',
                    message: loginResult.message,
                    currentUrl: page.url()
                });
                await ensureTemuCreatePage(page, settings.createUrl);
                loginState = await resolveTemuLoginState(page);
            } else {
                const snapshot = await collectTemuFrameworkSnapshot(page);
                return {
                    success: false,
                    message: `请先登录${PLATFORM_NAME}商家后台`,
                    data: {
                        frameworkReady: false,
                        loginRequired: true,
                        autoLoginAttempted: false,
                        currentUrl: page.url(),
                        pageTitle: snapshot.title,
                        detectedButtons: snapshot.buttons,
                        detectedInputs: snapshot.inputs,
                        executionTrace,
                        pageKeptOpen: shouldKeepPageOpen
                    }
                };
            }
        }

        const createPageState = await ensureTemuCreatePage(page, settings.createUrl);
        pushTrace(executionTrace, 'ensure_create_page', 'success', createPageState);

        const categoryResult = await performTemuCategorySelection(page, publishInfo, pageOperator);
        if (!categoryResult.success) {
            pushTrace(executionTrace, 'category_selection', 'failed', {
                reason: categoryResult.reason,
                currentUrl: page.url()
            });
            const snapshot = await collectTemuFrameworkSnapshot(page);
            return {
                success: false,
                message: categoryResult.reason === 'category_search_no_result'
                    ? `${PLATFORM_NAME}类目搜索未命中结果，无法继续进入编辑页`
                    : categoryResult.reason === 'edit_page_not_reached'
                        ? `${PLATFORM_NAME}已完成类目点击，但暂未进入商品编辑页`
                        : `${PLATFORM_NAME}类目选择流程执行失败`,
                data: {
                    frameworkReady: true,
                    frameworkStage: resolveTemuFrameworkStage(page.url()),
                    loginRequired: false,
                    autoLoginAttempted: settings.needLogin,
                    autoLoginSuccess: true,
                    categorySelectionCompleted: false,
                    categoryIntent: categoryResult.categoryIntent || resolveTemuCategoryIntent(publishInfo),
                    categorySearchResult: categoryResult.searchResult || null,
                    clickedCategoryItems: categoryResult.clickedItems || [],
                    currentUrl: page.url(),
                    pageTitle: snapshot.title,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    executionTrace,
                    pageKeptOpen: shouldKeepPageOpen
                }
            };
        }

        if (categoryResult.skipped) {
            pushTrace(executionTrace, 'category_selection', 'pending', {
                reason: categoryResult.reason,
                currentUrl: page.url()
            });
        } else {
            pushTrace(executionTrace, 'category_selection', 'success', {
                keyword: categoryResult.searchResult?.keyword || categoryResult.categoryIntent?.primaryKeyword || '',
                clickedItems: categoryResult.clickedItems?.map((item) => item.text) || [],
                currentUrl: page.url()
            });
        }

        const snapshot = await collectTemuFrameworkSnapshot(page);
        const frameworkStage = resolveTemuFrameworkStage(page.url());
        if (frameworkStage === 'edit_page_ready') {
            shouldKeepPageOpen = true;
            pushTrace(executionTrace, 'wait_edit_page_loaded', 'success', {
                currentUrl: page.url()
            });

            publishImageUploadResult = await uploadTemuPublishImages(page, publishInfo, {
                requestCaptureState: requestCapture?.state || {}
            });
            if (!publishImageUploadResult.success) {
                pushTrace(executionTrace, 'upload_publish_images', 'failed', {
                    requestedImageCount: publishImageUploadResult.requestedImageCount || 0,
                    uploadedCount: publishImageUploadResult.uploadedCount || 0,
                    failedImageCount: Array.isArray(publishImageUploadResult.failedImages)
                        ? publishImageUploadResult.failedImages.length
                        : 0,
                    message: publishImageUploadResult.message || ''
                });

                return {
                    success: false,
                    message: publishImageUploadResult.message || `${PLATFORM_NAME}商品图片上传失败`,
                    data: {
                        frameworkReady: true,
                        frameworkStage,
                        loginRequired: !loginState.loggedIn,
                        autoLoginAttempted: settings.needLogin,
                        autoLoginSuccess: settings.needLogin ? loginState.loggedIn : null,
                        categorySelectionCompleted: !categoryResult.skipped,
                        editPageReady: true,
                        editPageLoaded: true,
                        categoryIntent: categoryResult.categoryIntent || resolveTemuCategoryIntent(publishInfo),
                        categorySearchResult: categoryResult.searchResult || null,
                        clickedCategoryItems: categoryResult.clickedItems || [],
                        currentUrl: page.url(),
                        pageTitle: snapshot.title,
                        detectedButtons: snapshot.buttons,
                        detectedInputs: snapshot.inputs,
                        uploadedPublishImages: publishImageUploadResult.uploadedImages || [],
                        publishImageUploadCompleted: false,
                        publishImageUploadRequestedCount:
                            publishImageUploadResult.requestedImageCount || 0,
                        publishImageUploadUploadedCount:
                            publishImageUploadResult.uploadedCount || 0,
                        publishImageUploadFailedImages:
                            publishImageUploadResult.failedImages || [],
                        executionTrace,
                        pageKeptOpen: shouldKeepPageOpen
                    }
                };
            }

            publishInfo.temuUploadedImages = publishImageUploadResult.uploadedImages || [];
            publishInfo.temuImageUploadSession = publishImageUploadResult.sessionContext || null;
            publishImageBindResult = await bindTemuUploadedImagesToEditPage(
                page,
                publishImageUploadResult.uploadedImages || []
            );
            publishInfo.temuImageBindResult = publishImageBindResult;

            pushTrace(
                executionTrace,
                'bind_publish_images_to_page',
                publishImageBindResult?.skipped
                    ? 'pending'
                    : publishImageBindResult?.success
                        ? 'success'
                        : 'failed',
                {
                    selectedCount: publishImageBindResult?.selectedCount || 0,
                    matchedCount: publishImageBindResult?.matchedCount || 0,
                    message: publishImageBindResult?.message || '',
                    reason: publishImageBindResult?.reason || ''
                }
            );

            pushTrace(
                executionTrace,
                'upload_publish_images',
                publishImageUploadResult.skipped ? 'pending' : 'success',
                {
                    requestedImageCount: publishImageUploadResult.requestedImageCount || 0,
                    uploadedCount: publishImageUploadResult.uploadedCount || 0,
                    skipped: !!publishImageUploadResult.skipped
                }
            );

            publishBasicInfoResult = await fillTemuPublishBasicInfo(page, publishInfo);
            publishInfo.temuBasicInfoFillResult = publishBasicInfoResult;

            pushTrace(
                executionTrace,
                'fill_publish_basic_info',
                publishBasicInfoResult?.skipped
                    ? 'pending'
                    : publishBasicInfoResult?.success
                        ? 'success'
                        : 'failed',
                {
                    titleFilled: !!publishBasicInfoResult?.titleFilled,
                    descriptionFilled: !!publishBasicInfoResult?.descriptionFilled,
                    availableFieldCount: publishBasicInfoResult?.availableFieldCount || 0,
                    message: publishBasicInfoResult?.message || ''
                }
            );
        }
        const editStructure = frameworkStage === 'edit_page_ready'
            ? await collectTemuEditPageStructure(page)
            : null;

        if (editStructure) {
            logger.info(`${PLATFORM_NAME}编辑页结构采集完成`, {
                currentUrl: editStructure.url,
                sectionCount: editStructure.sectionCount,
                inputCount: editStructure.inputCount,
                buttonCount: editStructure.buttonCount
            });
            pushTrace(executionTrace, 'collect_edit_page_structure', 'success', {
                sectionCount: editStructure.sectionCount,
                inputCount: editStructure.inputCount,
                buttonCount: editStructure.buttonCount
            });
        }

        logger.info(`${PLATFORM_NAME}发布基础链路已就绪`, {
            currentUrl: page.url(),
            frameworkStage,
            pageTitle: snapshot.title,
            buttons: snapshot.buttons,
            inputCount: snapshot.inputs.length
        });

        const categoryIntent = categoryResult.categoryIntent || resolveTemuCategoryIntent(publishInfo);
        const categorySelectionCompleted = !categoryResult.skipped && frameworkStage === 'edit_page_ready';
        const autoLoginSuccess = settings.needLogin ? loginState.loggedIn : null;

        return {
            success: true,
            message: frameworkStage === 'edit_page_ready'
                ? publishImageUploadResult?.skipped
                    ? publishBasicInfoResult?.success && !publishBasicInfoResult?.skipped
                        ? `${PLATFORM_NAME}基础链路已打通，当前已进入商品编辑页并完成基础信息填写`
                        : `${PLATFORM_NAME}基础链路已打通，当前已进入商品编辑页`
                    : publishBasicInfoResult?.success && !publishBasicInfoResult?.skipped
                        ? publishImageBindResult?.success
                            ? `${PLATFORM_NAME}基础链路已打通，当前已进入商品编辑页并完成图片上传、回填与基础信息填写`
                            : `${PLATFORM_NAME}基础链路已打通，当前已进入商品编辑页并完成图片上传与基础信息填写`
                        : publishImageBindResult?.success
                            ? `${PLATFORM_NAME}基础链路已打通，当前已进入商品编辑页并完成图片上传与回填`
                            : `${PLATFORM_NAME}基础链路已打通，当前已进入商品编辑页并完成图片上传`
                : categoryResult.reason === 'missing_category_keyword'
                    ? `${PLATFORM_NAME}已完成页面进入与登录检测，当前停留在类目选择页，等待类目数据接入`
                    : `${PLATFORM_NAME}基础链路已打通，当前已到类目选择页`,
            data: {
                frameworkReady: true,
                frameworkStage,
                loginRequired: !loginState.loggedIn,
                autoLoginAttempted: settings.needLogin,
                autoLoginSuccess,
                categorySelectionCompleted,
                editPageReady: frameworkStage === 'edit_page_ready',
                categoryIntent,
                categorySearchResult: categoryResult.searchResult || null,
                clickedCategoryItems: categoryResult.clickedItems || [],
                currentUrl: page.url(),
                pageTitle: snapshot.title,
                detectedButtons: snapshot.buttons,
                detectedInputs: snapshot.inputs,
                editPageStructure: editStructure,
                editPageLoaded: frameworkStage === 'edit_page_ready',
                uploadedPublishImages: publishImageUploadResult?.uploadedImages || [],
                publishImageUploadCompleted:
                    frameworkStage === 'edit_page_ready' && !publishImageUploadResult?.skipped,
                publishImageUploadSkipped: !!publishImageUploadResult?.skipped,
                publishImageUploadRequestedCount: publishImageUploadResult?.requestedImageCount || 0,
                publishImageUploadUploadedCount: publishImageUploadResult?.uploadedCount || 0,
                publishImageUploadFailedImages: publishImageUploadResult?.failedImages || [],
                publishImageBindCompleted:
                    !!publishImageBindResult?.success && !publishImageBindResult?.skipped,
                publishImageBindSkipped: !!publishImageBindResult?.skipped,
                publishImageBindSelectedCount: publishImageBindResult?.selectedCount || 0,
                publishImageBindMatchedCount: publishImageBindResult?.matchedCount || 0,
                publishImageBindUsedFallback: !!publishImageBindResult?.usedFallback,
                publishImageBindCandidate: publishImageBindResult?.candidate || null,
                publishImageBindAttempts: publishImageBindResult?.attemptResults || [],
                publishBasicInfoFilled:
                    !!publishBasicInfoResult?.success && !publishBasicInfoResult?.skipped,
                publishBasicInfoSkipped: !!publishBasicInfoResult?.skipped,
                publishTitleFilled: !!publishBasicInfoResult?.titleFilled,
                publishDescriptionFilled: !!publishBasicInfoResult?.descriptionFilled,
                publishBasicInfoResult,
                pendingCapabilities: [
                    'advanced_field_mapping',
                    'sku_and_attributes',
                    'publish_data_mapping',
                    'final_publish_submission'
                ],
                executionTrace,
                pageKeptOpen: shouldKeepPageOpen
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}发布骨架执行失败:`, error);
        pushTrace(executionTrace, 'fatal_error', 'failed', {
            message: error?.message || String(error)
        });
        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}发布骨架执行失败`,
            data: {
                frameworkReady: false,
                currentUrl: page?.url?.() || '',
                executionTrace,
                pageKeptOpen: shouldKeepPageOpen
            }
        };
    } finally {
        if (page && !shouldKeepPageOpen) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`${PLATFORM_NAME}关闭页面失败: ${closeError?.message || closeError}`);
            }
        } else if (page && shouldKeepPageOpen) {
            logger.info(`${PLATFORM_NAME}调试模式：保留页面，不自动关闭 tab`);
        }
        requestCapture?.dispose?.();
    }
}

export const temuPublisher = { publish: publishToTemu };

export default temuPublisher;
