import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { TransactionType } from '@prisma/client';

export async function categoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // 1. Get all categories for current family
  fastify.get('/', async (request) => {
    const { familyId } = (request as any).user;

    const categories = await prisma.category.findMany({
      where: { familyId },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      type: c.type,
      monthlyBudget: c.monthlyBudget ? Number(c.monthlyBudget) : null,
      alertThreshold: c.alertThreshold,
      transactionCount: c._count.transactions,
      createdAt: c.createdAt,
    }));
  });

  // 2. Create category
  fastify.post('/', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { name, icon = 'tag', color = '#C1ECFD', type = 'EXPENSE', monthlyBudget, alertThreshold = 80 } = (request.body as any) || {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Nama kategori wajib diisi.' });
    }

    const trimmedName = name.trim();

    // Check duplicate name within the family
    const existing = await prisma.category.findFirst({
      where: {
        familyId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      return reply.status(400).send({ error: `Kategori "${trimmedName}" sudah ada.` });
    }

    const category = await prisma.category.create({
      data: {
        familyId,
        name: trimmedName,
        icon: icon || 'tag',
        color: color || '#C1ECFD',
        type: type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
        monthlyBudget: monthlyBudget !== undefined && monthlyBudget !== null && monthlyBudget !== '' ? Number(monthlyBudget) : null,
        alertThreshold: Number(alertThreshold) || 80,
      },
    });

    return {
      id: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      type: category.type,
      monthlyBudget: category.monthlyBudget ? Number(category.monthlyBudget) : null,
      alertThreshold: category.alertThreshold,
      transactionCount: 0,
    };
  });

  // 3. Update category
  fastify.put('/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;
    const { name, icon, color, type, monthlyBudget, alertThreshold } = (request.body as any) || {};

    const category = await prisma.category.findFirst({
      where: { id, familyId },
    });

    if (!category) {
      return reply.status(404).send({ error: 'Kategori tidak ditemukan.' });
    }

    if (name && name.trim()) {
      const trimmedName = name.trim();
      const duplicate = await prisma.category.findFirst({
        where: {
          familyId,
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: id },
        },
      });

      if (duplicate) {
        return reply.status(400).send({ error: `Kategori "${trimmedName}" sudah ada.` });
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        ...(type !== undefined && { type: type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE }),
        ...(monthlyBudget !== undefined && {
          monthlyBudget: monthlyBudget !== null && monthlyBudget !== '' ? Number(monthlyBudget) : null,
        }),
        ...(alertThreshold !== undefined && { alertThreshold: Number(alertThreshold) || 80 }),
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      icon: updated.icon,
      color: updated.color,
      type: updated.type,
      monthlyBudget: updated.monthlyBudget ? Number(updated.monthlyBudget) : null,
      alertThreshold: updated.alertThreshold,
    };
  });

  // 4. Delete category
  fastify.delete('/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;

    const category = await prisma.category.findFirst({
      where: { id, familyId },
    });

    if (!category) {
      return reply.status(404).send({ error: 'Kategori tidak ditemukan.' });
    }

    // Safely dissociate existing transactions before deleting category
    await prisma.transaction.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });

    await prisma.category.delete({
      where: { id },
    });

    return { success: true, message: `Kategori "${category.name}" berhasil dihapus.` };
  });
}
