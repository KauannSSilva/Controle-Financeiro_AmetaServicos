/**
 * Operações sobre P.Os e seus itens direto no banco. A API (Fase 2) chama estas funções
 * depois de checar login, MFA e perfil; aqui ficam só as regras de dados.
 */
import { Prisma, PrismaClient, StatusPo } from '@prisma/client';
import { ITENS_PERMITIDOS } from './status.js';

export class ErroRegra extends Error {}

export interface Contexto {
  usuarioId?: string | null;
  ip?: string | null;
}

export interface DadosItem {
  item?: string | null;
  idSite?: string | null;
  site?: string | null;
  fase?: string | null;
  tecnologia?: string | null;
  projeto?: string | null;
  uf?: string | null;
  operadora?: string | null;
  valorOriginal?: string | number | null;
  percentualMulta?: string | number | null;
  numeroNfse?: string | null;
  dataEmissao?: Date | null;
  numeroMigo?: string | null;
  observacoes?: string | null;
}

export interface NovoItem extends DadosItem {
  numeroPo: string;
  status?: StatusPo;
  possuiMulta?: boolean;
}

export interface Filtro {
  status?: StatusPo;
  possuiMulta?: boolean;
  emitidaDe?: Date;
  emitidaAte?: Date;
  numeroPo?: string;
  numeroNfse?: string;
  incluirRemovidos?: boolean;
  pagina?: number;
  porPagina?: number;
}

function validarDados(d: DadosItem) {
  if (d.item != null && !(ITENS_PERMITIDOS as readonly string[]).includes(d.item)) {
    throw new ErroRegra(`ITEM inválido: ${d.item}. Permitidos: ${ITENS_PERMITIDOS.join(', ')}`);
  }
}

function numeroPoValido(numero: string): string {
  const limpo = numero.trim();
  if (!/^\d{1,20}$/.test(limpo)) throw new ErroRegra('Número da P.O deve ter só dígitos');
  return limpo;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function auditar(
  tx: Prisma.TransactionClient, ctx: Contexto, acao: string, entidadeId: string, antes?: unknown, depois?: unknown,
) {
  await tx.logAuditoria.create({
    data: {
      usuarioId: ctx.usuarioId ?? null, ip: ctx.ip ?? null, acao, entidade: 'itens_po', entidadeId,
      valoresAntes: antes === undefined ? Prisma.JsonNull : json(antes),
      valoresDepois: depois === undefined ? Prisma.JsonNull : json(depois),
    },
  });
}

async function itemAtivo(tx: Prisma.TransactionClient, id: string) {
  const item = await tx.itemPo.findUnique({ where: { id }, include: { ordemCompra: true } });
  if (!item || item.excluidoEm || item.ordemCompra.excluidoEm) throw new ErroRegra('Item não encontrado');
  return item;
}

/** Cadastra um item. Cria a P.O se o número ainda não existir. */
export async function inserirItem(prisma: PrismaClient, dados: NovoItem, ctx: Contexto = {}) {
  validarDados(dados);
  const numeroPo = numeroPoValido(dados.numeroPo);
  const status = dados.status ?? 'AGUARDANDO_LIBERACAO';
  const possuiMulta = status === 'EMITIDA' && (dados.possuiMulta ?? false);
  const { numeroPo: _n, status: _s, possuiMulta: _m, ...campos } = dados;

  return prisma.$transaction(async (tx) => {
    const ordem = await tx.ordemCompra.upsert({
      where: { numeroPo },
      create: { numeroPo, criadoPorId: ctx.usuarioId, atualizadoPorId: ctx.usuarioId },
      update: {},
    });
    if (ordem.excluidoEm) throw new ErroRegra('Esta P.O foi removida. Restaure-a antes de adicionar itens.');
    const item = await tx.itemPo.create({
      data: {
        ...campos, ordemCompraId: ordem.id, status, possuiMulta,
        criadoPorId: ctx.usuarioId, atualizadoPorId: ctx.usuarioId,
        historico: { create: { statusDe: null, statusPara: status, possuiMulta, usuarioId: ctx.usuarioId, motivo: 'Cadastro' } },
      },
    });
    await auditar(tx, ctx, 'ITEM_CRIADO', item.id, undefined, item);
    return item;
  });
}

/** Edita campos do item. Status não muda por aqui: use moverStatus. */
export async function editarItem(prisma: PrismaClient, id: string, dados: DadosItem, ctx: Contexto = {}) {
  validarDados(dados);
  return prisma.$transaction(async (tx) => {
    const antes = await itemAtivo(tx, id);
    const depois = await tx.itemPo.update({ where: { id }, data: { ...dados, atualizadoPorId: ctx.usuarioId } });
    const { ordemCompra: _o, ...antesSemOrdem } = antes;
    await auditar(tx, ctx, 'ITEM_EDITADO', id, antesSemOrdem, depois);
    return depois;
  });
}

/** Muda o status e grava em historico_status (de → para, quem, quando, motivo). */
export async function moverStatus(
  prisma: PrismaClient, id: string, para: StatusPo,
  opcoes: { motivo?: string; possuiMulta?: boolean } = {}, ctx: Contexto = {},
) {
  const possuiMulta = para === 'EMITIDA' && (opcoes.possuiMulta ?? false);
  return prisma.$transaction(async (tx) => {
    const antes = await itemAtivo(tx, id);
    if (antes.status === para && antes.possuiMulta === possuiMulta) throw new ErroRegra('O item já está neste status');
    const depois = await tx.itemPo.update({
      where: { id },
      data: { status: para, possuiMulta, atualizadoPorId: ctx.usuarioId },
    });
    await tx.historicoStatus.create({
      data: {
        itemPoId: id, statusDe: antes.status, statusPara: para, possuiMulta,
        usuarioId: ctx.usuarioId, motivo: opcoes.motivo ?? null,
      },
    });
    await auditar(tx, ctx, 'STATUS_ALTERADO', id, { status: antes.status, possuiMulta: antes.possuiMulta }, { status: para, possuiMulta });
    return depois;
  });
}

/** Remoção normal (soft delete): some das listagens, continua no banco e na auditoria. */
export async function removerItem(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    await itemAtivo(tx, id);
    const item = await tx.itemPo.update({ where: { id }, data: { excluidoEm: new Date(), atualizadoPorId: ctx.usuarioId } });
    await auditar(tx, ctx, 'ITEM_REMOVIDO', id, undefined, { excluidoEm: item.excluidoEm });
    return item;
  });
}

/** Desfaz a remoção (só ADMIN, checado na API). */
export async function restaurarItem(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.itemPo.findUnique({ where: { id } });
    if (!item?.excluidoEm) throw new ErroRegra('Item não está removido');
    const restaurado = await tx.itemPo.update({ where: { id }, data: { excluidoEm: null, atualizadoPorId: ctx.usuarioId } });
    await auditar(tx, ctx, 'ITEM_RESTAURADO', id);
    return restaurado;
  });
}

/** Exclusão definitiva (só ADMIN, checado na API). Apaga o item e o histórico; a auditoria guarda uma cópia. */
export async function excluirDefinitivo(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.itemPo.findUnique({ where: { id }, include: { historico: true } });
    if (!item) throw new ErroRegra('Item não encontrado');
    await tx.itemPo.delete({ where: { id } });
    await auditar(tx, ctx, 'ITEM_EXCLUIDO_DEFINITIVO', id, item);
  });
}

/** Remove a P.O inteira (soft delete na P.O e em todos os itens ativos). */
export async function removerPo(prisma: PrismaClient, numeroPo: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const ordem = await tx.ordemCompra.findUnique({ where: { numeroPo: numeroPoValido(numeroPo) }, include: { itens: true } });
    if (!ordem || ordem.excluidoEm) throw new ErroRegra('P.O não encontrada');
    const agora = new Date();
    await tx.ordemCompra.update({ where: { id: ordem.id }, data: { excluidoEm: agora, atualizadoPorId: ctx.usuarioId } });
    const ativos = ordem.itens.filter((i) => !i.excluidoEm);
    await tx.itemPo.updateMany({ where: { id: { in: ativos.map((i) => i.id) } }, data: { excluidoEm: agora, atualizadoPorId: ctx.usuarioId } });
    for (const i of ativos) await auditar(tx, ctx, 'ITEM_REMOVIDO', i.id, undefined, { excluidoEm: agora, numeroPo: ordem.numeroPo });
  });
}

/** Lista itens com filtros por status, período de emissão e número da P.O ou da NFS-e. */
export async function listarItens(prisma: PrismaClient, f: Filtro = {}) {
  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 500);
  const pagina = Math.max(f.pagina ?? 1, 1);
  const where: Prisma.ItemPoWhereInput = {
    status: f.status,
    possuiMulta: f.possuiMulta,
    numeroNfse: f.numeroNfse,
    dataEmissao: f.emitidaDe || f.emitidaAte ? { gte: f.emitidaDe, lte: f.emitidaAte } : undefined,
    ordemCompra: {
      numeroPo: f.numeroPo ? numeroPoValido(f.numeroPo) : undefined,
      ...(f.incluirRemovidos ? {} : { excluidoEm: null }),
    },
    ...(f.incluirRemovidos ? {} : { excluidoEm: null }),
  };
  const [total, itens] = await prisma.$transaction([
    prisma.itemPo.count({ where }),
    prisma.itemPo.findMany({
      where,
      include: { ordemCompra: { select: { numeroPo: true } } },
      orderBy: [{ dataEmissao: { sort: 'desc', nulls: 'last' } }, { criadoEm: 'desc' }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);
  return { total, pagina, porPagina, itens };
}

/** P.O com todos os itens ativos e o histórico de status de cada um. */
export async function buscarPo(prisma: PrismaClient, numeroPo: string) {
  return prisma.ordemCompra.findFirst({
    where: { numeroPo: numeroPoValido(numeroPo), excluidoEm: null },
    include: {
      itens: {
        where: { excluidoEm: null },
        include: { historico: { orderBy: { criadoEm: 'asc' } } },
        orderBy: { item: 'asc' },
      },
    },
  });
}

/** Contagem por status, para os contadores do menu lateral. */
export async function contarPorStatus(prisma: PrismaClient) {
  const grupos = await prisma.itemPo.groupBy({
    by: ['status'],
    where: { excluidoEm: null, ordemCompra: { excluidoEm: null } },
    _count: { _all: true },
  });
  return Object.fromEntries(grupos.map((g) => [g.status, g._count._all])) as Partial<Record<StatusPo, number>>;
}
