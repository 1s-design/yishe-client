/**
 * AI 超分 MCP 工具处理函数
 *
 * 调用 image-tool 的 ai_upscale 操作，并把结果登记到服务端 image-processing-record：
 *   1. 结果图上传 COS
 *   2. POST /image-processing-record/create（服务端要求 http/https 图片地址）
 *   3. PATCH /image-processing-record/:id/status 回写完成状态与结果文件
 */
export async function executeImageUpscale(args: {
  imageUrl: string;
  modelId?: string;
}) {
  try {
    const imageToolModule = await import('../../image-tool');
    const result = await imageToolModule.processImage({
      imageUrl: args.imageUrl,
      engine: 'imagemagick',
      operations: [{ type: 'ai_upscale', params: { modelId: args.modelId } }],
    });

    if (!result.success || !result.localPath) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: '超分失败' }) }],
      };
    }

    const record = await registerRecord({
      localPath: result.localPath,
      fileName: result.outputFile || `upscale_${Date.now()}.png`,
      modelId: args.modelId || 'realesr-general-x4v3',
      sourceUrl: args.imageUrl,
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, result, record }),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error?.message || String(error) }) }],
    };
  }
}

/** 上传结果图并登记处理记录，失败不阻塞主流程 */
async function registerRecord(params: {
  localPath: string;
  fileName: string;
  modelId: string;
  sourceUrl: string;
}) {
  try {
    const { uploadFileToCos } = await import('../../cos');
    const { DynamicCapabilityManager } = await import('../dynamic-capability-manager');
    const serverUrl = await DynamicCapabilityManager.resolveServerUrl();

    const upload = await uploadFileToCos(params.localPath);
    if (!upload.ok) {
      const message = 'msg' in upload ? upload.msg : '结果上传失败';
      return { ok: false, message };
    }

    const createResponse = await fetch(`${serverUrl}/api/image-processing-record/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `AI超分 · ${params.fileName}`,
        taskType: 'process',
        imageUrl: upload.url,
        processorId: 'ai-upscale',
        operationsJson: JSON.stringify([{ type: 'ai_upscale', params: { modelId: params.modelId } }]),
        sourceModule: 'ai-upscale',
        sourceName: params.fileName,
      }),
    });
    if (!createResponse.ok) {
      return { ok: false, message: `创建记录失败 HTTP ${createResponse.status}` };
    }
    const created: any = await createResponse.json().catch(() => ({}));
    const recordId = created?.id || created?.data?.id;
    if (!recordId) {
      return { ok: false, message: '创建记录未返回 ID' };
    }

    await fetch(`${serverUrl}/api/image-processing-record/${encodeURIComponent(String(recordId))}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'completed',
        message: 'AI超分完成',
        processorId: 'ai-upscale',
        processorLabel: params.modelId,
        resultFiles: [{ key: upload.key || params.fileName, url: upload.url, name: params.fileName }],
        responseData: {
          modelId: params.modelId,
          sourceUrl: params.sourceUrl,
        },
      }),
    });

    return { ok: true, recordId, url: upload.url };
  } catch (error: any) {
    console.warn('[MCP] AI超分创建记录失败:', error?.message || error);
    return { ok: false, message: String(error?.message || error) };
  }
}
