/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-09 00:09:21
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-07-18 07:11:53
 * @FilePath: /yishe-electron/src/main/xiaohongshu.ts
 * @Description: 小红书发布功能
 */
import { SocialMediaUploadUrl } from './const'
import { join as pathJoin } from 'path'
import { is } from '@electron-toolkit/utils'
import { getOrCreateBrowser, setupAntiDetection } from './server'
import fs from 'fs'

export async function publishToXiaohongshu(publishInfo): Promise<{ success: boolean; message?: string; data?: any }> {
  try {
    console.log('开始执行小红书发布操作，参数:', publishInfo)
    const browser = await getOrCreateBrowser()
    const page = await browser.newPage()
    console.log('新页面创建成功')
    
    // 应用反检测脚本
    await setupAntiDetection(page)
    console.log('反检测脚本已应用')
    
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)))
    
    await page.goto(SocialMediaUploadUrl.xiaohongshu_pic, { waitUntil: 'networkidle2' })
    console.log('已打开小红书发布页面')
    
    // 新增：点击进入第3个tab
    await page.waitForSelector('.header .creator-tab:nth-of-type(3)')
    await page.evaluate(() => {
      const el = document.querySelector('.header .creator-tab:nth-of-type(3)')
      if (el) (el as HTMLElement).click()
    })
    console.log('已点击第3个tab')

    // 等待tab切换完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)))

    // 等待文件选择器出现
    await page.waitForSelector('input[type="file"]')
    console.log('找到文件选择器')

    if (publishInfo.images && Array.isArray(publishInfo.images)) {
      for (const imageUrl of publishInfo.images) {
        try {
          // 下载图片到临时目录
          const tempDir = pathJoin(process.cwd(), 'temp')
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
          }
          const response = await fetch(imageUrl)
          if (!response.ok) {
            throw new Error(`下载图片失败: ${response.statusText}`)
          }
          const buffer = await response.arrayBuffer()
          
          // 从 URL 中提取文件扩展名，支持多种图片格式
          const urlParts = imageUrl.split('.')
          const extension = urlParts.length > 1 ? urlParts[urlParts.length - 1].split('?')[0] : 'jpg'
          const tempPath = pathJoin(tempDir, `${Date.now()}_xiaohongshu.${extension}`)
          await fs.promises.writeFile(tempPath, Buffer.from(buffer))

          // 关键：每次都重新获取 input[type="file"]
          const fileInput = await page.$('input[type="file"]')
          if (!fileInput) {
            throw new Error('未找到文件选择器')
          }

          await fileInput.uploadFile(tempPath)
          console.log('已上传图片:', imageUrl)
          

          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 999)))
          
          await fs.promises.unlink(tempPath).catch(err => {
            console.warn('删除临时文件失败:', err)
          })
        } catch (error) {
          console.error(`处理图片 ${imageUrl} 时出错:`, error)
          throw error
        }
      }
    }

    // 等待图片上传完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)))

    // 填写标题
    const titleSelector = 'input[placeholder*="标题"]'
    await page.waitForSelector(titleSelector)
    
    // 模拟真实用户输入行为
    await page.type(titleSelector, publishInfo.title || '', { delay: 100 })
    console.log('已填写标题')

    // 填写正文内容
    const contentSelector = '.ql-editor'
    await page.waitForSelector(contentSelector)
    
    // 模拟真实用户输入行为
    await page.type(contentSelector, publishInfo.content || '', { delay: 50 })
    console.log('已填写正文内容')

    // 等待内容填写完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)))

    // 点击发布按钮
    const submitButton = await page.waitForSelector('.submit button')
    if (!submitButton) {
      throw new Error('未找到发布按钮')
    }
    
    // 模拟真实用户点击行为
    await submitButton.hover()
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    await submitButton.click()
    console.log('已点击发布按钮')

    // 等待发布完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5000)))
    
    // 发布成功，返回结果
    return { success: true, message: '发布成功' }
  } catch (error) {
    console.error('小红书发布过程出错:', error)
    return { success: false, message: error?.message || '未知错误', data: error }
  }
} 