import swaggerJsdoc from 'swagger-jsdoc';

// Swagger 配置选项
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '衣设 Electron 客户端 API',
      version: '1.2.0',
      description: '衣设 Electron 客户端的内部 API 接口文档',
      contact: {
        name: '衣设开发团队',
        email: 'support@yishe.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:1519',
        description: '本地开发服务器'
      }
    ],
    components: {
      schemas: {
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'OK'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T12:00:00.000Z'
            },
            service: {
              type: 'string',
              example: 'electron-server'
            },
            version: {
              type: 'string',
              example: '1.0.0'
            },
            isAuthorized: {
              type: 'boolean',
              example: true
            }
          }
        },
        PuppeteerTestResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'puppeteer测试成功'
            },
            status: {
              type: 'string',
              example: '浏览器已打开并访问百度'
            },
            browserConnected: {
              type: 'boolean',
              example: true
            },
            pageCount: {
              type: 'number',
              example: 1
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T12:00:00.000Z'
            }
          }
        },
        XiaohongshuTestResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: '小红书测试成功'
            },
            status: {
              type: 'string',
              example: '浏览器已打开并访问小红书发布页面'
            },
            browserConnected: {
              type: 'boolean',
              example: true
            },
            pageCount: {
              type: 'number',
              example: 1
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T12:00:00.000Z'
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: '操作失败'
            },
            error: {
              type: 'string',
              example: '具体错误信息'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T12:00:00.000Z'
            }
          }
        }
      }
    }
  },
  apis: ['./src/main/server.ts'] // 指定包含 API 注释的文件路径
};

export const specs = swaggerJsdoc(options); 