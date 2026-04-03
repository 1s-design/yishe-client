import { join as pathJoin } from 'path'
import { getOrCreateBrowser } from './server'
import fs from 'fs'

export async function publishToBilibili(publishInfo): Promise<{ success: boolean; message?: string; data?: any }> {
  try {
    console.log('开始执行B站图文发布操作，参数:', publishInfo)
    const browser = await getOrCreateBrowser()
    const page = await browser.newPage()
    console.log('新页面创建成功')

    await page.goto('https://member.bilibili.com/platform/upload/text/edit')
    console.log('已打开B站图文发布页面')

    // 上传图片
    if (publishInfo.images && Array.isArray(publishInfo.images)) {
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
          const urlParts = imageUrl.split('.')
          const extension = urlParts.length > 1 ? urlParts[urlParts.length - 1].split('?')[0] : 'jpg'
          const tempPath = pathJoin(tempDir, `${Date.now()}_bilibili.${extension}`)
          await fs.promises.writeFile(tempPath, Buffer.from(buffer))

          // 关键：每次都重新获取 input[type="file"]
          const fileInput = await page.$('input[type="file"]')
          if (!fileInput) {
            throw new Error('未找到文件选择器')
          }
          await fileInput.uploadFile(tempPath)
          console.log('已上传图片:', imageUrl)
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)))
          await fs.promises.unlink(tempPath).catch(err => {
            console.warn('删除临时文件失败:', err)
          })
        } catch (error) {
          console.error(`处理图片 ${imageUrl} 时出错:`, error)
          throw error
        }
      }
    }

    // 填写标题
    const titleSelector = 'input[placeholder*="标题"]'
    await page.waitForSelector(titleSelector)
    await page.type(titleSelector, publishInfo.title || '')
    console.log('已填写标题')

    // 填写正文内容（富文本）
    const contentSelector = '.ql-editor'
    await page.waitForSelector(contentSelector)
    await page.type(contentSelector, publishInfo.content || '')
    console.log('已填写正文内容')

    // 等待内容填写完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)))

    // 点击发布按钮
    const submitButton = await page.waitForSelector('button[type="button"]:not([disabled])')
    if (!submitButton) {
      throw new Error('未找到发布按钮')
    }
    await submitButton.click()
    console.log('已点击发布按钮')

    // 等待发布完成
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)))

    return { success: true, message: 'B站发布成功' }
  } catch (error) {
    console.error('B站发布过程出错:', error)
    return { success: false, message: error?.message || '未知错误', data: error }
  }
} 