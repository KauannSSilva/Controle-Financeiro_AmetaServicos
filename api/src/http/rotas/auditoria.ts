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

    // Nome legível de quem sofreu a ação: "P.O 4533312225 · item 10" ou o nome do usuário
    const idsItens = [...new Set(registros.filter((l) => l.entidade === 'itens_po' && l.entidadeId).map((l) => l.entidadeId!))];
    const idsUsuarios = [...new Set(registros.filter((l) => l.entidade === 'usuarios' && l.entidadeId).map((l) => l.entidadeId!))];
    const [itens, usuarios] = await Promise.all([
      prisma.itemPo.findMany({ where: { id: { in: idsItens } }, select: { id: true, item: true, ordemCompra: { select: { numeroPo: true } } } }),
      prisma.usuario.findMany({ where: { id: { in: idsUsuarios } }, select: { id: true, nomeCifrado: true } }),
    ]);
    const rotuloPo = (numeroPo: string, item?: string | null) => `P.O ${numeroPo}${item ? ` · item ${item}` : ''}`;
    const alvoItem = new Map(itens.map((i) => [i.id, rotuloPo(i.ordemCompra.numeroPo, i.item)]));
    // Item excluído de vez: a P.O vem da cópia guardada na auditoria da exclusão
    const excluidos = idsItens.filter((i) => !alvoItem.has(i));
    if (excluidos.length) {
      const copias = await prisma.logAuditoria.findMany({
        where: { acao: 'ITEM_EXCLUIDO_DEFINITIVO', entidadeId: { in: excluidos } }, select: { entidadeId: true, valoresAntes: true },
      });
      const ordens = await prisma.ordemCompra.findMany({
        where: { id: { in: copias.map((c) => String((c.valoresAntes as { ordemCompraId?: string } | null)?.ordemCompraId ?? '')).filter(Boolean) } },
        select: { id: true, numeroPo: true },
      });
      const numeroOrdem = new Map(ordens.map((o) => [o.id, o.numeroPo]));
      for (const c of copias) {
        const a = c.valoresAntes as { ordemCompraId?: string; item?: string | null } | null;
        const numeroPo = a?.ordemCompraId && numeroOrdem.get(a.ordemCompraId);
        if (numeroPo && c.entidadeId) alvoItem.set(c.entidadeId, rotuloPo(numeroPo, a?.item));
      }
    }
    const nomeUsuario = new Map(usuarios.map((u) => [u.id, cripto.decifrar(u.nomeCifrado)]));
    const alvo = (l: (typeof registros)[number]) => {
      if (!l.entidadeId) return null;
      if (l.entidade === 'usuarios') return nomeUsuario.get(l.entidadeId) ?? null;
      if (l.entidade !== 'itens_po') return null;
      // P.O inteira removida: o número vai junto no registro
      const numeroPo = (l.valoresDepois as { numeroPo?: string } | null)?.numeroPo;
      return alvoItem.get(l.entidadeId) ?? (numeroPo ? rotuloPo(numeroPo) : null);
    };

    return {
      total, pagina: q.pagina, porPagina: q.porPagina,
      registros: registros.map((l) => {
        const { usuario, id, ...resto } = l;
        return { ...resto, id: id.toString(), usuarioNome: usuario ? cripto.decifrar(usuario.nomeCifrado) : null, alvo: alvo(l) };
      }),
    };
  });
}
