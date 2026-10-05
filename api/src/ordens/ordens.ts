/**
 * Operações sobre P.Os e seus itens direto no banco. A API (Fase 2) chama estas funções
 * depois de checar login, MFA e perfil; aqui ficam só as regras de dados.
 */
import { Prisma, PrismaClient, StatusPo } from '@prisma/client';
import { ErroConflito, ErroNaoEncontrado, ErroRegra } from '../erros.js';
import { ITENS_PERMITIDOS } from './status.js';

export { ErroConflito, ErroNaoEncontrado, ErroRegra };

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

/** Data de atualização que a tela tinha ao abrir o item. Se mudou, alguém alterou antes e a operação é recusada. */
export type Versao = Date | undefined;

export interface OpcoesMover {
  motivo?: string | null;
  possuiMulta?: boolean;
  /** Dados da nota, pedidos ao mover para Emitida (se o item ainda não tiver) */
  numeroNfse?: string | null;
  dataEmissao?: Date | null;
  percentualMulta?: string | number | null;
  versao?: Versao;
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
  /** Texto livre: P.O, NFS-e, ID do site, site ou projeto */
  busca?: string;
  operadora?: string;
  uf?: string;
  valorMin?: number;
  valorMax?: number;
  ordenarPor?: CampoOrdem;
  ordem?: 'asc' | 'desc';
  incluirRemovidos?: boolean;
  /** Só os removidos (tela de restaurar do ADMIN) */
  somenteRemovidos?: boolean;
  pagina?: number;
  porPagina?: number;
}

export const CAMPOS_ORDEM = ['dataEmissao', 'valorOriginal', 'numeroPo', 'numeroNfse', 'atualizadoEm', 'criadoEm'] as const;
export type CampoOrdem = (typeof CAMPOS_ORDEM)[number];

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

/** Lê o item travando a linha até o fim da transação, para duas pessoas não alterarem ao mesmo tempo. */
async function itemAtivo(tx: Prisma.TransactionClient, id: string, versao?: Versao) {
  await tx.$queryRaw`SELECT 1 FROM itens_po WHERE id = ${id}::uuid FOR UPDATE`;
  const item = await tx.itemPo.findUnique({ where: { id }, include: { ordemCompra: true } });
  if (!item || item.excluidoEm || item.ordemCompra.excluidoEm) throw new ErroNaoEncontrado('Item não encontrado');
  if (versao && item.atualizadoEm.getTime() !== versao.getTime()) {
    throw new ErroConflito('Esta P.O foi alterada por outra pessoa enquanto você editava. Recarregue a página e tente de novo.');
  }
  return item;
}

const vazio = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * Regras da nota emitida: para ficar Emitida precisa do número da NFS-e e da data de emissão
 * (decisão de 04/10/2026), e multa só com percentual entre 0 e 100 (88 = recebe 88%).
 */
function validarEmissao(d: { numeroNfse?: string | null; dataEmissao?: Date | null; percentualMulta?: unknown; possuiMulta: boolean }) {
  if (vazio(d.numeroNfse)) throw new ErroRegra('Informe o número da NFS-e para marcar como Emitida');
  if (!d.dataEmissao) throw new ErroRegra('Informe a data de emissão para marcar como Emitida');
  if (d.dataEmissao.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new ErroRegra('A data de emissão não pode ser no futuro');
  if (d.possuiMulta) {
    const p = d.percentualMulta == null ? NaN : Number(d.percentualMulta);
    if (!(p > 0 && p < 100)) throw new ErroRegra('Com multa, informe o percentual a receber entre 0 e 100 (ex.: 88 = recebe 88%)');
  }
}

/** Cadastra um item. Cria a P.O se o número ainda não existir. */
export async function inserirItem(prisma: PrismaClient, dados: NovoItem, ctx: Contexto = {}) {
  validarDados(dados);
  const numeroPo = numeroPoValido(dados.numeroPo);
  const status = dados.status ?? 'AGUARDANDO_LIBERACAO';
  const possuiMulta = status === 'EMITIDA' && (dados.possuiMulta ?? false);
  const { numeroPo: _n, status: _s, possuiMulta: _m, ...campos } = dados;
  if (status === 'EMITIDA') validarEmissao({ ...campos, possuiMulta });

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
export async function editarItem(prisma: PrismaClient, id: string, dados: DadosItem, ctx: Contexto = {}, versao?: Versao) {
  validarDados(dados);
  return prisma.$transaction(async (tx) => {
    const antes = await itemAtivo(tx, id, versao);
    if (antes.status === 'EMITIDA' && (('numeroNfse' in dados && vazio(dados.numeroNfse)) || ('dataEmissao' in dados && !dados.dataEmissao))) {
      throw new ErroRegra('Nota emitida precisa manter o número da NFS-e e a data de emissão');
    }
    const depois = await tx.itemPo.update({ where: { id }, data: { ...dados, atualizadoPorId: ctx.usuarioId } });
    const { ordemCompra: _o, ...antesSemOrdem } = antes;
    await auditar(tx, ctx, 'ITEM_EDITADO', id, antesSemOrdem, depois);
    return depois;
  });
}

/** Muda o status e grava em historico_status (de → para, quem, quando, motivo). */
export async function moverStatus(
  prisma: PrismaClient, id: string, para: StatusPo, opcoes: OpcoesMover = {}, ctx: Contexto = {},
) {
  const possuiMulta = para === 'EMITIDA' && (opcoes.possuiMulta ?? false);
  return prisma.$transaction(async (tx) => {
    const antes = await itemAtivo(tx, id, opcoes.versao);
    if (antes.status === para && antes.possuiMulta === possuiMulta) throw new ErroRegra('O item já está neste status');
    const nota: Prisma.ItemPoUpdateInput = {};
    if (para === 'EMITIDA') {
      if (!vazio(opcoes.numeroNfse)) nota.numeroNfse = opcoes.numeroNfse!.trim();
      if (opcoes.dataEmissao) nota.dataEmissao = opcoes.dataEmissao;
      if (opcoes.percentualMulta != null) nota.percentualMulta = opcoes.percentualMulta;
      validarEmissao({
        numeroNfse: (nota.numeroNfse as string | undefined) ?? antes.numeroNfse,
        dataEmissao: (nota.dataEmissao as Date | undefined) ?? antes.dataEmissao,
        percentualMulta: nota.percentualMulta ?? antes.percentualMulta,
        possuiMulta,
      });
    } else if (opcoes.numeroNfse != null || opcoes.dataEmissao != null || opcoes.percentualMulta != null) {
      throw new ErroRegra('Número da NFS-e, data e multa só são informados ao mover para Emitida');
    }
    // Saiu de Emitida (sem ser para Cancelado): a nota deixa de valer, então NFS-e e data são apagadas.
    // Os valores antigos ficam no motivo do histórico e na auditoria.
    let motivo = opcoes.motivo ?? null;
    if (antes.status === 'EMITIDA' && para !== 'EMITIDA' && para !== 'CANCELADO' && (antes.numeroNfse || antes.dataEmissao)) {
      nota.numeroNfse = null;
      nota.dataEmissao = null;
      const data = antes.dataEmissao ? ` de ${antes.dataEmissao.toISOString().slice(0, 10).split('-').reverse().join('/')}` : '';
      const aviso = `NFS-e ${antes.numeroNfse ?? '(sem número)'}${data} apagada`;
      motivo = motivo ? `${motivo} (${aviso})` : aviso;
    }
    const depois = await tx.itemPo.update({
      where: { id },
      data: { ...nota, status: para, possuiMulta, atualizadoPorId: ctx.usuarioId },
    });
    await tx.historicoStatus.create({
      data: {
        itemPoId: id, statusDe: antes.status, statusPara: para, possuiMulta,
        usuarioId: ctx.usuarioId, motivo,
      },
    });
    await auditar(
      tx, ctx, 'STATUS_ALTERADO', id,
      { status: antes.status, possuiMulta: antes.possuiMulta, numeroNfse: antes.numeroNfse, dataEmissao: antes.dataEmissao },
      { status: para, possuiMulta, numeroNfse: depois.numeroNfse, dataEmissao: depois.dataEmissao },
    );
    return depois;
  });
}

/** Remoção normal (soft delete): some das listagens, continua no banco e na auditoria. */
export async function removerItem(prisma: PrismaClient, id: string, ctx: Contexto = {}, versao?: Versao) {
  return prisma.$transaction(async (tx) => {
    await itemAtivo(tx, id, versao);
    const item = await tx.itemPo.update({ where: { id }, data: { excluidoEm: new Date(), atualizadoPorId: ctx.usuarioId } });
    await auditar(tx, ctx, 'ITEM_REMOVIDO', id, undefined, { excluidoEm: item.excluidoEm });
    return item;
  });
}

/** Desfaz a remoção (só ADMIN, checado na API). */
export async function restaurarItem(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.itemPo.findUnique({ where: { id } });
    if (!item) throw new ErroNaoEncontrado('Item não encontrado');
    if (!item.excluidoEm) throw new ErroRegra('Item não está removido');
    const ordem = await tx.ordemCompra.findUniqueOrThrow({ where: { id: item.ordemCompraId } });
    // Restaurar um item de P.O removida traz a P.O de volta também
    if (ordem.excluidoEm) await tx.ordemCompra.update({ where: { id: ordem.id }, data: { excluidoEm: null, atualizadoPorId: ctx.usuarioId } });
    const restaurado = await tx.itemPo.update({ where: { id }, data: { excluidoEm: null, atualizadoPorId: ctx.usuarioId } });
    await auditar(tx, ctx, 'ITEM_RESTAURADO', id);
    return restaurado;
  });
}

/** Exclusão definitiva (só ADMIN, checado na API). Apaga o item e o histórico; a auditoria guarda uma cópia. */
export async function excluirDefinitivo(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.itemPo.findUnique({ where: { id }, include: { historico: true } });
    if (!item) throw new ErroNaoEncontrado('Item não encontrado');
    await tx.itemPo.delete({ where: { id } });
    await auditar(tx, ctx, 'ITEM_EXCLUIDO_DEFINITIVO', id, item);
  });
}

/** Remove a P.O inteira (soft delete na P.O e em todos os itens ativos). */
export async function removerPo(prisma: PrismaClient, numeroPo: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const ordem = await tx.ordemCompra.findUnique({ where: { numeroPo: numeroPoValido(numeroPo) }, include: { itens: true } });
    if (!ordem || ordem.excluidoEm) throw new ErroNaoEncontrado('P.O não encontrada');
    const agora = new Date();
    await tx.ordemCompra.update({ where: { id: ordem.id }, data: { excluidoEm: agora, atualizadoPorId: ctx.usuarioId } });
    const ativos = ordem.itens.filter((i) => !i.excluidoEm);
    await tx.itemPo.updateMany({ where: { id: { in: ativos.map((i) => i.id) } }, data: { excluidoEm: agora, atualizadoPorId: ctx.usuarioId } });
    for (const i of ativos) await auditar(tx, ctx, 'ITEM_REMOVIDO', i.id, undefined, { excluidoEm: agora, numeroPo: ordem.numeroPo });
  });
}

/** Lista itens com filtros (status, período, número, texto, operadora, UF, valor), ordenação e paginação. */
export async function listarItens(prisma: PrismaClient, f: Filtro = {}) {
  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 500);
  const pagina = Math.max(f.pagina ?? 1, 1);
  const busca = f.busca?.trim();
  const removido = f.somenteRemovidos ? { not: null } : null;
  const where: Prisma.ItemPoWhereInput = {
    status: f.status,
    possuiMulta: f.possuiMulta,
    numeroNfse: f.numeroNfse,
    operadora: f.operadora,
    uf: f.uf,
    valorOriginal: f.valorMin != null || f.valorMax != null ? { gte: f.valorMin, lte: f.valorMax } : undefined,
    dataEmissao: f.emitidaDe || f.emitidaAte ? { gte: f.emitidaDe, lte: f.emitidaAte } : undefined,
    ordemCompra: {
      numeroPo: f.numeroPo ? numeroPoValido(f.numeroPo) : undefined,
      ...(f.incluirRemovidos || f.somenteRemovidos ? {} : { excluidoEm: null }),
    },
    ...(f.incluirRemovidos ? {} : { excluidoEm: removido }),
    ...(busca
      ? {
          OR: [
            // "4533'312225" acha a P.O sem o apóstrofo da planilha
            { ordemCompra: { numeroPo: { contains: /[a-z]/i.test(busca) ? busca : busca.replace(/\D/g, '') || busca } } },
            { numeroNfse: { contains: busca, mode: 'insensitive' } },
            { idSite: { contains: busca, mode: 'insensitive' } },
            { site: { contains: busca, mode: 'insensitive' } },
            { projeto: { contains: busca, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const direcao = f.ordem ?? 'desc';
  const orderBy: Prisma.ItemPoOrderByWithRelationInput[] =
    f.ordenarPor === 'numeroPo' ? [{ ordemCompra: { numeroPo: direcao } }]
      : f.ordenarPor === 'atualizadoEm' || f.ordenarPor === 'criadoEm' ? [{ [f.ordenarPor]: direcao }]
      : f.ordenarPor ? [{ [f.ordenarPor]: { sort: direcao, nulls: 'last' } } as Prisma.ItemPoOrderByWithRelationInput]
        : [{ dataEmissao: { sort: 'desc', nulls: 'last' } }];
  orderBy.push({ criadoEm: 'desc' }, { id: 'asc' });
  const [total, itens] = await prisma.$transaction([
    prisma.itemPo.count({ where }),
    prisma.itemPo.findMany({
      where,
      include: { ordemCompra: { select: { numeroPo: true } } },
      orderBy,
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

/** Tela inicial: 10 últimas emitidas e total + 10 mais recentes em Emitir Nota. */
export async function resumoInicio(prisma: PrismaClient) {
  const [emitidas, emitir] = await Promise.all([
    listarItens(prisma, { status: 'EMITIDA', porPagina: 10 }),
    listarItens(prisma, { status: 'EMITIR_NOTA', porPagina: 10, ordenarPor: 'atualizadoEm' }),
  ]);
  return {
    ultimasEmitidas: emitidas.itens,
    emitirNota: { total: emitir.total, ultimas: emitir.itens },
  };
}
