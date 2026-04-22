import {
    PLATFORM_NAME,
    TEMU_LOGIN_URL_KEYWORDS,
    TEMU_LOGIN_PASSWORD_SELECTORS,
    TEMU_LOGIN_MODE_LABELS,
    TEMU_LOGIN_SUCCESS_TIMEOUT,
    TEMU_LOGIN_ACCOUNT_SELECTORS,
    TEMU_LOGIN_SUBMIT_SELECTORS,
    TEMU_LOGIN_SUBMIT_LABELS,
    TEMU_LOGIN_CONFIRM_LABELS,
    TEMU_LOGIN_RISK_KEYWORDS,
    TEMU_LOGIN_FAILURE_KEYWORDS,
    TEMU_LOGIN_URL,
    TEMU_SELLER_HOST_KEYWORDS,
    TEMU_GLOBAL_SETTLE_LOGIN_URL,
    TEMU_GLOBAL_AUTH_LABEL_CONTAINER_SELECTOR,
    TEMU_GLOBAL_AUTH_ENTER_SELECTOR
} from './constants.js';
import {
    getBodyPreviewText,
    findFirstVisibleSelector,
    clickVisibleSelector,
    clickClickableByText,
    collectTemuFrameworkSnapshot
} from './page.js';
import {
    logger
} from '../../utils/logger.js';

const TEMU_TEXT_CLICK_SELECTOR = 'button,[role="button"],a,span,div,label,p';

function isTemuGlobalSettlePage(pageUrl) {
    const currentUrl = String(pageUrl || '');
    return currentUrl.includes('/settle/site-main');
}

function isTemuSellerPage(pageUrl) {
    const currentUrl = String(pageUrl || '');
    return TEMU_SELLER_HOST_KEYWORDS.some((keyword) => currentUrl.includes(keyword));
}

function hasTemuLoginUrlKeyword(pageUrl) {
    const currentUrl = String(pageUrl || '').toLowerCase();
    return TEMU_LOGIN_URL_KEYWORDS.some((keyword) =>
        currentUrl.includes(String(keyword || '').toLowerCase())
    );
}

export async function resolveTemuLoginState(page) {
    const currentUrl = String(page?.url?.() || '');
    if (hasTemuLoginUrlKeyword(currentUrl)) {
        return {
            loggedIn: false,
            currentUrl,
            reason: 'login_url_detected'
        };
    }

    if (isTemuSellerPage(currentUrl)) {
        return {
            loggedIn: true,
            currentUrl,
            reason: 'seller_page_detected'
        };
    }

    return {
        loggedIn: false,
        currentUrl,
        reason: 'non_seller_page'
    };
}

export async function ensureTemuLoginPage(page, loginUrl = TEMU_LOGIN_URL) {
    const currentUrl = String(page.url() || '');
    const passwordInput = await findFirstVisibleSelector(page, TEMU_LOGIN_PASSWORD_SELECTORS);
    const accountInput = await findFirstVisibleSelector(page, TEMU_LOGIN_ACCOUNT_SELECTORS);

    if (TEMU_LOGIN_URL_KEYWORDS.some((keyword) => currentUrl.includes(keyword)) && (passwordInput || accountInput)) {
        return {
            success: true,
            currentUrl,
            reusedCurrentPage: true
        };
    }

    logger.info(`${PLATFORM_NAME}准备打开登录页`, {
        currentUrl,
        loginUrl
    });

    await page.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
    });
    await page.waitForTimeout(2500);

    return {
        success: true,
        currentUrl: page.url(),
        reusedCurrentPage: false
    };
}

async function switchTemuLoginMode(page) {
    const existingAccountInput = await findFirstVisibleSelector(page, TEMU_LOGIN_ACCOUNT_SELECTORS);
    const existingPasswordInput = await findFirstVisibleSelector(page, TEMU_LOGIN_PASSWORD_SELECTORS);
    if (existingAccountInput && existingPasswordInput) {
        return {
            switched: false,
            reason: 'account_password_form_already_visible'
        };
    }

    const clicked = await clickClickableByText(page, TEMU_LOGIN_MODE_LABELS, {
        selector: TEMU_TEXT_CLICK_SELECTOR,
        exact: true
    });
    if (!clicked) {
        return {
            switched: false,
            reason: 'login_mode_switch_not_found'
        };
    }

    await page.waitForTimeout(1200);
    return {
        switched: true,
        reason: 'login_mode_clicked',
        clickedText: clicked.text
    };
}

async function confirmTemuLoginSubmit(page, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const loginState = await resolveTemuLoginState(page);
        if (loginState.loggedIn) {
            return {
                success: true,
                clicked: false,
                skipped: true,
                reason: 'login_completed_without_confirm',
                loginState
            };
        }

        const clicked = await clickClickableByText(page, TEMU_LOGIN_CONFIRM_LABELS, {
            selector: TEMU_TEXT_CLICK_SELECTOR,
            exact: true
        });
        if (clicked) {
            await page.waitForTimeout(1200);
            return {
                success: true,
                clicked: true,
                text: clicked.text
            };
        }

        await page.waitForTimeout(500);
    }

    return {
        success: false,
        reason: 'login_confirm_not_found'
    };
}

async function waitForTemuLoginForm(page, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let switchAttempted = false;

    while (Date.now() < deadline) {
        const loginState = await resolveTemuLoginState(page);
        if (loginState.loggedIn) {
            return {
                ready: false,
                alreadyLoggedIn: true,
                loginState
            };
        }

        const accountInput = await findFirstVisibleSelector(page, TEMU_LOGIN_ACCOUNT_SELECTORS);
        const passwordInput = await findFirstVisibleSelector(page, TEMU_LOGIN_PASSWORD_SELECTORS);
        if (accountInput && passwordInput) {
            return {
                ready: true,
                accountSelector: accountInput.selector,
                passwordSelector: passwordInput.selector
            };
        }

        if (!switchAttempted) {
            const switchResult = await switchTemuLoginMode(page);
            switchAttempted = switchResult.switched || switchResult.reason === 'login_mode_switch_not_found';
            if (switchResult.switched) {
                logger.info(`${PLATFORM_NAME}已尝试切换到账号密码登录模式`, switchResult);
            }
        }

        await page.waitForTimeout(800);
    }

    return {
        ready: false,
        alreadyLoggedIn: false
    };
}

async function waitForTemuLoginSuccess(page, timeoutMs = TEMU_LOGIN_SUCCESS_TIMEOUT) {
    const deadline = Date.now() + timeoutMs;
    let lastState = null;

    while (Date.now() < deadline) {
        lastState = await resolveTemuLoginState(page);
        if (lastState.loggedIn) {
            return {
                success: true,
                loginState: lastState
            };
        }

        const bodyPreview = await getBodyPreviewText(page, 800);
        if (TEMU_LOGIN_RISK_KEYWORDS.some((keyword) => bodyPreview.includes(keyword))) {
            return {
                success: false,
                reason: 'manual_verification_required',
                bodyPreview
            };
        }
        if (TEMU_LOGIN_FAILURE_KEYWORDS.some((keyword) => bodyPreview.toLowerCase().includes(keyword.toLowerCase()))) {
            return {
                success: false,
                reason: 'credential_rejected',
                bodyPreview
            };
        }

        await page.waitForTimeout(1000);
    }

    return {
        success: false,
        reason: 'login_timeout',
        loginState: lastState
    };
}

async function clickTemuAuthorizationLabel(page, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const clicked = await page.evaluate((containerSelector) => {
            const isVisible = (element) => {
                if (!(element instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0;
            };

            const container = document.querySelector(containerSelector);
            if (!(container instanceof HTMLElement) || !isVisible(container)) {
                return null;
            }

            const visibleLabels = Array.from(container.querySelectorAll('label'))
                .filter((element) => isVisible(element));
            if (!visibleLabels.length) {
                return null;
            }
            const matched = visibleLabels[0];

            if (!matched) {
                return null;
            }

            matched.click();
            return {
                text: String(matched.innerText || matched.textContent || '').trim()
            };
        }, TEMU_GLOBAL_AUTH_LABEL_CONTAINER_SELECTOR).catch(() => null);

        if (clicked) {
            return {
                success: true,
                clicked: true,
                text: clicked.text
            };
        }

        await page.waitForTimeout(500);
    }

    return {
        success: false,
        reason: 'authorization_label_not_found'
    };
}

async function clickTemuAuthorizationConfirmButton(page, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const clicked = await page.evaluate((selector) => {
            const isVisible = (element) => {
                if (!(element instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0;
            };
            const button = Array.from(document.querySelectorAll(selector))
                .find((element) => isVisible(element));

            if (!button) {
                return null;
            }

            button.click();
            return {
                text: String(button.innerText || button.textContent || '').trim(),
                tagName: button.tagName
            };
        }, TEMU_GLOBAL_AUTH_ENTER_SELECTOR).catch(() => null);

        if (clicked) {
            return {
                success: true,
                ...clicked
            };
        }

        await page.waitForTimeout(500);
    }

    return {
        success: false,
        reason: 'authorization_confirm_not_found'
    };
}

async function createTemuTemporaryAuthorizationPage(page) {
    const context = page?.context?.();
    if (!context?.newPage) {
        return {
            page,
            temporary: false
        };
    }

    try {
        const temporaryPage = await context.newPage({ background: true, activate: false });
        logger.info(`${PLATFORM_NAME}已创建临时授权页`, {
            currentUrl: String(temporaryPage?.url?.() || ''),
            activate: false
        });
        return {
            page: temporaryPage,
            temporary: temporaryPage !== page
        };
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}创建临时授权页失败，回退当前页继续执行授权`, {
            message: error?.message || String(error)
        });
        return {
            page,
            temporary: false
        };
    }
}

export async function ensureTemuGlobalRegionAuthorization(page) {
    const initialUrl = String(page?.url?.() || '');
    const initialState = await resolveTemuLoginState(page);
    if (!initialState.loggedIn) {
        return {
            success: false,
            reason: 'not_logged_in',
            currentUrl: initialUrl,
            loginState: initialState
        };
    }

    const pageResult = await createTemuTemporaryAuthorizationPage(page);
    const authorizationPage = pageResult.page || page;
    const shouldCloseTemporaryPage = !!pageResult.temporary;

    try {
        // 登录成功后的原页会继续跳转，这里把全球区授权隔离到临时 tab，避免授权点击被原页跳转打断。
        if (shouldCloseTemporaryPage && typeof authorizationPage?.bringToFront === 'function') {
            await authorizationPage.bringToFront().catch((error) => {
                logger.warn(`${PLATFORM_NAME}临时授权页置前失败，继续执行授权`, {
                    message: error?.message || String(error)
                });
            });
        }

        logger.info(`${PLATFORM_NAME}准备在授权页执行全球区授权`, {
            currentUrl: String(authorizationPage?.url?.() || ''),
            useTemporaryPage: shouldCloseTemporaryPage
        });

        logger.info(`${PLATFORM_NAME}准备进入全球区并处理授权确认`, {
            currentUrl: initialUrl,
            useTemporaryPage: shouldCloseTemporaryPage
        });

        await authorizationPage.goto(TEMU_GLOBAL_SETTLE_LOGIN_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000
        });
        await authorizationPage.waitForTimeout(2500);

        let currentUrl = String(authorizationPage.url() || '');
        let currentState = await resolveTemuLoginState(authorizationPage);

        if (!currentState.loggedIn) {
            return {
                success: false,
                reason: 'not_logged_in',
                currentUrl,
                loginState: currentState
            };
        }

        if (isTemuSellerPage(currentUrl) && !isTemuGlobalSettlePage(currentUrl)) {
            logger.info(`${PLATFORM_NAME}全球区授权页已自动跳过`, {
                currentUrl,
                reason: 'already_entered_global_region'
            });
            return {
                success: true,
                reason: 'already_entered_global_region',
                currentUrl,
                loginState: currentState
            };
        }

        const labelResult = await clickTemuAuthorizationLabel(authorizationPage, 5_000);
        logger.info(`${PLATFORM_NAME}全球区授权勾选结果`, labelResult);
        if (labelResult.success) {
            await authorizationPage.waitForTimeout(600);
        }

        const confirmResult = await clickTemuAuthorizationConfirmButton(authorizationPage, 5_000);
        logger.info(`${PLATFORM_NAME}全球区授权确认结果`, confirmResult || { success: false });
        if (labelResult.success && !confirmResult?.success) {
            logger.warn(`${PLATFORM_NAME}已勾选授权但未找到进入按钮，继续按当前页面状态判断`, {
                currentUrl: authorizationPage.url()
            });
        }

        await authorizationPage.waitForTimeout(1500);

        const finalState = await waitForTemuLoginSuccess(authorizationPage, 20_000);
        if (!finalState.success) {
            const currentState = await resolveTemuLoginState(authorizationPage);
            if (currentState.loggedIn) {
                return {
                    success: true,
                    reason: 'authorization_optional_step_skipped',
                    currentUrl: authorizationPage.url(),
                    loginState: currentState
                };
            }

            return {
                success: false,
                reason: finalState.reason || 'authorization_navigation_timeout',
                message: `${PLATFORM_NAME}已点击授权确认，但未成功进入全球区`,
                bodyPreview: finalState.bodyPreview,
                loginState: finalState.loginState || await resolveTemuLoginState(authorizationPage)
            };
        }

        return {
            success: true,
            reason: 'global_region_authorized',
            currentUrl: authorizationPage.url(),
            loginState: finalState.loginState
        };
    } finally {
        if (shouldCloseTemporaryPage && authorizationPage && !authorizationPage.isClosed()) {
            await authorizationPage.close().catch((error) => {
                logger.warn(`${PLATFORM_NAME}关闭临时授权页失败`, {
                    message: error?.message || String(error)
                });
            });
        }
    }
}

export async function performTemuLogin(page, settings, pageOperator) {
    if (!settings.account || !settings.password) {
        return {
            success: false,
            reason: 'missing_credentials',
            message: `已开启${PLATFORM_NAME}自动登录，但账号或密码为空`
        };
    }

    logger.info(`${PLATFORM_NAME}准备执行自动登录`, {
        account: settings.account,
        currentUrl: page.url()
    });

    await ensureTemuLoginPage(page, settings.loginUrl);

    const formState = await waitForTemuLoginForm(page);
    if (formState.alreadyLoggedIn) {
        const authorizationResult = await ensureTemuGlobalRegionAuthorization(page);
        if (!authorizationResult.success) {
            return authorizationResult;
        }

        return {
            success: true,
            reason: 'already_logged_in',
            loginState: authorizationResult.loginState || formState.loginState
        };
    }

    if (!formState.ready) {
        const snapshot = await collectTemuFrameworkSnapshot(page);
        return {
            success: false,
            reason: 'login_form_not_found',
            message: `未找到${PLATFORM_NAME}账号密码登录表单`,
            snapshot
        };
    }

    await pageOperator.fillInput(page, formState.accountSelector || TEMU_LOGIN_ACCOUNT_SELECTORS, settings.account, {
        delay: 60
    });
    await page.waitForTimeout(400);
    await pageOperator.fillInput(page, formState.passwordSelector || TEMU_LOGIN_PASSWORD_SELECTORS, settings.password, {
        delay: 60
    });
    await page.waitForTimeout(600);

    const submitByText = await clickClickableByText(page, TEMU_LOGIN_SUBMIT_LABELS, {
        selector: TEMU_TEXT_CLICK_SELECTOR,
        exact: true
    });
    if (!submitByText) {
        const submitBySelector = await clickVisibleSelector(page, TEMU_LOGIN_SUBMIT_SELECTORS);
        if (!submitBySelector) {
            return {
                success: false,
                reason: 'login_submit_not_found',
                message: `未找到${PLATFORM_NAME}登录提交按钮`
            };
        }
    }
    logger.info(`${PLATFORM_NAME}已点击登录按钮`, submitByText || { selectorMatched: true });

    await page.waitForTimeout(600);

    const confirmResult = await confirmTemuLoginSubmit(page);
    if (!confirmResult?.success) {
        return {
            success: false,
            reason: confirmResult?.reason || 'login_confirm_not_found',
            message: `未找到${PLATFORM_NAME}“同意并登录”按钮`
        };
    }
    logger.info(`${PLATFORM_NAME}已处理“同意并登录”步骤`, confirmResult);

    const successState = await waitForTemuLoginSuccess(page);
    if (!successState.success) {
        return {
            success: false,
            reason: successState.reason,
            message: successState.reason === 'manual_verification_required'
                ? `${PLATFORM_NAME}登录触发安全验证，请先在浏览器里手动完成验证后再重试`
                : successState.reason === 'credential_rejected'
                    ? `${PLATFORM_NAME}登录失败，账号或密码可能不正确`
                    : `${PLATFORM_NAME}登录超时，未确认登录成功`,
            bodyPreview: successState.bodyPreview,
            loginState: successState.loginState
        };
    }

    logger.info(`${PLATFORM_NAME}自动登录成功`, successState.loginState);
    const authorizationResult = await ensureTemuGlobalRegionAuthorization(page);
    if (!authorizationResult.success) {
        return authorizationResult;
    }

    return {
        success: true,
        reason: 'login_success',
        loginState: authorizationResult.loginState || successState.loginState
    };
}
