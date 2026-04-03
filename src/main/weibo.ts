import { getOrCreateBrowser } from './server'

export async function publishToWeibo(publishInfo): Promise<{ success: boolean; message?: string; data?: any }> {
  try {
    console.log('开始执行微博发布操作，参数:', publishInfo)
    const browser = await getOrCreateBrowser()
    const page = await browser.newPage()
    console.log('新页面创建成功')

    // 打开微博发布页面（此处为示例URL，后续可替换为实际发布入口）
    await page.goto('https://weibo.com')
    console.log('已打开微博页面')

    // 查找 title="发微博" 的按钮并点击
    // await page.waitForSelector('button[title="发微博"]', { timeout: 10000 })
    // await page.click('button[title="发微博"]')
    // console.log('已点击发微博按钮')

    // 等待文件选择器出现
    await page.waitForSelector('input[type="file"]', { timeout: 10000 })
    console.log('找到文件选择器')
    const fileInput = await page.$('input[type="file"]')
    if (!fileInput) {
      throw new Error('未找到文件选择器')
    }

    // 上传所有图片（如有多张）
    const { join: pathJoin } = await import('path')
    const fs = await import('fs')
    let uploadedImagesCount = 0;
    
    if (publishInfo.images && Array.isArray(publishInfo.images)) {
      console.log(`开始上传 ${publishInfo.images.length} 张图片...`);
      
      for (let i = 0; i < publishInfo.images.length; i++) {
        const imageUrl = publishInfo.images[i];
        try {
          console.log(`正在上传第 ${i + 1}/${publishInfo.images.length} 张图片: ${imageUrl}`);
          
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
          const tempPath = pathJoin(tempDir, `${Date.now()}_weibo_${i}.${extension}`)
          await fs.promises.writeFile(tempPath, Buffer.from(buffer))
          
          // 重新获取文件选择器（避免DOM变化导致的问题）
          const currentFileInput = await page.$('input[type="file"]')
          if (!currentFileInput) {
            throw new Error('未找到文件选择器')
          }
          
          await currentFileInput.uploadFile(tempPath)
          console.log(`已上传图片 ${i + 1}: ${imageUrl}`)
          
          // 等待图片上传完成 - 检测上传进度或预览元素
          await waitForImageUploadComplete(page, i + 1);
          
          uploadedImagesCount++;
          
          // 删除临时文件
          await fs.promises.unlink(tempPath).catch(err => {
            console.warn('删除临时文件失败:', err)
          })
          
          // 图片间短暂间隔
          await new Promise(resolve => setTimeout(resolve, 1000))
          
        } catch (error) {
          console.error(`处理图片 ${imageUrl} 时出错:`, error)
          throw error
        }
      }
      
      console.log(`所有图片上传完成，共 ${uploadedImagesCount} 张`);
    }

    // 填写正文内容到 class 以 Form_input_ 开头的 textarea
    const contentSelector = 'textarea[class^="Form_input_"]'
    await page.waitForSelector(contentSelector, { timeout: 10000 })
    await page.type(contentSelector, publishInfo.content || '')
    console.log('已填写正文内容')

    // 等待内容填写完成
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 确保所有图片都已上传完成后再点击发布
    if (uploadedImagesCount > 0) {
      console.log('等待所有图片上传完全完成...');
      await waitForAllImagesUploaded(page, uploadedImagesCount);
    }

    // 点击 class 以 Tool_check_ 开头的元素下的 button 作为发送
    const sendButtonSelector = '[class^="Tool_check_"] button'
    await page.waitForSelector(sendButtonSelector, { timeout: 10000 })
    
    // 检查发布按钮是否可用
    const isButtonEnabled = await page.evaluate((selector) => {
      const button = document.querySelector(selector) as HTMLButtonElement;
      return button && !button.disabled;
    }, sendButtonSelector);
    
    if (!isButtonEnabled) {
      console.log('发布按钮不可用，等待图片上传完成...');
      // 等待按钮变为可用状态
      await waitForButtonEnabled(page, sendButtonSelector);
    }
    
    await page.click(sendButtonSelector)
    console.log('已点击发送按钮')

    // 等待发布完成
    await new Promise(resolve => setTimeout(resolve, 3000))

    // 发布成功，返回结果
    return { success: true, message: '微博发布成功' }
  } catch (error) {
    console.error('微博发布过程出错:', error)
    return { success: false, message: error?.message || '未知错误', data: error }
  }
}

/**
 * 等待单张图片上传完成
 */
async function waitForImageUploadComplete(page: any, imageIndex: number): Promise<void> {
  const maxWaitTime = 30000; // 最大等待30秒
  const checkInterval = 1000; // 每秒检查一次
  let elapsedTime = 0;
  
  console.log(`等待第 ${imageIndex} 张图片上传完成...`);
  
  while (elapsedTime < maxWaitTime) {
    try {
      // 检查是否有 Image_loading_ 开头的class元素（表示正在上传）
      const hasLoadingElement = await page.evaluate(() => {
        const loadingElements = document.querySelectorAll('[class*="Image_loading_"]');
        return loadingElements.length > 0;
      });
      
      if (!hasLoadingElement) {
        console.log(`第 ${imageIndex} 张图片上传完成（无loading元素）`);
        return;
      }
      
      console.log(`第 ${imageIndex} 张图片仍在上传中...`);
      
    } catch (error) {
      console.warn(`检查图片 ${imageIndex} 上传状态时出错:`, error);
    }
    
    // 使用 Node.js 的 setTimeout 而不是 page.evaluate 中的 setTimeout
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsedTime += checkInterval;
  }
  
  console.warn(`第 ${imageIndex} 张图片上传等待超时`);
}

/**
 * 等待所有图片上传完成
 */
async function waitForAllImagesUploaded(page: any, expectedCount: number): Promise<void> {
  const maxWaitTime = 60000; // 最大等待60秒
  const checkInterval = 2000; // 每2秒检查一次
  let elapsedTime = 0;
  
  console.log(`等待所有 ${expectedCount} 张图片上传完成...`);
  
  while (elapsedTime < maxWaitTime) {
    try {
      // 检查是否还有 Image_loading_ 开头的class元素
      const hasLoadingElement = await page.evaluate(() => {
        const loadingElements = document.querySelectorAll('[class*="Image_loading_"]');
        return loadingElements.length > 0;
      });
      
      if (!hasLoadingElement) {
        console.log(`所有 ${expectedCount} 张图片已上传完成（无loading元素）`);
        return;
      }
      
      console.log(`仍有图片在上传中，继续等待...`);
      
    } catch (error) {
      console.warn('检查图片上传状态时出错:', error);
    }
    
    // 使用 Node.js 的 setTimeout 而不是 page.evaluate 中的 setTimeout
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsedTime += checkInterval;
  }
  
  console.warn(`等待所有图片上传完成超时`);
}

/**
 * 等待发布按钮变为可用状态
 */
async function waitForButtonEnabled(page: any, buttonSelector: string): Promise<void> {
  const maxWaitTime = 30000; // 最大等待30秒
  const checkInterval = 1000; // 每秒检查一次
  let elapsedTime = 0;
  
  console.log('等待发布按钮变为可用状态...');
  
  while (elapsedTime < maxWaitTime) {
    try {
      const buttonStatus = await page.evaluate((selector) => {
        const button = document.querySelector(selector) as HTMLButtonElement;
        if (!button) {
          return { exists: false, enabled: false, reason: '按钮不存在' };
        }
        
        const isDisabled = button.disabled;
        const hasDisabledClass = button.classList.contains('disabled') || 
                                button.classList.contains('loading') ||
                                button.classList.contains('uploading');
        const isVisible = window.getComputedStyle(button).display !== 'none' && 
                         window.getComputedStyle(button).visibility !== 'hidden';
        
        return {
          exists: true,
          enabled: !isDisabled && !hasDisabledClass && isVisible,
          reason: isDisabled ? '按钮被禁用' : 
                 hasDisabledClass ? '按钮有禁用类' : 
                 !isVisible ? '按钮不可见' : '按钮可用'
        };
      }, buttonSelector);
      
      if (buttonStatus.exists && buttonStatus.enabled) {
        console.log('发布按钮已可用');
        return;
      } else {
        console.log(`按钮状态: ${buttonStatus.reason}`);
      }
      
    } catch (error) {
      console.warn('检查按钮状态时出错:', error);
    }
    
    // 使用 Node.js 的 setTimeout 而不是 page.evaluate 中的 setTimeout
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsedTime += checkInterval;
  }
  
  console.warn('等待发布按钮可用超时');
} 