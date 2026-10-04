import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextoRotas, SO_ADMIN } from '../comum.js';

export async function rotasAuditoria(app: FastifyInstance, { prisma, cripto }: ContextoRotas) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/', {
    config: { acesso: SO_ADMIN },
    schema: {
      tags: ['Auditoria (só ADMIN)'], summary: 'Log de auditoria, mais recente primeiro',
      querystring: z.object({
        acao: z.string().trim().max(60).optional().describe('Ex.: LOGIN_FALHOU, STATUS_ALTERADO, USUARIO_CRIADO'),
        usuarioId: z.uuid().optional(),
        entidadeId: z.string().trim().max(60).optional(),
        de: z.iso.date().optional(),
        ate: z.iso.date().optional(),
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
  }, async (req) => {
    const q = req.query;
    const where: Prisma.LogAuditoriaWhereInput = {
      acao: q.acao,
      usuarioId: q.usuarioId,
      entidadeId: q.entidadeId,
      criadoEm: q.de || q.ate
        ? { gte: q.de ? new Date(`${q.de}T00:00:00-03:00`) : undefined, lt: q.ate ? new Date(new Date(`${q.ate}T00:00:00-03:00`).getTime() + 86_400_000) : undefined }
        : undefined,
    };
    const [total, registros] = await prisma.$transaction([
      prisma.logAuditoria.count({ where }),
      prisma.logAuditoria.findMany({
        where, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
        skip: (q.pagina - 1) * q.porPagina, take: q.porPagina,
        include: { usuario: { select: { nomeCifrado: true } } },
      }),
    ]);
    return {
      total, pagina: q.pagina, porPagina: q.porPagina,
      registros: registros.map(({ usuario, id, ...l }) => ({
        ...l, id: id.toString(), usuarioNome: usuario ? cripto.decifrar(usuario.nomeCifrado) : null,
      })),
    };
  });
}
