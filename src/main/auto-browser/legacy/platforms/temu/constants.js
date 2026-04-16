export const PLATFORM_KEY = 'temu';
export const PLATFORM_NAME = 'Temu';
export const TEMU_CREATE_URL = 'https://agentseller.temu.com/goods/create/category';
export const TEMU_LOGIN_URL = 'https://seller.kuajingmaihuo.com/login';
export const TEMU_SELLER_HOME_URL = 'https://agentseller.temu.com/';
export const TEMU_USERINFO_API_URL = 'https://agentseller.temu.com/api/seller/auth/userInfo';
export const TEMU_IMAGE_UPLOAD_SIGNATURE_URL = 'https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/signature';
export const TEMU_STORE_IMAGE_URL = 'https://agentseller.temu.com/api/galerie/v3/store_image?sdk_version=js-0.0.40&tag_name=product-material-tag';
export const TEMU_IMAGE_UPLOAD_SIGNATURE_TAG = 'product-material-tag';
export const TEMU_EDIT_URL_KEYWORD = '/goods/edit';
export const TEMU_CATEGORY_URL_KEYWORD = '/goods/create/category';
export const TEMU_LOGIN_URL_KEYWORDS = ['login', 'passport', 'auth'];
export const TEMU_LOGIN_SUCCESS_TIMEOUT = 45_000;
export const TEMU_CATEGORY_SELECT_TIMEOUT = 30_000;
export const TEMU_SELLER_HOST_KEYWORDS = ['seller.kuajingmaihuo.com', 'agentseller.temu.com'];
export const TEMU_DEFAULT_UPLOAD_REFERER = TEMU_SELLER_HOME_URL;

export const TEMU_LOGGED_IN_SELECTORS = [
    '[class*="account-info_accountInfo"]',
    '[class*="account-info_mallInfo"]',
    '[class*="account-info_userInfo"]'
];

export const TEMU_LOGIN_ACCOUNT_SELECTORS = [
    // Prefer exact login-field placeholders first to avoid matching unrelated text inputs.
    'form input[placeholder="请输入手机号"]',
    'input[placeholder="请输入手机号"]',
    'form input[placeholder="请输入手机号码"]',
    'input[placeholder="请输入手机号码"]',
    'form input[placeholder="请输入账号"]',
    'input[placeholder="请输入账号"]',
    'form input[placeholder="请输入用户名"]',
    'input[placeholder="请输入用户名"]',
    'form input[placeholder="请输入邮箱"]',
    'input[placeholder="请输入邮箱"]',
    'form input[placeholder="请输入登录账号"]',
    'input[placeholder="请输入登录账号"]',
    'form input[autocomplete="username"]',
    'input[autocomplete="username"]',
    'form input[name="username"]',
    'form input[name="account"]',
    'form input[name="phone"]',
    'form input[name="mobile"]',
    'form input[name="email"]'
];

export const TEMU_LOGIN_PASSWORD_SELECTORS = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'form input[name="password"]',
    'input[placeholder*="密码"]'
];

export const TEMU_LOGIN_SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'form button:not([disabled])',
    '[role="button"][type="submit"]'
];

export const TEMU_LOGIN_MODE_LABELS = [
    '账号登录',
    '密码登录',
    '手机号登录',
    '手机登录',
    '邮箱登录',
    '使用密码登录'
];

export const TEMU_CATEGORY_KEYWORD_INPUT_SELECTORS = [
    'input[placeholder="搜索分类：可输入商品名称"]',
    'input[placeholder*="搜索分类"]',
    'input[placeholder*="商品名称"]'
];

export const TEMU_CATEGORY_CASCADER_WRAPPER_SELECTOR = '[class*="cascaderInnerWrapper"]';

export const TEMU_CATEGORY_ITEM_SELECTORS = [
    'li[data-testid="beast-core-cascader-list-item"]'
];

export const TEMU_NEXT_STEP_LABELS = ['下一步', 'Next'];
export const TEMU_LOGIN_SUBMIT_LABELS = ['登录', '立即登录', 'Log in', 'Sign in', '提交'];
export const TEMU_LOGIN_CONFIRM_LABELS = ['同意并登录'];
export const TEMU_LOGIN_RISK_KEYWORDS = ['验证码', '安全验证', '二次验证', '风控', '校验', '滑块', '验证'];
export const TEMU_LOGIN_FAILURE_KEYWORDS = ['密码错误', '账号或密码错误', '登录失败', 'incorrect', 'invalid'];
export const TEMU_EDIT_HINT_SELECTORS = [
    'textarea[placeholder="请输入"]',
    'input[placeholder*="商品"]',
    'form textarea',
    'form input[type="text"]'
];
