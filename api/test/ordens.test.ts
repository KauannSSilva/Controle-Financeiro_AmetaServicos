import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buscarPo, contarPorStatus, editarItem, ErroRegra, excluirDefinitivo, inserirItem, listarItens,
  moverStatus, removerItem, removerPo, restaurarItem,
} from '../src/ordens/ordens.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
beforeEach(() => limparBanco(prisma));
afterAll(() => prisma.$disconnect());

const novo = (numeroPo = '4533000001', extra = {}) =>
  inserirItem(prisma, { numeroPo, item: '10', projeto: 'PPI Claro', valorOriginal: 350, ...extra });

describe('inserir', () => {
  it('cria a P.O, o item e o primeiro registro do histórico', async () => {
    const item = await novo();
    expect(item.status).toBe('AGUARDANDO_LIBERACAO');
    const po = await buscarPo(prisma, '4533000001');
    expect(po?.itens).toHaveLength(1);
    expect(po?.itens[0].historico).toMatchObject([{ statusDe: null, statusPara: 'AGUARDANDO_LIBERACAO', motivo: 'Cadastro' }]);
  });

  it('um segundo item entra na mesma P.O', async () => {
    await novo('4533000001', { item: '10' });
    await novo('4533000001', { item: '20' });
    expect(await prisma.ordemCompra.count()).toBe(1);
    expect((await buscarPo(prisma, '4533000001'))?.itens).toHaveLength(2);
  });

  it('recusa ITEM fora da lista, no código e no banco', async () => {
    await expect(novo('4533000001', { item: '10 30' })).rejects.toBeInstanceOf(ErroRegra);
    const po = await prisma.ordemCompra.create({ data: { numeroPo: '4533000009' } });
    await expect(
      prisma.itemPo.create({ data: { ordemCompraId: po.id, status: 'EMITIR_NOTA', item: '99' } }),
    ).rejects.toThrow(/itens_po_item_check/);
  });

  it('recusa multa fora de nota emitida (regra no banco)', async () => {
    const item = await novo();
    await expect(prisma.itemPo.update({ where: { id: item.id }, data: { possuiMulta: true } })).rejects.toThrow(/possui_multa_check/);
  });
});

describe('mover entre status', () => {
  it('Aguardando Liberação → Emitir Nota → Emitida c/ multa, com histórico', async () => {
    const item = await novo();
    await moverStatus(prisma, item.id, 'EMITIR_NOTA', { motivo: 'Liberada pelo cliente' });
    await editarItem(prisma, item.id, { numeroNfse: '38500', dataEmissao: new Date('2026-10-01'), percentualMulta: 88 });
    const emitida = await moverStatus(prisma, item.id, 'EMITIDA', { possuiMulta: true });
    expect(emitida).toMatchObject({ status: 'EMITIDA', possuiMulta: true });

    const historico = await prisma.historicoStatus.findMany({ where: { itemPoId: item.id }, orderBy: { criadoEm: 'asc' } });
    expect(historico.map((h) => [h.statusDe, h.statusPara])).toEqual([
      [null, 'AGUARDANDO_LIBERACAO'],
      ['AGUARDANDO_LIBERACAO', 'EMITIR_NOTA'],
      ['EMITIR_NOTA', 'EMITIDA'],
    ]);
    expect(historico[1].motivo).toBe('Liberada pelo cliente');

    // Colunas calculadas como na planilha
    const [linha] = await prisma.$queryRaw<{ status_financeiro: string; valor_final: string; valor_multa: string }[]>`
      SELECT status_financeiro, valor_final::text, valor_multa::text FROM vw_itens_po WHERE id = ${item.id}::uuid`;
    expect(linha).toEqual({ status_financeiro: 'FECHADO', valor_final: '308.00', valor_multa: '42.00' });
  });

  it('status financeiro segue a regra da planilha', async () => {
    const item = await novo();
    const sf = async () =>
      (await prisma.$queryRaw<{ s: string }[]>`SELECT status_financeiro AS s FROM vw_itens_po WHERE id = ${item.id}::uuid`)[0].s;
    expect(await sf()).toBe('NOVO');
    await moverStatus(prisma, item.id, 'EMITIR_NOTA');
    expect(await sf()).toBe('ENTREGUE');
    await moverStatus(prisma, item.id, 'EMITIDA');
    expect(await sf()).toBe('FECHADO');
    await moverStatus(prisma, item.id, 'CANCELADO');
    expect(await sf()).toBe('NOVO');
  });

  it('não move para o mesmo status nem item removido', async () => {
    const item = await novo();
    await expect(moverStatus(prisma, item.id, 'AGUARDANDO_LIBERACAO')).rejects.toThrow('já está');
    await removerItem(prisma, item.id);
    await expect(moverStatus(prisma, item.id, 'EMITIR_NOTA')).rejects.toThrow('não encontrado');
  });
});

describe('remover', () => {
  it('soft delete: some da listagem, fica no banco e na auditoria', async () => {
    const item = await novo();
    await removerItem(prisma, item.id);
    expect((await listarItens(prisma)).total).toBe(0);
    expect(await prisma.itemPo.findUnique({ where: { id: item.id } })).not.toBeNull();
    expect((await listarItens(prisma, { incluirRemovidos: true })).total).toBe(1);
    const log = await prisma.logAuditoria.findMany({ where: { entidadeId: item.id }, orderBy: { id: 'asc' } });
    expect(log.map((l) => l.acao)).toEqual(['ITEM_CRIADO', 'ITEM_REMOVIDO']);
  });

  it('restaurar devolve o item às listagens', async () => {
    const item = await novo();
    await removerItem(prisma, item.id);
    await restaurarItem(prisma, item.id);
    expect((await listarItens(prisma)).total).toBe(1);
  });

  it('remover a P.O remove todos os itens', async () => {
    await novo('4533000001', { item: '10' });
    await novo('4533000001', { item: '20' });
    await novo('4533000002');
    await removerPo(prisma, '4533000001');
    const lista = await listarItens(prisma);
    expect(lista.itens.map((i) => i.ordemCompra.numeroPo)).toEqual(['4533000002']);
    expect(await buscarPo(prisma, '4533000001')).toBeNull();
    await expect(novo('4533000001')).rejects.toThrow('removida');
  });

  it('exclusão definitiva apaga item e histórico e deixa cópia na auditoria', async () => {
    const item = await novo();
    await excluirDefinitivo(prisma, item.id);
    expect(await prisma.itemPo.count()).toBe(0);
    expect(await prisma.historicoStatus.count()).toBe(0);
    const log = await prisma.logAuditoria.findFirst({ where: { acao: 'ITEM_EXCLUIDO_DEFINITIVO' } });
    expect(log?.valoresAntes).toMatchObject({ id: item.id, projeto: 'PPI Claro' });
  });
});

describe('editar e consultar', () => {
  it('edita campos e registra antes/depois na auditoria', async () => {
    const item = await novo();
    const editado = await editarItem(prisma, item.id, { projeto: 'QRF Claro', valorOriginal: '97.90' }, { ip: '10.0.0.1' });
    expect(editado.projeto).toBe('QRF Claro');
    expect(editado.valorOriginal?.toString()).toBe('97.9');
    const log = await prisma.logAuditoria.findFirst({ where: { acao: 'ITEM_EDITADO' } });
    expect(log).toMatchObject({ ip: '10.0.0.1', valoresAntes: { projeto: 'PPI Claro' }, valoresDepois: { projeto: 'QRF Claro' } });
  });

  it('consulta por status, período de emissão, número da P.O e NFS-e', async () => {
    const a = await novo('4533000001');
    const b = await novo('4533000002');
    await novo('4533000003');
    await editarItem(prisma, a.id, { numeroNfse: '100', dataEmissao: new Date('2026-08-10') });
    await moverStatus(prisma, a.id, 'EMITIDA');
    await editarItem(prisma, b.id, { numeroNfse: '200', dataEmissao: new Date('2026-09-15') });
    await moverStatus(prisma, b.id, 'EMITIDA', { possuiMulta: true });

    expect((await listarItens(prisma, { status: 'EMITIDA' })).total).toBe(2);
    expect((await listarItens(prisma, { status: 'EMITIDA', possuiMulta: true })).total).toBe(1);
    expect((await listarItens(prisma, { status: 'AGUARDANDO_LIBERACAO' })).total).toBe(1);
    const setembro = await listarItens(prisma, { emitidaDe: new Date('2026-09-01'), emitidaAte: new Date('2026-09-30') });
    expect(setembro.itens.map((i) => i.ordemCompra.numeroPo)).toEqual(['4533000002']);
    expect((await listarItens(prisma, { numeroPo: '4533000001' })).itens[0].id).toBe(a.id);
    expect((await listarItens(prisma, { numeroNfse: '200' })).itens[0].id).toBe(b.id);
    // Emitidas mais recentes primeiro
    expect((await listarItens(prisma, { status: 'EMITIDA' })).itens.map((i) => i.numeroNfse)).toEqual(['200', '100']);
    expect(await contarPorStatus(prisma)).toEqual({ EMITIDA: 2, AGUARDANDO_LIBERACAO: 1 });
  });

  it('busca com texto malicioso no número não executa SQL', async () => {
    await novo();
    await expect(listarItens(prisma, { numeroPo: "1' OR '1'='1" })).rejects.toBeInstanceOf(ErroRegra);
    expect((await listarItens(prisma, { numeroNfse: "1' OR '1'='1" })).total).toBe(0);
  });
});
