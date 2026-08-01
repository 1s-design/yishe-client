export async function executeImageToolPlan(args: {
  imageUrl: string;
  operations?: Array<{ type: string; params?: Record<string, any> }>;
  processorId?: string;
}) {
  try {
    const imageToolModule = await import('../../image-tool');
    const result = await imageToolModule.processImage({
      input: args.imageUrl,
      processorId: args.processorId || 'imagemagick',
      plan: {
        operations: args.operations || [],
      },
    });

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
