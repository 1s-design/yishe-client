/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-09 00:09:21
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-07-27 14:06:02
 * @FilePath: /yishe-electron/src/main/douyin.ts
 * @Description: 抖音发布功能
 */
import { SocialMediaUploadUrl } from './const'
import { join as pathJoin } from 'path'
import { getOrCreateBrowser } from './server'
import fs from 'fs'

interface PublishInfo {
  platform: string;
  title: string;
  content: string;
  images: string[];
}

export async function publishToDouyin(publishInfo: PublishInfo): Promise<{ success: boolean; message?: string; data?: any }> {
  try {
    console.log('开始执行抖音发布操作，参数:', publishInfo)
    const browser = await getOrCreateBrowser()
    const page = await browser.newPage()
    console.log('新页面创建成功')
    
    await page.goto(SocialMediaUploadUrl.douyin_pic)
    console.log('已打开抖音发布页面')

    // 暂时注释掉发布服务相关功能
    // 检查登录状态
    // console.log('检查抖音登录状态...')
    // const { PublishService } = await import('./publishService')
    // const loginResult = await PublishService.checkDouyinLoginStatus(page)
    const loginResult = { isLoggedIn: false, details: null }; // 临时返回未登录状态
    
    if (!loginResult.isLoggedIn) {
      console.log('抖音未登录，无法发布')
      return { 
        success: false, 
        message: `抖音未登录: ${loginResult.details?.reason || '未知原因'}`, 
        data: { loginStatus: loginResult } 
      }
    }
    
    console.log('抖音已登录，继续发布流程')

    // 等待文件选择器出现
    await page.waitForSelector('input[type="file"]')
    console.log('找到文件选择器')

    // 设置文件上传路径
    const fileInput = await page.$('input[type="file"]')
    if (!fileInput) {
      throw new Error('未找到文件选择器')
    }

    // 下载并上传所有图片
    for (const imageUrl of publishInfo.images) {
      try {
        // 下载图片到临时目录
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(`下载图片失败: ${response.statusText}`)
        }
        
        const buffer = await response.arrayBuffer()
        const tempPath = pathJoin(process.cwd(), 'temp', `${Date.now()}.jpg`)
        await fs.promises.writeFile(tempPath, Buffer.from(buffer))
        
        // 上传图片
        await fileInput.uploadFile(tempPath)
        console.log('已上传图片:', imageUrl)
        
        // 等待图片上传完成
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)))
        
        // 删除临时文件
        await fs.promises.unlink(tempPath).catch(err => {
          console.warn('删除临时文件失败:', err)
        })
      } catch (error) {
        console.error(`处理图片 ${imageUrl} 时出错:`, error)
        throw error
      }
    }

    // 填写标题
    const titleSelector = 'input[placeholder*="标题"]'
    await page.waitForSelector(titleSelector)
    const titleText = String(publishInfo.title || '')
    if (titleText.trim()) {
      await page.type(titleSelector, titleText)
      console.log('已填写标题:', titleText)
    } else {
      console.log('标题为空，跳过填写')
    }

    // 填写正文内容
    const contentSelector = '.editor-kit-container'
    await page.waitForSelector(contentSelector)
    const contentText = String(publishInfo.content || '')
    if (contentText.trim()) {
      await page.type(contentSelector, contentText)
      console.log('已填写正文内容:', contentText)
    } else {
      console.log('正文内容为空，跳过填写')
    }

    // 等待内容填写完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)))

    // 等待页面稳定，确保所有元素都已加载
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)))

    // 点击发布按钮 - 使用指定的 CSS 选择器
    try {
      const buttonSelector = 'button.button-dhlUZE.primary-cECiOJ.fixed-J9O8Yw'
      await page.waitForSelector(buttonSelector, { timeout: 5000 })
      const publishButton = await page.$(buttonSelector)
      
      if (!publishButton) {
        throw new Error('未找到发布按钮：' + buttonSelector)
      }

      await page.evaluate((selector) => {
        const button = document.querySelector(selector) as HTMLElement
        if (button) {
          button.click()
        }
      }, buttonSelector)
      console.log('已点击发布按钮')
    } catch (error) {
      console.error('点击发布按钮失败:', error)
      throw new Error(`发布按钮点击失败: ${error.message}`)
    }

    // 等待发布完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)))
    
    return { success: true, message: '抖音发布成功' }
  } catch (error) {
    console.error('抖音发布过程出错:', error)
    return { success: false, message: error?.message || '未知错误', data: error }
  }
}