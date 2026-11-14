import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function llmRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Get current LLM Config
  fastify.get('/config', async (request) => {
    const { familyId } = (request as any).user;
    const config = await prisma.llmConfig.findUnique({
      where: { familyId },
    });

    return {
      activeProvider: config?.activeProvider || 'gemini',
      apiKey: config?.apiKey ? '••••••••' + config.apiKey.slice(-4) : '',
      hasApiKey: Boolean(config?.apiKey || process.env.GEMINI_API_KEY),
      baseUrl: config?.baseUrl || '',
      modelName: config?.modelName || 'gemini-2.0-flash',
      temperature: config?.temperature ?? 0.2,
    };
  });

  // Update LLM Config
  fastify.put('/config', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { activeProvider, apiKey, baseUrl, modelName, temperature } = request.body as any;

    const data: any = {
      ...(activeProvider && { activeProvider }),
      ...(baseUrl !== undefined && { baseUrl: baseUrl || null }),
      ...(modelName && { modelName }),
      ...(temperature !== undefined && { temperature: Number(temperature) }),
    };

    if (apiKey && !apiKey.startsWith('••••••••')) {
      data.apiKey = apiKey;
    }

    const updated = await prisma.llmConfig.upsert({
      where: { familyId },
      create: {
        familyId,
        activeProvider: activeProvider || 'gemini',
        apiKey: apiKey || null,
        baseUrl: baseUrl || null,
        modelName: modelName || 'gemini-2.0-flash',
        temperature: Number(temperature) || 0.2,
      },
      update: data,
    });

    return {
      success: true,
      activeProvider: updated.activeProvider,
      modelName: updated.modelName,
    };
  });
}
