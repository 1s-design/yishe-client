/**
 * 平台配置 - 统一管理所有平台的配置信息
 */

export const PLATFORM_CONFIGS = {
    weibo: {
        name: '微博',
        uploadUrl: 'https://weibo.com',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: false,
        selectors: {
            // 微博发博文输入框：类名常随前端构建变化，提供多组备选
            contentInput: [
                'textarea[class^="Form_input_"]',
                'textarea[placeholder*="新鲜事"]',
                'textarea[placeholder*="想说"]',
                'textarea[placeholder*="发布"]',
                '[class*="composer"] textarea',
                '[class*="Editor"] textarea',
                '.woo-box-flex textarea',
                'textarea'
            ],
            fileInput: 'input[type="file"]',
            submitButton: '[class*="Tool_check_"] button, [class*="send_"] button, button[role="button"]:has-text("发布"), button:has-text("发送"), .tool-bar button[role="button"]'
        },
        loginSelectors: {
            userElements: ['[class*="Ctrls_avatarItem_"]'],
            loginElements: ['.login-btn', '.login-text', '.login-button']
        },
        preProcess: null,
        postProcess: null
    },
    douyin: {
        name: '抖音',
        uploadUrl: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder*="标题"]',
            contentInput: '.editor-kit-container',
            fileInput: 'input[type="file"]',
            submitButton: 'button.button-dhlUZE.primary-cECiOJ.fixed-J9O8Yw'
        },
        loginSelectors: {
            userElements: [
                '#header-avatar',
                '.user-avatar',
                '.user-info',
                '.header-user',
                '[data-testid="user-avatar"]',
                '.creator-header'
            ],
            loginElements: [
                '.login-btn',
                '.login-button',
                '.login-entry',
                'button[data-testid="login-button"]',
                '.login-text',
                '.login-link',
                '.login-prompt',
                '[class*="login"]',
                '.auth-btn',
                '.sign-in-btn'
            ]
        },
        preProcess: null,
        postProcess: null
    },
    xiaohongshu: {
        name: '小红书',
        // 更精确的图文发布链接（带 from=menu 参数）
        uploadUrl: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image',
        // Playwright: 使用 networkidle（Puppeteer 的 networkidle2 在 Playwright 中不存在）
        waitUntil: 'networkidle',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder*="标题"], input[placeholder*="笔记标题"], .title-input, [data-testid="title-input"], input[type="text"][placeholder*="标题"], input.ant-input',
            contentInput: '.tiptap.ProseMirror, .ql-editor, .content-editor, [data-testid="content-editor"]',
            fileInput: 'input[type="file"]',
            submitButton: '.submit button, .publish-btn, [data-testid="publish-btn"], button[type="button"]:has-text("发布")'
        },
        loginSelectors: {
            userElements: [
                '.user_avatar',
                '[class="user_avatar"]',
                '.reds-avatar-border',
                '.user-avatar',
                '.creator-header',
                '.header-avatar',
                '.user-info',
                '.user-profile',
                '[data-testid="user-avatar"]',
                '.avatar-container',
                '.user-container',
                '.user-menu',
                '.profile-avatar'
            ],
            loginElements: [
                '.login',
                'button[data-testid="login-button"]',
                '.login-btn',
                '.login-text',
                '.login-button',
                '.login-entry',
                '.auth-btn',
                '.sign-in-btn',
                '[class*="login"]',
                '.login-prompt',
                '.login-link',
                '.sign-up-btn',
                '.register-btn'
            ]
        },
        preProcess: async (page) => {
            try {
                // 等待页面稳定
                await page.waitForTimeout(2000);

                // 检查当前URL，如果已经在正确的页面就不需要切换tab
                const currentUrl = page.url();
                console.log('当前URL:', currentUrl);

                // 如果URL中已经包含 target=image，说明已经在图片发布页面
                if (currentUrl.includes('target=image')) {
                    console.log('已在图片发布页面，跳过tab切换');
                    return;
                }

                // 尝试点击进入图片tab
                try {
                    // 等待tab元素出现
                    await page.waitForSelector('.header .creator-tab, .creator-tab', {
                        timeout: 3000
                    });

                    // 查找并点击图片相关的tab
                    const tabs = await page.$$('.header .creator-tab, .creator-tab');
                    console.log(`找到 ${tabs.length} 个tab`);

                    // 尝试点击第3个tab（通常是图片）
                    if (tabs.length >= 3) {
                        const imageTab = tabs[2]; // 第3个tab (索引从0开始)
                        const tabText = await imageTab.evaluate(el => el.textContent || el.innerText);
                        console.log(`准备点击tab: ${tabText}`);

                        // 使用 ElementHandle.click() 方法点击
                        await imageTab.click({
                            delay: 100
                        });
                        console.log('已点击图片tab');

                        // 等待页面变化
                        await page.waitForTimeout(2000);
                    }
                } catch (tabError) {
                    console.log('点击tab失败，可能已在正确页面:', tabError.message);
                }
            } catch (error) {
                console.warn('preProcess 执行失败，继续流程:', error.message);
                // 不要抛出错误，让流程继续
            }
        },
        postProcess: null
    },
    kuaishou: {
        name: '快手',
        uploadUrl: 'https://cp.kuaishou.com/article/publish/video',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: false,
        selectors: {
            contentInput: '#work-description-edit',
            fileInput: 'input[type="file"]',
            submitButton: 'div[class^="_section-form-btns_"] > div:first-child'
        },
        loginSelectors: {
            userElements: ['.user-info', '.user-avatar', '.header-user'],
            loginElements: ['.login-btn', '.login-button', '.login-entry']
        },
        preProcess: null,
        postProcess: null
    },
    doudian: {
        name: '抖店',
        uploadUrl: 'https://fxg.jinritemai.com/ffa/g/create',
        waitUntil: 'domcontentloaded',
        timeout: 45000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: [
                '#pg-title-input',
                'input[placeholder*="商品标题"]',
                'input[placeholder*="标题"]',
                'input[placeholder*="商品名称"]',
                'input[name*="title"]'
            ],
            contentInput: [
                'textarea[placeholder*="商品描述"]',
                'textarea[placeholder*="描述"]',
                'textarea',
                '[contenteditable="true"]'
            ],
            fileInput: 'input[type="file"]',
            priceInput: [
                'input[placeholder*="价格"]',
                'input[placeholder*="售价"]',
                'input[name*="price"]'
            ],
            draftButton: [
                'button:has-text("保存草稿")',
                'button:has-text("暂存")',
                'button:has-text("保存")'
            ],
            submitButton: [
                'button:has-text("发布商品")',
                'button:has-text("提交审核")',
                'button:has-text("发布")'
            ]
        },
        loginSelectors: {
            userElements: ['.header-user-info', '.account-info', '.user-info', '.avatar', '[class*="merchant"]'],
            loginElements: ['.login-btn', '.login-button', '.auth-btn', 'text=登录', 'text=扫码登录']
        },
        preProcess: null,
        postProcess: null
    },
    kuaishou_shop: {
        name: '快手小店',
        uploadUrl: 'https://s.kwaixiaodian.com/zone/goods/nexus/self/release/add',
        waitUntil: 'domcontentloaded',
        timeout: 45000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: [
                'input[placeholder*="商品标题"]',
                'input[placeholder*="标题"]',
                'input[placeholder*="商品名称"]',
                'input[name*="title"]'
            ],
            contentInput: [
                'textarea[placeholder*="商品描述"]',
                'textarea[placeholder*="描述"]',
                'textarea',
                '[contenteditable="true"]'
            ],
            fileInput: 'input[type="file"]',
            submitButton: [
                'button:has-text("发布商品")',
                'button:has-text("提交审核")',
                'button:has-text("发布")'
            ]
        },
        loginSelectors: {
            userElements: ['.user-info', '.account-info', '.avatar', '.header-user', '[class*="merchant"]'],
            loginElements: ['.login-btn', '.login-button', '.auth-btn', 'text=登录', 'text=扫码登录']
        },
        preProcess: null,
        postProcess: null
    },
    xianyu: {
        name: '咸鱼',
        uploadUrl: 'https://www.goofish.com/publish',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: true,
        selectors: {
            titleInput: '[class^="editor"]', // 咸鱼标题和描述通常在一个编辑器里，或者使用前缀匹配
            contentInput: '[class^="editor"]',
            fileInput: 'input[type="file"]',
            uploadTrigger: '[class^="upload-item"]',
            submitButton: 'button[type="primary"], button:has-text("发布")'
        },
        loginSelectors: {
            userElements: ['[class^="user-order-container"] img'],
            loginElements: ['.login-btn', '.login-button', '.login-entry', '.login-text']
        },
        preProcess: null,
        postProcess: null
    },
    shumaiyun: {
        name: '速卖通',
        uploadUrl: 'https://gshop.aliexpress.com/p/add',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[name*="productName"], input[placeholder*="商品标题"]',
            contentInput: 'textarea[name*="productDescription"], textarea[placeholder*="商品描述"]',
            fileInput: 'input[type="file"]',
            submitButton: 'button[type="primary"], button.ant-btn-primary, button:has-text("保存"), button:has-text("发布")'
        },
        loginSelectors: {
            userElements: ['.user-avatar', '.user-info', '.account-info'],
            loginElements: ['.login-btn', '.login-button', '.auth-btn', '.login-text']
        },
        preProcess: null,
        postProcess: null
    },
    amazon: {
        name: '亚马逊',
        uploadUrl: 'https://sellercentral.amazon.com/products/create',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[name*="product-title"], input[aria-label*="title"], input.title-input',
            contentInput: 'textarea[name*="feature"], textarea[aria-label*="description"]',
            fileInput: 'input[type="file"]',
            submitButton: 'button[name*="save"], button[aria-label*="save"], button:has-text("Save"), button:has-text("Publish")'
        },
        loginSelectors: {
            userElements: ['.profile-avatar', '.account-info', '.user-menu'],
            loginElements: ['.login-btn', '.login-button', '.auth-btn', '.sign-in']
        },
        preProcess: null,
        postProcess: null
    },
    shein: {
        name: '希音',
        uploadUrl: 'https://seller.shein.com/seller-center/product/products',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder*="商品名称"], input[placeholder*="标题"], input.product-title',
            contentInput: 'textarea[placeholder*="商品描述"], textarea[placeholder*="说明"], textarea.product-desc',
            fileInput: 'input[type="file"]',
            submitButton: 'button[type="primary"], button.btn-primary, button:has-text("发布"), button:has-text("保存")'
        },
        loginSelectors: {
            userElements: ['.user-avatar', '.user-info', '.header-user', '.profile-avatar'],
            loginElements: ['.login-btn', '.login-button', '.login-entry', '.auth-btn']
        },
        preProcess: null,
        postProcess: null
    },
    youtube: {
        name: 'YouTube',
        uploadUrl: 'https://studio.youtube.com/',
        waitUntil: 'domcontentloaded',
        timeout: 60000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: '#textbox[aria-label="Add a title that describes your video"]',
            contentInput: '#textbox[aria-label="Tell viewers about your video"]',
            fileInput: '#content input[type="file"]',
            submitButton: '#done-button'
        },
        loginSelectors: {
            userElements: ['#avatar-btn', 'button#avatar-btn', 'img#img'],
            loginElements: ['#text-item-0', 'text="Sign in"', 'a[href*="accounts.google.com"]']
        },
        preProcess: null,
        postProcess: null
    },
    bilibili: {
        name: 'B站',
        uploadUrl: 'https://member.bilibili.com/platform/upload/video/frame',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder*="标题"]',
            contentInput: 'div[placeholder*="简介"]',
            fileInput: 'input[type="file"]',
            submitButton: 'div.submit-add'
        },
        loginSelectors: {
            userElements: ['.avatar', '.header-entry-avatar'],
            loginElements: ['.header-entry-login']
        }
    },
    zhihu: {
        name: '知乎',
        uploadUrl: 'https://www.zhihu.com/creator',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'textarea[placeholder*="标题"]',
            contentInput: '.DraftEditor-editorContainer',
            fileInput: 'input[type="file"]',
            submitButton: 'button.PublishPanel-triggerButton'
        },
        loginSelectors: {
            userElements: ['.AppHeader-profileAvatar'],
            loginElements: ['.AppHeader-login']
        }
    },
    tiktok: {
        name: 'TikTok',
        uploadUrl: 'https://www.tiktok.com/upload',
        waitUntil: 'networkidle',
        timeout: 60000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'div[contenteditable="true"]',
            contentInput: 'div[contenteditable="true"]',
            fileInput: 'input[type="file"]',
            submitButton: 'button[data-e2e="post_video_button"]'
        },
        loginSelectors: {
            userElements: ['.avatar', '[data-e2e="profile-icon"]'],
            loginElements: ['[data-e2e="top-login-button"]']
        }
    },
    temu: {
        name: 'Temu',
        uploadUrl: 'https://agentseller.temu.com/goods/create/category',
        waitUntil: 'domcontentloaded',
        timeout: 45000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            categoryKeywordInput: 'input[placeholder="搜索分类：可输入商品名称"]',
            categoryItem: 'li[data-testid="beast-core-cascader-list-item"]',
            nextButton: 'button',
            titleInput: 'textarea[placeholder="请输入"]',
            contentInput: 'textarea',
            fileInput: 'input[type="file"]',
            submitButton: 'button'
        },
        loginSelectors: {
            userElements: [
                '[class*="account-info_accountInfo"]',
                '[class*="account-info_mallInfo"]',
                '[class*="account-info_userInfo"]'
            ],
            loginElements: [
                'input[type="password"]',
                'input[autocomplete="current-password"]',
                'form input[type="tel"]',
                'form input[name="password"]'
            ]
        }
    },
    taobao: {
        name: '淘宝',
        uploadUrl: 'https://upload.taobao.com/auction/publish/publish.htm',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: '#title',
            contentInput: '#description',
            fileInput: 'input[type="file"]',
            submitButton: '#J_BtnPublish'
        },
        loginSelectors: {
            userElements: ['.avatar'],
            loginElements: ['.login']
        }
    },
    wechat_channels: {
        name: '视频号',
        uploadUrl: 'https://channels.weixin.qq.com/platform/post/create',
        waitUntil: 'networkidle',
        timeout: 45000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder="标题"]',
            contentInput: 'div[contenteditable]',
            fileInput: 'input[type="file"]',
            submitButton: 'button.weui-desktop-btn_primary'
        },
        loginSelectors: {
            userElements: ['.finder-nickname'],
            loginElements: ['.login-btn']
        }
    },
    baijiahao: {
        name: '百家号',
        uploadUrl: 'https://baijiahao.baidu.com/builder/rc/edit/type/video',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder*="标题"]',
            contentInput: 'textarea',
            fileInput: 'input[type="file"]',
            submitButton: 'button.btn-publish'
        },
        loginSelectors: {
            userElements: ['.user-name'],
            loginElements: ['.login-btn']
        }
    },
    jd: {
        name: '京东',
        uploadUrl: 'https://shop.jd.com/',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[name="title"]',
            contentInput: 'textarea',
            fileInput: 'input[type="file"]',
            submitButton: 'button.submit'
        },
        loginSelectors: {
            userElements: ['.user-info'],
            loginElements: ['.login-btn']
        }
    },
    pinduoduo: {
        name: '拼多多',
        uploadUrl: 'https://mms.pinduoduo.com/goods/goods_list',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.goods-name',
            contentInput: 'textarea',
            fileInput: 'input[type="file"]',
            submitButton: 'button.submit-btn'
        },
        loginSelectors: {
            userElements: ['.avatar'],
            loginElements: ['.login-btn']
        }
    },
    toutiao: {
        name: '今日头条',
        uploadUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input[placeholder*="标题"]',
            contentInput: 'div.editor',
            fileInput: 'input[type="file"]',
            submitButton: 'button.publish-btn'
        },
        loginSelectors: {
            userElements: ['.user-head'],
            loginElements: ['.login-btn']
        }
    },
    dayu: {
        name: '大鱼号',
        uploadUrl: 'https://mp.dayu.com/dashboard/article/write',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title',
            contentInput: 'div.editor',
            fileInput: 'input[type="file"]',
            submitButton: 'button.btn-publish'
        },
        loginSelectors: {
            userElements: ['.avatar-img'],
            loginElements: ['.login-btn']
        }
    },
    penguin: {
        name: '企鹅号',
        uploadUrl: 'https://om.qq.com/article/articlePublish',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input#title',
            contentInput: 'div#content',
            fileInput: 'input[type="file"]',
            submitButton: 'button#submit'
        },
        loginSelectors: {
            userElements: ['.user-pic'],
            loginElements: ['.login-link']
        }
    },
    sohu: {
        name: '搜狐号',
        uploadUrl: 'https://mp.sohu.com/mp/index/index.action',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title-input',
            contentInput: 'div.editor-container',
            fileInput: 'input[type="file"]',
            submitButton: 'div.publish-btn'
        },
        loginSelectors: {
            userElements: ['.user-avatar'],
            loginElements: ['.login-btn']
        }
    },
    netease: {
        name: '网易号',
        uploadUrl: 'https://mp.163.com/admin/article/publish',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title',
            contentInput: 'div.editor',
            fileInput: 'input[type="file"]',
            submitButton: 'div.submit-btn'
        },
        loginSelectors: {
            userElements: ['.avatar'],
            loginElements: ['.login-btn']
        }
    },
    duxiaoshi: {
        name: '度小视',
        uploadUrl: 'https://haokan.baidu.com/author/upload',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title',
            contentInput: 'textarea.desc',
            fileInput: 'input[type="file"]',
            submitButton: 'button.submit'
        },
        loginSelectors: {
            userElements: ['.user-icon'],
            loginElements: ['.login-btn']
        }
    },
    meipai: {
        name: '美拍',
        uploadUrl: 'https://www.meipai.com/upload',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: true,
        selectors: {
            titleInput: 'textarea.description',
            contentInput: 'textarea.description',
            fileInput: 'input[type="file"]',
            submitButton: 'button.upload-btn'
        },
        loginSelectors: {
            userElements: ['.avatar'],
            loginElements: ['.login-btn']
        }
    },
    miaopai: {
        name: '秒拍',
        uploadUrl: 'https://www.miaopai.com/u/upload',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title',
            contentInput: 'textarea.desc',
            fileInput: 'input[type="file"]',
            submitButton: 'button.submit'
        },
        loginSelectors: {
            userElements: ['.header-user'],
            loginElements: ['.login']
        }
    },
    acfun: {
        name: 'A站',
        uploadUrl: 'https://member.acfun.cn/upload-video',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title-input',
            contentInput: 'div.desc-input',
            fileInput: 'input[type="file"]',
            submitButton: 'div.btn-submit'
        },
        loginSelectors: {
            userElements: ['.user-avatar'],
            loginElements: ['.login-btn']
        }
    },
    xigua: {
        name: '西瓜视频',
        uploadUrl: 'https://studio.ixigua.com/upload',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'div[contenteditable]',
            contentInput: 'div.description',
            fileInput: 'input[type="file"]',
            submitButton: 'button.publish-btn'
        },
        loginSelectors: {
            userElements: ['.avatar'],
            loginElements: ['.login-btn']
        }
    },
    haokan: {
        name: '好看视频',
        uploadUrl: 'https://haokan.baidu.com/author/upload',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: true,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title',
            contentInput: 'textarea.desc',
            fileInput: 'input[type="file"]',
            submitButton: 'button.submit'
        },
        loginSelectors: {
            userElements: ['.user-icon'],
            loginElements: ['.login-btn']
        }
    },
    quanmin: {
        name: '全民小视频',
        uploadUrl: 'https://quanmin.baidu.com/author/upload',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        antiDetection: false,
        checkLogin: true,
        selectors: {
            titleInput: 'input.title',
            contentInput: 'textarea.desc',
            fileInput: 'input[type="file"]',
            submitButton: 'button.submit'
        },
        loginSelectors: {
            userElements: ['.user-icon'],
            loginElements: ['.login-btn']
        }
    }
};

// 保持向后兼容
export const SOCIAL_MEDIA_UPLOAD_URLS = {
    xiaohongshu_pic: PLATFORM_CONFIGS.xiaohongshu.uploadUrl,
    douyin_pic: PLATFORM_CONFIGS.douyin.uploadUrl,
    kuaishou_pic: PLATFORM_CONFIGS.kuaishou.uploadUrl,
    weibo: PLATFORM_CONFIGS.weibo.uploadUrl
};
