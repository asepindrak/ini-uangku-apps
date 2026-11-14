import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { LLMProviderService } from '../services/llm-provider.js';

export async function llmRoutes(fastify: FastifyInstance) {
  // Get current LLM Config (Protected)
  fastify.get('/config', { preHandler: [fastify.authenticate] }, async (request) => {
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

  // Update LLM Config (Protected)
  fastify.put('/config', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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

  // Test LLM Connection (Bisa dengan token atau tanpa token)
  fastify.post('/test', async (request) => {
    let familyId: string | undefined = undefined;
    try {
      const decoded: any = await request.jwtVerify();
      familyId = decoded?.familyId;
    } catch {
      // Optional auth: jika belum login, testConnection tetap berjalan dengan apiKey yang diinput
    }

    const { activeProvider, apiKey, baseUrl, modelName } = request.body as any;

    const result = await LLMProviderService.testConnection({
      provider: activeProvider || 'gemini',
      apiKey,
      baseUrl,
      modelName,
      familyId,
    });

    return result;
  });
}
