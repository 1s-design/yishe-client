/**
 * 咸鱼发布功能 - 完整实现
 * 专门处理咸鱼（二手交易平台）的发布逻辑
 * 
 * 支持：
 * - 商品信息（标题、描述）
 * - 多张图片上传（最多9张）
 * - 价格设置
 */

import { getOrCreateBrowser } from '../services/BrowserService.js'
import { PageOperator } from '../services/PageOperator.js'
import { ImageManager } from '../services/ImageManager.js'
import { logger } from '../utils/logger.js'
import fs from 'fs'

class XianyuPublisher {
  constructor() {
    this.platformName = '咸鱼'
    this.uploadUrl = 'https://www.goofish.com/publish'
    this.pageOperator = new PageOperator()
    this.imageManager = new ImageManager()

    // 咸鱼特定的配置
    this.config = {
      maxImages: 9,
      supportedImageFormats: ['jpg', 'jpeg', 'png', 'webp']
    }
  }

  /**
   * 发布到咸鱼
   */
  async publish(publishInfo) {
    let page = null
    try {
      logger.info(`开始执行${this.platformName}发布操作`)

      // 合并平台特定配置 (个性配置)
      const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.xianyu || {}
      const price = settings.price || publishInfo.price

      // 1. 获取浏览器和页面
      const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId })
      page = await browser.newPage({ foreground: true })
      logger.info('新页面创建成功')

      // 2. 导航到发布页面
      logger.info(`正在导航至: ${this.uploadUrl}`)
      await page.goto(this.uploadUrl, {
        waitUntil: 'load',
        timeout: 60000
      })

      // 增加导航后的硬性等待时间，确保动态加载的内容（如用户信息）开始加载
      logger.info('等待页面加载和动态内容初始化...')
      await page.waitForTimeout(5000)
      logger.info(`已打开${this.platformName}发布页面`)

      // 3. 检查登录状态
      const isLoggedIn = await this._checkLogin(page)
      if (!isLoggedIn) {
        throw new Error(`${this.platformName}未登录，请先登录`)
      }
      logger.info('登录状态检查通过')

      // 4. 等待发布表单加载
      await this._waitForFormLoaded(page)
      logger.info('发布表单加载完成')

      // 5. 填充内容（咸鱼标题和描述在一个编辑器里）
      await this._fillProductInfo(page, publishInfo)
      logger.info('商品信息填充完成')

      // 6. 上传图片 (咸鱼主攻图片)
      let images = publishInfo.images || []
      const mainFilePath = publishInfo.filePath || publishInfo.videoUrl

      // 检查主文件是否是视频
      const isMainFileVideo = mainFilePath && /\.(mp4|mov|avi|wmv|flv|mkv)$/i.test(mainFilePath);

      // 如果没有显式图片列表，或者是视频主文件，尝试寻找封面图作为咸鱼的图片
      if (images.length === 0) {
        // 查找任何可能的封面/缩略图
        const cover = publishInfo.platformSettings?.xianyu?.thumbnail ||
          publishInfo.platformSettings?.douyin?.thumbnail ||
          publishInfo.cover ||
          publishInfo.thumbnail;

        if (cover) {
          logger.info('咸鱼发布检测到主文件为视频或未提供图片列表，自动使用封面图/缩略图作为发布图片');
          images = [cover];
        }
      }

      if (images.length > 0) {
        await this._uploadImages(page, images.slice(0, this.config.maxImages))
        logger.info(`已上传 ${Math.min(images.length, this.config.maxImages)} 张图片`)
      } else if (mainFilePath) {
        // 如果最终也没有找到图片，但有主文件路径，按原逻辑上传（支持咸鱼视频发布）
        await this._uploadSingleFilePath(page, mainFilePath)
        logger.info(`已通过路径上传文件: ${mainFilePath}`)
      } else {
        logger.warn('未提供图片或文件路径，跳过上传')
      }

      // 7. 设置价格
      if (!price) {
        logger.error('未找到价格信息，publishInfo:', JSON.stringify(publishInfo))
        throw new Error('咸鱼发布必须提供价格信息(price)，请在个性配置中设置')
      }
      await this._setPrice(page, price)
      logger.info('价格设置完成')

      // 8. 最终检查并发布
      await this._submitPublish(page)
      logger.info(`${this.platformName}发布成功`)

      return {
        success: true,
        message: `${this.platformName}商品发布成功`
      }
    } catch (error) {
      logger.error(`${this.platformName}发布失败:`, error)
      return {
        success: false,
        message: `发布失败: ${error.message}`
      }
    } finally {
      if (page) {
        try {
          await page.close()
        } catch (e) {
          logger.error('关闭页面失败:', e)
        }
      }
    }
  }

  /**
   * 检查登录状态
   */
  async _checkLogin(page) {
    try {
      logger.info('正在检查登录状态...')

      // 等待可能的登录指示器出现
      // 咸鱼有时会先显示空白或加载中，所以我们等待一下
      await page.waitForTimeout(2000)

      // 尝试等待登录状态稳定
      // 检查是否存在登录按钮 (未登录指标)
      const loginSelectors = [
        '.login-btn',
        '.login-button',
        '.auth-btn',
        '.login-text',
        '.login-entry',
        'text=登录/注册',
        'text=请登录'
      ]

      // 检查是否存在用户信息 (已登录指标)
      const loggedInSelectors = [
        '[class^="user-order-container"] img',
        '.user-avatar',
        '.user-info',
        '.header-user',
        '.profile-avatar',
        '.nickname'
      ]

      // 循环检查几次，给页面加载动态脚本和登录信息的时间
      for (let i = 0; i < 5; i++) {
        // 查找登录按钮
        for (const selector of loginSelectors) {
          const count = await page.locator(selector).count()
          if (count > 0) {
            logger.warn(`发现登录标识: ${selector}，判定为未登录`)
            return false
          }
        }

        // 查找已登录标识
        for (const selector of loggedInSelectors) {
          try {
            const count = await page.locator(selector).count()
            if (count > 0) {
              logger.info(`发现用户信息标识: ${selector}，判定为已登录`)
              return true
            }
          } catch (e) {
            if (this.pageOperator.isFatalError(e)) throw e
          }
        }

        logger.info(`等待登录信息加载中... (${i + 1}/5)`)
        await page.waitForTimeout(2000)
      }

      logger.warn('无法明确判断登录状态，默认认为未登录')
      return false
    } catch (error) {
      logger.warn('检查登录状态异常:', error)
      return false
    }
  }

  /**
   * 等待发布表单加载
   */
  async _waitForFormLoaded(page) {
    try {
      // 等待编辑器出现
      await page.waitForSelector(
        '[class^="editor"], .product-title',
        { timeout: 15000 }
      )
      await page.waitForTimeout(1000)
    } catch (error) {
      logger.warn('等待表单加载超时，继续流程:', error.message)
    }
  }

  /**
   * 填充商品信息（标题和描述）
   */
  async _fillProductInfo(page, publishInfo) {
    try {
      // 填充描述（咸鱼主编辑器，用户提供 class="editor--MtHPS94K"）
      if (publishInfo.description || publishInfo.title) {
        const content = publishInfo.description || publishInfo.title
        const editorSelector = '[class^="editor"]'

        try {
          const count = await page.locator(editorSelector).count()
          if (count > 0) {
            // 点击编辑器并输入内容
            await page.click(editorSelector)
            await page.fill(editorSelector, content)
            logger.info('编辑器内容填充成功')
          } else {
            logger.warn('未找到主编辑器输入框 [class^="editor"]')
          }
        } catch (e) {
          logger.error('填充编辑器失败:', e.message)
        }
      }

      await page.waitForTimeout(1000)
    } catch (error) {
      logger.error('填充商品信息失败:', error)
    }
  }

  /**
   * 上传多张图片
   */
  async _uploadImages(page, imageUrls) {
    logger.info(`开始上传 ${imageUrls.length} 张图片...`)

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i]
      let tempPath = null
      try {
        logger.info(`正在处理第 ${i + 1} 张图片: ${url}`)
        const isRemote = typeof url === 'string' && /^https?:\/\//i.test(url)
        const isLocalFile = typeof url === 'string' && !isRemote && fs.existsSync(url)

        if (isLocalFile) {
          await this._uploadSingleFilePath(page, url)
        } else {
          tempPath = await this.imageManager.downloadImage(url, `xianyu_${Date.now()}_${i}`)
          await this._uploadSingleFilePath(page, tempPath)
        }

        // 咸鱼上传完一张后通常需要一点缓冲
        await page.waitForTimeout(2000)
      } catch (error) {
        if (this.pageOperator.isFatalError(error)) throw error
        logger.error(`上传第 ${i + 1} 张图片失败:`, error.message)
      } finally {
        if (tempPath) {
          try { this.imageManager.deleteTempFile(tempPath) } catch (e) { }
        }
      }
    }
  }

  /**
   * 上传单个本地文件
   */
  async _uploadSingleFilePath(page, filePath) {
    try {
      if (!filePath) return

      // 找到触发上传的元素
      const uploadTrigger = '[class^="upload-item"]'
      await page.waitForSelector(uploadTrigger, { timeout: 15000 })

      // 获取当前已上传图片数量，以便后续比对
      const initialImageCount = await page.locator('[class^="image-item"]').count()

      // 优先尝试直接设置 input[type=file]，避免 filechooser 不触发
      const fileInputs = await page.$$('input[type="file"]')
      if (fileInputs.length > 0) {
        let setOk = false
        for (const input of fileInputs) {
          try {
            await input.setInputFiles(filePath)
            setOk = true
            break
          } catch (e) {
            // 继续尝试下一个 input
          }
        }

        if (setOk) {
          logger.info('已通过 input[type=file] 设置文件')
        } else {
          logger.warn('input[type=file] 设置文件失败，回退到 filechooser 方式')
        }

        if (setOk) {
          logger.info('等待图片上传处理完成...')
          try {
            await page.waitForFunction(
              (oldCount) => document.querySelectorAll('[class^="image-item"]').length > oldCount,
              initialImageCount,
              { timeout: 20000 }
            )
            logger.info('图片上传处理成功')
          } catch (error) {
            logger.warn('等待图片预览超时，可能上传较慢或选择器变化，继续流程')
            await page.waitForTimeout(5000)
          }
          return
        }
      }

      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 })
      await page.click(uploadTrigger)
      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(filePath)

      // 等待预览图数量增加，确保上传成功
      logger.info('等待图片上传处理完成...')
      try {
        await page.waitForFunction(
          (oldCount) => document.querySelectorAll('[class^="image-item"]').length > oldCount,
          initialImageCount,
          { timeout: 20000 }
        )
        logger.info('图片上传处理成功')
      } catch (error) {
        logger.warn('等待图片预览超时，可能上传较慢或选择器变化，继续流程')
        await page.waitForTimeout(5000)
      }
    } catch (error) {
      if (this.pageOperator.isFatalError(error)) throw error
      throw error
    }
  }

  /**
   * 设置价格
   */
  async _setPrice(page, price) {
    try {
      const priceSelectors = [
        '.ant-input.css-d5i8y5',
        'input[placeholder*="价格"]'
      ]

      for (const selector of priceSelectors) {
        try {
          const count = await page.locator(selector).count()
          if (count > 0) {
            await page.fill(selector, String(price))
            logger.info(`价格设置为: ¥${price}`)
            return
          }
        } catch (e) {
          // 继续尝试
        }
      }

      logger.warn('未找到价格输入框')
    } catch (error) {
      logger.warn('设置价格失败:', error.message)
    }
  }

  /**
   * 提交发布
   */
  async _submitPublish(page) {
    try {
      // 查找发布按钮
      const publishButtonSelectors = [
        'button:has-text("发布")',
        'button[type="primary"]',
        'button.next-btn-primary',
        'button.btn-primary',
        '.publish-btn',
        'button:has-text("确认发布")'
      ]

      let clicked = false
      for (const selector of publishButtonSelectors) {
        try {
          const buttons = await page.$$(selector)
          if (buttons.length > 0) {
            const lastButton = buttons[buttons.length - 1]
            const text = await lastButton.textContent()

            if (text && (text.includes('发布') || text.includes('确认'))) {
              await lastButton.click()
              clicked = true
              logger.info(`已点击发布按钮: ${text.trim()}`)
              break
            }
          }
        } catch (e) { }
      }

      if (!clicked) {
        logger.warn('未找到明确的发布按钮，尝试 Enter 键')
        await page.keyboard.press('Enter')
      }

      // 等待发布结果 (咸鱼发布成功后通常会跳转或弹出成功框)
      logger.info('等待发布结果反馈...')

      const successResult = await Promise.race([
        // 1. URL 改变 (通常跳转到商品详情或管理页)
        page.waitForURL(url => !url.href.includes('goofish.com/publish'), { timeout: 20000 })
          .then(() => ({ type: 'navigation', success: true })),

        // 2. 出现成功关键词
        page.waitForSelector('text=发布成功, text=成功, .success', { timeout: 20000 })
          .then(() => ({ type: 'selector', success: true })),

        // 3. 超时兜底
        new Promise(resolve => setTimeout(() => resolve({ type: 'timeout', success: false }), 21000))
      ])

      if (successResult.success) {
        logger.info(`检测到发布成功 (${successResult.type})`)
        await page.waitForTimeout(2000) // 额外留一点点时间
      } else {
        // 如果最终没检测到成功，但也没有报错，则抛出一个警告性的错误或者继续
        // 咸鱼的反爬和页面变化频繁，如果 URL 变了其实就是成功了
        const currentUrl = page.url()
        if (!currentUrl.includes('goofish.com/publish')) {
          logger.info('页面已跳转，判定发布成功')
        } else {
          logger.warn('发布后页面未见明显变化，可能发布失败或反馈延迟')
          throw new Error('发布结果确认超时，请检查咸鱼发布记录')
        }
      }
    } catch (error) {
      if (this.pageOperator.isFatalError(error)) throw error
      logger.error('提交发布深度检查失败:', error.message)
      throw error // 重新抛出，让外层捕获并标记失败
    }
  }
}

export const xianyuPublisher = new XianyuPublisher()

/**
 * 发布到咸鱼
 */
export async function publishToXianyu(publishInfo) {
  return await xianyuPublisher.publish(publishInfo)
}

export default xianyuPublisher
