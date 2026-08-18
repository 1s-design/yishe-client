export async function executeImageToolPlan(args: {
  imageUrl: string;
  operations?: Array<{ type: string; params?: Record<string, any> }>;
  processorId?: string;
}) {
  try {
    const imageToolModule = await import('../../image-tool');
    const result = await imageToolModule.processImage({
      imageUrl: args.imageUrl,
      engine: args.processorId || 'imagemagick',
      operations: args.operations || [],
    });

    // 处理成功后，创建数据库记录
    if (result.success && result.localPath) {
      try {
        const http = await import('http');
        
        const fileName = result.outputFile || `processed_${Date.now()}.jpg`;
        const serverUrl =
          process.env.VITE_BASE_URL ||
          (process.env.NODE_ENV === "development"
            ? "http://localhost:1520"
            : "https://api.1s.design");
        
        const postData = JSON.stringify({
          title: `MCP处理 · ${fileName}`,
          sourceOriginalUrl: args.imageUrl,
          resultFiles: [{
            key: `mcp/${fileName}`,
            url: `file://${result.localPath}`,
            name: 'MCP处理结果'
          }]
        });

        const urlObj = new URL(`${serverUrl}/api/image-processing-record/create`);
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const createResponse = await new Promise<{ statusCode?: number }>((resolve) => {
          const req = http.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve({ statusCode: res.statusCode }));
          });
          req.on('error', () => resolve({}));
          req.write(postData);
          req.end();
        });

        if (createResponse.statusCode === 200 || createResponse.statusCode === 201) {
          console.log('[MCP] 数据库记录已创建');
        } else {
          console.log('[MCP] 创建数据库记录返回:', createResponse.statusCode);
        }
      } catch (dbError) {
        console.warn('[MCP] 创建数据库记录失败:', dbError);
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ success: true, result }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: error?.message || String(error) }),
        },
      ],
    };
  }
}
