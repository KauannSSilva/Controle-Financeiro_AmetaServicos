/** O fluxo da tela pela API: achar a P.O em Emitir Nota, mover para Emitida e ver tudo se atualizar. */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/http/app.js';
import { Navegador, novaApp, usuarioLogado } from './api-util.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
let app: App;
let op: Navegador;
beforeEach(async () => {
  await limparBanco(prisma);
  app = await novaApp(prisma);
  op = (await usuarioLogado(app, prisma, 'OPERADOR', 'Olivia Operadora')).nav;
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

async function itemEmEmitirNota(numeroPo = '4533312225') {
  const res = await op.req('POST', 'itens', {
    numeroPo, item: '10 20', projeto: 'PROJETO TX', operadora: 'CLARO', uf: 'sp', valorOriginal: '1.500,00'.replace('.', ''), status: 'EMITIR_NOTA',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('mover para Emitida', () => {
  it('fluxo da P.O emitida hoje: sai de Emitir Nota, vai para Emitidas, status financeiro FECHADO e histórico', async () => {
    const item = await itemEmEmitirNota();
    expect(item).toMatchObject({ numeroPo: '4533312225', status: 'EMITIR_NOTA', statusFinanceiro: 'ENTREGUE', uf: 'SP', valorOriginal: '1500' });

    // Achar a P.O na aba Emitir Nota
    const lista = (await op.req('GET', 'itens?status=EMITIR_NOTA&busca=4533312225')).json();
    expect(lista.total).toBe(1);
    expect((await op.req('GET', 'contadores')).json()).toMatchObject({ EMITIR_NOTA: 1, EMITIDA: 0 });

    // Sem NFS-e e data é recusado
    const semNota = await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIDA' });
    expect(semNota.statusCode).toBe(422);
    expect(semNota.json().erro).toContain('número da NFS-e');
    const semData = await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIDA', numeroNfse: '38512' });
    expect(semData.json().erro).toContain('data de emissão');

    const hoje = new Date().toISOString().slice(0, 10);
    const movido = await op.req('POST', `itens/${item.id}/mover`, {
      para: 'EMITIDA', numeroNfse: '38512', dataEmissao: hoje, motivo: 'Nota emitida hoje', versao: item.atualizadoEm,
    });
    expect(movido.statusCode, movido.body).toBe(200);
    expect(movido.json()).toMatchObject({ status: 'EMITIDA', statusFinanceiro: 'FECHADO', numeroNfse: '38512', possuiMulta: false });

    expect((await op.req('GET', 'contadores')).json()).toMatchObject({ EMITIR_NOTA: 0, EMITIDA: 1, EMITIDA_SEM_MULTA: 1 });
    const inicio = (await op.req('GET', 'inicio')).json();
    expect(inicio.emitirNota.total).toBe(0);
    expect(inicio.ultimasEmitidas.map((i: { numeroNfse: string }) => i.numeroNfse)).toEqual(['38512']);

    const po = (await op.req('GET', 'ordens/4533312225')).json();
    expect(po.itens[0].historico.map((h: { rotuloDe: string; rotuloPara: string; usuarioNome: string; motivo: string }) =>
      [h.rotuloDe, h.rotuloPara, h.usuarioNome, h.motivo])).toEqual([
      [null, 'Emitir Nota', 'Olivia Operadora', 'Cadastro'],
      ['Emitir Nota', 'Emitida', 'Olivia Operadora', 'Nota emitida hoje'],
    ]);
  });

  it('com multa exige o percentual e calcula o valor final como a planilha', async () => {
    const item = await itemEmEmitirNota();
    const hoje = new Date().toISOString().slice(0, 10);
    const sem = await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIDA', numeroNfse: '1', dataEmissao: hoje, possuiMulta: true });
    expect(sem.statusCode).toBe(422);
    const res = await op.req('POST', `itens/${item.id}/mover`, {
      para: 'EMITIDA', numeroNfse: '1', dataEmissao: hoje, possuiMulta: true, percentualMulta: 88,
    });
    expect(res.json()).toMatchObject({ possuiMulta: true, valorFinal: '1320.00', valorMulta: '180.00' });
    expect((await op.req('GET', 'itens?status=EMITIDA&multa=com')).json().total).toBe(1);
    expect((await op.req('GET', 'itens?status=EMITIDA&multa=sem')).json().total).toBe(0);
  });

  it('data de emissão no futuro é recusada', async () => {
    const item = await itemEmEmitirNota();
    const res = await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIDA', numeroNfse: '1', dataEmissao: '2099-01-01' });
    expect(res.statusCode).toBe(422);
  });

  it('se outra pessoa mudou a P.O antes, a mudança é recusada (409)', async () => {
    const item = await itemEmEmitirNota();
    await op.req('PATCH', `itens/${item.id}`, { observacoes: 'alterado por outra pessoa' });
    const res = await op.req('POST', `itens/${item.id}/mover`, { para: 'CANCELADO', versao: item.atualizadoEm });
    expect(res.statusCode).toBe(409);
    expect((await op.req('GET', 'ordens/4533312225')).json().itens[0].status).toBe('EMITIR_NOTA');
  });

  it('errou? move de volta e o histórico guarda as duas mudanças', async () => {
    const item = await itemEmEmitirNota();
    const hoje = new Date().toISOString().slice(0, 10);
    await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIDA', numeroNfse: '9', dataEmissao: hoje });
    const volta = await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIR_NOTA', motivo: 'Movi errado' });
    expect(volta.json().status).toBe('EMITIR_NOTA');
    const historico = (await op.req('GET', 'ordens/4533312225')).json().itens[0].historico;
    expect(historico.map((h: { statusPara: string }) => h.statusPara)).toEqual(['EMITIR_NOTA', 'EMITIDA', 'EMITIR_NOTA']);
  });

  it('nota emitida não pode perder o número da NFS-e na edição', async () => {
    const item = await itemEmEmitirNota();
    await op.req('POST', `itens/${item.id}/mover`, { para: 'EMITIDA', numeroNfse: '9', dataEmissao: '2026-10-01' });
    expect((await op.req('PATCH', `itens/${item.id}`, { numeroNfse: '' })).statusCode).toBe(422);
  });
});

describe('validação de entrada', () => {
  it('campos fora do padrão dão 400 com a mensagem do campo', async () => {
    const res = await op.req('POST', 'itens', { numeroPo: "1' OR 1=1 --", item: '10 30', operadora: 'TIM', uf: 'São Paulo' });
    expect(res.statusCode).toBe(400);
    const campos = res.json().detalhes.map((d: { campo: string }) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(['numeroPo', 'item', 'operadora', 'uf']));
  });

  it('textos de injeção SQL na busca só procuram o texto', async () => {
    await itemEmEmitirNota();
    for (const busca of ["' OR '1'='1", "1; DROP TABLE itens_po; --", "%' UNION SELECT senha_hash FROM usuarios --"]) {
      const res = await op.req('GET', `itens?busca=${encodeURIComponent(busca)}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
    }
    expect(await prisma.itemPo.count()).toBe(1);
  });

  it('campo desconhecido na edição é recusado (não deixa mudar status por ali)', async () => {
    const item = await itemEmEmitirNota();
    expect((await op.req('PATCH', `itens/${item.id}`, { status: 'EMITIDA' })).statusCode).toBe(400);
  });

  it('ID que não existe dá 404 e ID mal formado dá 400', async () => {
    expect((await op.req('PATCH', 'itens/00000000-0000-4000-8000-000000000000', { projeto: 'x' })).statusCode).toBe(404);
    expect((await op.req('PATCH', 'itens/abc', { projeto: 'x' })).statusCode).toBe(400);
    expect((await op.req('GET', 'ordens/4599999999')).statusCode).toBe(404);
  });

  it('busca, filtros por UF/operadora/valor e ordenação', async () => {
    await itemEmEmitirNota('4533000001');
    await op.req('POST', 'itens', { numeroPo: '4533000002', item: '10', operadora: 'VIVO', uf: 'RJ', valorOriginal: 200, site: 'Torre Centro' });
    expect((await op.req('GET', 'itens?operadora=VIVO')).json().total).toBe(1);
    expect((await op.req('GET', 'itens?uf=sp')).json().total).toBe(1);
    expect((await op.req('GET', 'itens?valorMin=1000')).json().total).toBe(1);
    expect((await op.req('GET', 'itens?busca=torre')).json().itens[0].numeroPo).toBe('4533000002');
    const asc = (await op.req('GET', 'itens?ordenarPor=valorOriginal&ordem=asc')).json();
    expect(asc.itens.map((i: { valorOriginal: string }) => i.valorOriginal)).toEqual(['200', '1500']);
    const pag = (await op.req('GET', 'itens?porPagina=1&pagina=2&ordenarPor=numeroPo&ordem=asc')).json();
    expect(pag).toMatchObject({ total: 2, pagina: 2, porPagina: 1 });
    expect(pag.itens[0].numeroPo).toBe('4533000002');
  });
});
