import { ElNotification, type NotificationProps } from 'element-plus'

export function useToast() {
  const mapType = (color: string): NotificationProps['type'] => {
    if (color === 'success' || color === 'warning' || color === 'info' || color === 'error') return color
    return 'info'
  }

  const showToast = (options: { color: string; icon?: string; message: string; duration?: number }) => {
    // 默认关闭上一条，保持单例体验
    ElNotification.closeAll()

    ElNotification({
      message: options.message,
      duration: options.duration ?? 3000,
      type: mapType(options.color),
      position: 'top-right',
      showClose: true
    })
  }

  return {
    showToast
  }
}

