import { ItemPo, StatusPo } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  buscarPo, CAMPOS_ORDEM, contarPorStatus, editarItem, excluirDefinitivo, inserirItem, listarItens, moverStatus,
  removerItem, removerPo, restaurarItem, resumoInicio,
} from '../../ordens/ordens.js';
import { ITENS_PERMITIDOS, ROTULO_STATUS, statusFinanceiro } from '../../ordens/status.js';
import { ContextoRotas, contexto, EDITORES, SO_ADMIN, TODOS } from '../comum.js';

const tags = ['P.Os'];
const STATUS = Object.keys(ROTULO_STATUS) as [StatusPo, ...StatusPo[]];

/** Texto opcional: tira espaços e transforma "" em null. */
const texto = (max: number) =>
  z.string().max(max).transform((v) => (v.trim() === '' ? null : v.trim())).nullable().optional();
const dinheiro = z.union([z.number(), z.string().regex(/^\d{1,10}([.,]\d{1,2})?$/, 'Valor inválido (ex.: 1234.56)')])
  .transform((v) => (typeof v === 'string' ? v.replace(',', '.') : v))
  .refine((v) => Number(v) >= 0 && Number(v) <= 9_999_999_999.99, 'Valor fora do limite');
const percentual = z.union([z.number(), z.string().regex(/^\d{1,3}([.,]\d{1,2})?$/)])
  .transform((v) => Number(typeof v === 'string' ? v.replace(',', '.') : v))
  .refine((v) => v >= 0 && v <= 100, 'Percentual de 0 a 100');
const data = z.iso.date('Data no formato AAAA-MM-DD').transform((v) => new Date(`${v}T00:00:00Z`));
const versao = z.iso.datetime({ offset: true }).transform((v) => new Date(v))
  .describe('Valor de atualizadoEm quando a tela abriu o item. Se alguém alterou depois, a operação é recusada (409).');
const id = z.object({ id: z.uuid('ID inválido') });
const numeroPo = z.string().trim().regex(/^\d{1,20}$/, 'Número da P.O só com dígitos');

const camposItem = {
  item: z.enum(ITENS_PERMITIDOS).nullable().optional(),
  idSite: texto(50),
  site: texto(100),
  fase: texto(20),
  tecnologia: z.enum(['NR', '5G']).nullable().optional(),
  projeto: texto(150),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF com 2 letras').nullable().optional(),
  operadora: z.enum(['CLARO', 'VIVO', 'AT&T']).nullable().optional(),
  valorOriginal: dinheiro.nullable().optional(),
  percentualMulta: percentual.nullable().optional().describe('Percentual a receber (88 = recebe 88%)'),
  numeroNfse: texto(30),
  dataEmissao: data.nullable().optional(),
  numeroMigo: texto(30),
  observacoes: texto(2000),
};

/** Item como a tela recebe: com o número da P.O e as colunas que na planilha eram fórmulas. */
function saida(i: ItemPo & { ordemCompra?: { numeroPo: string } }) {
  const original = i.valorOriginal == null ? 0 : Number(i.valorOriginal);
  const pct = i.percentualMulta == null ? 100 : Number(i.percentualMulta);
  const valorFinal = Math.round(original * pct) / 100;
  const { ordemCompra, ...resto } = i;
  return {
    ...resto,
    numeroPo: ordemCompra?.numeroPo,
    rotuloStatus: ROTULO_STATUS[i.status],
    statusFinanceiro: statusFinanceiro(i.status),
    valorFinal: valorFinal.toFixed(2),
    valorMulta: (original - valorFinal).toFixed(2),
  };
}

export async function rotasOrdens(app: FastifyInstance, { prisma, cripto }: ContextoRotas) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/inicio', {
    config: { acesso: TODOS },
    schema: { tags, summary: 'Tela inicial: 10 últimas emitidas e total + 10 últimas em Emitir Nota' },
  }, async () => {
    const res = await resumoInicio(prisma);
    return {
      ultimasEmitidas: res.ultimasEmitidas.map(saida),
      emitirNota: { total: res.emitirNota.total, ultimas: res.emitirNota.ultimas.map(saida) },
    };
  });

  r.get('/contadores', {
    config: { acesso: TODOS },
    schema: { tags, summary: 'Quantidade de itens por status (contadores do menu)' },
  }, async () => {
    const [porStatus, comMulta] = await Promise.all([
      contarPorStatus(prisma),
      listarItens(prisma, { status: 'EMITIDA', possuiMulta: true, porPagina: 1 }),
    ]);
    const contagem = Object.fromEntries(STATUS.map((s) => [s, porStatus[s] ?? 0])) as Record<StatusPo, number>;
    return { ...contagem, EMITIDA_COM_MULTA: comMulta.total, EMITIDA_SEM_MULTA: contagem.EMITIDA - comMulta.total };
  });

  r.get('/itens', {
    config: { acesso: TODOS },
    schema: {
      tags, summary: 'Lista itens com busca, filtros, ordenação e paginação',
      querystring: z.object({
        status: z.enum(STATUS).optional(),
        multa: z.enum(['com', 'sem']).optional().describe('Só para Emitidas'),
        busca: z.string().trim().max(100).optional().describe('P.O, NFS-e, ID do site, site ou projeto'),
        numeroPo: numeroPo.optional(),
        numeroNfse: z.string().trim().max(30).optional(),
        operadora: z.enum(['CLARO', 'VIVO', 'AT&T']).optional(),
        uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
        de: data.optional().describe('Emitida a partir de (AAAA-MM-DD)'),
        ate: data.optional().describe('Emitida até (AAAA-MM-DD)'),
        valorMin: z.coerce.number().min(0).optional(),
        valorMax: z.coerce.number().min(0).optional(),
        ordenarPor: z.enum(CAMPOS_ORDEM).optional(),
        ordem: z.enum(['asc', 'desc']).optional(),
        pagina: z.coerce.number().int().min(1).max(100_000).default(1),
        porPagina: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
  }, async (req) => {
    const q = req.query;
    const res = await listarItens(prisma, {
      ...q, emitidaDe: q.de, emitidaAte: q.ate,
      possuiMulta: q.multa ? q.multa === 'com' : undefined,
    });
    return { ...res, itens: res.itens.map(saida) };
  });

  r.get('/itens/removidos', {
    config: { acesso: SO_ADMIN },
    schema: {
      tags, summary: 'Itens removidos (para restaurar ou excluir de vez)',
      querystring: z.object({
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
  }, async (req) => {
    const res = await listarItens(prisma, { ...req.query, somenteRemovidos: true, ordenarPor: 'atualizadoEm' });
    return { ...res, itens: res.itens.map(saida) };
  });

  r.get('/ordens/:numeroPo', {
    config: { acesso: TODOS },
    schema: { tags, summary: 'Detalhe da P.O com os itens e o histórico de status', params: z.object({ numeroPo }) },
  }, async (req, reply) => {
    const po = await buscarPo(prisma, req.params.numeroPo);
    if (!po) return reply.code(404).send({ erro: 'P.O não encontrada' });
    // Nome de quem fez cada mudança (nomes ficam cifrados no banco)
    const ids = [...new Set(po.itens.flatMap((i) => i.historico.map((h) => h.usuarioId)).filter((x): x is string => !!x))];
    const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nomeCifrado: true } });
    const nomes = new Map(usuarios.map((u) => [u.id, cripto.decifrar(u.nomeCifrado)]));
    return {
      id: po.id,
      numeroPo: po.numeroPo,
      criadoEm: po.criadoEm,
      itens: po.itens.map(({ historico, ...i }) => ({
        ...saida({ ...i, ordemCompra: { numeroPo: po.numeroPo } }),
        historico: historico.map((h) => ({
          ...h,
          rotuloDe: h.statusDe ? ROTULO_STATUS[h.statusDe] : null,
          rotuloPara: ROTULO_STATUS[h.statusPara],
          usuarioNome: h.usuarioId ? nomes.get(h.usuarioId) ?? null : null,
        })),
      })),
    };
  });

  r.post('/itens', {
    config: { acesso: EDITORES },
    schema: {
      tags, summary: 'Adicionar item (cria a P.O se o número ainda não existir)',
      body: z.object({
        numeroPo,
        status: z.enum(STATUS).default('AGUARDANDO_LIBERACAO'),
        possuiMulta: z.boolean().optional(),
        ...camposItem,
      }),
    },
  }, async (req, reply) => {
    const item = await inserirItem(prisma, req.body, contexto(req));
    return reply.code(201).send(saida({ ...item, ordemCompra: { numeroPo: req.body.numeroPo } }));
  });

  r.patch('/itens/:id', {
    config: { acesso: EDITORES },
    schema: {
      tags, summary: 'Editar campos do item (o status muda pela rota mover)',
      params: id,
      body: z.object({ ...camposItem, versao: versao.optional() }).strict(),
    },
  }, async (req) => {
    const { versao: v, ...dados } = req.body;
    return saida(await editarItem(prisma, req.params.id, dados, contexto(req), v));
  });

  r.post('/itens/:id/mover', {
    config: { acesso: EDITORES },
    schema: {
      tags, summary: 'Mover para outro status',
      description: 'Para Emitida é obrigatório o número da NFS-e e a data de emissão (informe aqui se o item ainda não tiver). '
        + 'Com multa, informe o percentual a receber.',
      params: id,
      body: z.object({
        para: z.enum(STATUS),
        motivo: texto(500),
        possuiMulta: z.boolean().optional(),
        numeroNfse: texto(30),
        dataEmissao: data.optional(),
        percentualMulta: percentual.optional(),
        versao: versao.optional(),
      }).meta({ example: { para: 'EMITIDA', numeroNfse: '38512', dataEmissao: '2026-10-04', motivo: 'Nota emitida hoje' } }),
    },
  }, async (req) => {
    const { para, ...opcoes } = req.body;
    return saida(await moverStatus(prisma, req.params.id, para, opcoes, contexto(req)));
  });

  r.delete('/itens/:id', {
    config: { acesso: EDITORES },
    schema: {
      tags, summary: 'Remover item (some das listas, continua no banco e na auditoria)',
      params: id, querystring: z.object({ versao: versao.optional() }),
    },
  }, async (req) => {
    await removerItem(prisma, req.params.id, contexto(req), req.query.versao);
    return { ok: true };
  });

  r.delete('/ordens/:numeroPo', {
    config: { acesso: EDITORES },
    schema: { tags, summary: 'Remover a P.O inteira (todos os itens)', params: z.object({ numeroPo }) },
  }, async (req) => {
    await removerPo(prisma, req.params.numeroPo, contexto(req));
    return { ok: true };
  });

  r.post('/itens/:id/restaurar', {
    config: { acesso: SO_ADMIN, confirmar: true },
    schema: { tags, summary: 'Restaurar item removido (só ADMIN)', params: id },
  }, async (req) => saida(await restaurarItem(prisma, req.params.id, contexto(req))));

  r.delete('/itens/:id/definitivo', {
    config: { acesso: SO_ADMIN, confirmar: true },
    schema: { tags, summary: 'Excluir de vez (só ADMIN; a auditoria guarda uma cópia)', params: id },
  }, async (req) => {
    await excluirDefinitivo(prisma, req.params.id, contexto(req));
    return { ok: true };
  });
}
