/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-09 00:09:21
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-06-12 01:20:10
 * @FilePath: /yishe-electron/src/main/kuaishou.ts
 * @Description: 快手发布功能
 */
import { SocialMediaUploadUrl } from './const'
import { join as pathJoin } from 'path'
import { is } from '@electron-toolkit/utils'
import { getOrCreateBrowser } from './server'
import fs from 'fs'

export async function publishToKuaishou(publishInfo): Promise<{ success: boolean; message?: string; data?: any }> {
  try {
    console.log('开始执行快手发布操作，参数:', publishInfo)
    const browser = await getOrCreateBrowser()
    const page = await browser.newPage()
    console.log('新页面创建成功')

    await page.goto(SocialMediaUploadUrl.kuaishou_pic)
    console.log('已打开快手发布页面')

    // 等待页面完全加载
    await page.waitForSelector('#rc-tabs-0-panel-2', { timeout: 10000 })
    console.log('页面基本元素已加载')

    // 等待文件选择器出现
    await page.waitForSelector('input[type="file"]')
    console.log('找到文件选择器')

    // 上传所有图片（如有多张）
    if (publishInfo.images && Array.isArray(publishInfo.images) && publishInfo.images.length > 0) {
      // 下载所有图片到本地
      const tempPaths: string[] = []
      for (const imageUrl of publishInfo.images) {
        try {
          const tempDir = pathJoin(process.cwd(), 'temp')
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
          }
          const response = await fetch(imageUrl)
          if (!response.ok) {
            throw new Error(`下载图片失败: ${response.statusText}`)
          }
          const buffer = await response.arrayBuffer()
          let extension = 'jpg'
          try {
            const urlObj = new URL(imageUrl)
            const pathname = urlObj.pathname
            const lastPart = pathname.split('/').pop()
            if (lastPart && lastPart.includes('.')) {
              extension = lastPart.split('.').pop() || 'jpg'
            }
          } catch (e) {
            const urlParts = imageUrl.split('.')
            extension = urlParts.length > 1 ? urlParts[urlParts.length - 1].split('?')[0] : 'jpg'
          }
          const tempPath = pathJoin(tempDir, `${Date.now()}_kuaishou.${extension}`)
          await fs.promises.writeFile(tempPath, Buffer.from(buffer))
          tempPaths.push(tempPath)
        } catch (error) {
          console.error(`处理图片 ${imageUrl} 时出错:`, error)
          throw error
        }
      }
      // 一次性上传所有图片
      const uploadButtons = await page.$$('button[class^="_upload-btn_"]')
      const uploadButton = uploadButtons[1]
      if (!uploadButton) {
        throw new Error('未找到上传按钮')
      }
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser(),
        uploadButton.click()
      ])
      await fileChooser.accept(tempPaths)
      console.log('已上传所有图片:', tempPaths)
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)))
      for (const tempPath of tempPaths) {
        await fs.promises.unlink(tempPath).catch(err => {
          console.warn('删除临时文件失败:', err)
        })
      }
    }

    // 填写正文内容（富文本）
    const contentSelector = '#work-description-edit'
    await page.waitForSelector(contentSelector)
    await page.evaluate((selector, content) => {
      const el = document.querySelector(selector)
      if (el) {
        el.innerHTML = content
      }
    }, contentSelector, publishInfo.content || '')
    console.log('已填写正文内容')

    // 等待内容填写完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)))

    // 点击发布按钮
    const submitButton = await page.waitForSelector('div[class^="_section-form-btns_"] > div:first-child')
    if (!submitButton) {
      throw new Error('未找到发布按钮')
    }
    await submitButton.click()
    console.log('已点击发布按钮')

    // 等待发布完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)))
    
    // 发布成功，返回结果
    return { success: true, message: '快手发布成功' }
  } catch (error) {
    console.error('快手发布过程出错:', error)
    return { success: false, message: error?.message || '未知错误', data: error }
  }
}
