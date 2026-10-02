import ExcelJS from 'exceljs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { gravarNoBanco, lerPlanilha } from '../src/importacao/importar.js';
import { validarCarga } from '../src/importacao/validar.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
beforeEach(() => limparBanco(prisma));
afterAll(() => prisma.$disconnect());

const CABECALHO = [
  'STATUS ', 'STATUS FINANCEIRO', 'OBS. DA NF-e', 'ID SITE', 'P.O', 'ITEM', 'SITE', 'FASE', 'TECNOLOGIA', 'PROJETOS',
  'UF', 'OPERADORA', 'MULTA', 'PREÇO c/MULTA', 'PREÇO ORIGINAL', 'N°NFS-e', 'NOTA EMITIDA', 'N°MIGO', 'MÊS',
];

type Linha = (string | number | Date | null)[];
const d = (s: string) => new Date(`${s}T00:00:00Z`);

// Dados fictícios, no mesmo formato da planilha real
const LINHAS: Linha[] = [
  ['EMITIDA NOTA FISCAL', 'FECHADO', null, 'KA25000001', 4500000001, 10, 'SPXXX01', 'K2552', '5G', 'PPI Claro', 'SP', 'CLARO', null, 350, 350, 1001, d('2026-03-19'), null, 'Março'],
  ['EMITIDA NOTA FISCAL C/ MULTA', 'FECHADO', null, null, 4500000002, '10 20', 'SPXXX02', 'K2552', '5G', 'PROJETO TX', 'SP', 'CLARO', 88, 2758.8, 3135, 1002, d('2026-04-01'), null, 'Abril'],
  ['AGUARDANDO LIBERAÇÃO', 'NOVO', null, null, "4500000003'", 10, null, 'F2501', 'NR', 'PROJETO TX', null, 'VIVO', null, 97.9, 97.9, null, null, null, 'Nota não feita'],
  ['AGUARDANDO LIBERAÇÃO', 'NOVO', null, null, "4500000003''", 20, null, 'F2501', 'NR', 'PROJETO TX', null, 'VIVO', null, 97.9, 97.9, null, null, null, 'Nota não feita'],
  ['CANCELADO', 'NOVO', null, null, 4500000004, 10, null, 'K2552', '5G', 'SDCSCI', 'SP', 'CLARO', null, 588, 588, null, null, null, 'Nota não feita'],
  ['EMITIR NOTA', 'ENTREGUE', 'APROVADO', null, 4500000005, 10, null, 'K2652', '5G', 'QRF Claro', 'SP', 'CLARO', null, 94, 94, null, null, null, 'Nota não feita'],
  ['EM EXECUÇÃO', 'NOVO', null, null, 4500000006, 10, null, 'K2552', '5G', 'QRF Claro', 'RJ', 'CLARO', null, 0, null, null, null, null, 'Nota não feita'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ['EMITIDA NOTA FISCAL', 'FECHADO', null, null, null, 10, null, 'K2552', '5G', 'PPI Claro', 'SP', 'CLARO', null, 250, 250, 1003, d('2026-03-04'), null, 'Março'],
  ['STATUS INVENTADO', 'NOVO', null, null, 4500000007, 10, null, 'K2552', '5G', 'PPI Claro', 'SP', 'CLARO', null, 10, 10, null, null, null, 'Nota não feita'],
];

async function criarPlanilha(linhas: Linha[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('AMETA-2025-NEW');
  ws.addRow(CABECALHO);
  for (const l of linhas) ws.addRow(l);
  wb.addWorksheet('MENU').addRow(['lista']);
  const arquivo = path.join(await mkdtemp(path.join(tmpdir(), 'ameta-')), 'planilha.xlsx');
  await wb.xlsx.writeFile(arquivo);
  return arquivo;
}

describe('importação da planilha', () => {
  it('importa, rejeita com motivo e confere os totais', async () => {
    const leitura = await lerPlanilha(await criarPlanilha(LINHAS));
    expect(leitura.lidas).toBe(9); // a linha vazia é ignorada
    expect(leitura.rejeitadas.map((r) => [r.linha, r.motivo])).toEqual([
      [10, 'P.O vazia'],
      [11, 'STATUS não reconhecido: "STATUS INVENTADO"'],
    ]);

    const r = await gravarNoBanco(prisma, leitura);
    expect(r).toMatchObject({ inseridas: 7, atualizadas: 0, posCriadas: 6 });

    const v = await validarCarga(prisma, r);
    expect(v.checagens.filter((c) => !c.ok)).toEqual([]);
    expect(leitura.totalPrecoOriginal).toBe(4622.8);

    // P.O com apóstrofo vira uma P.O com dois itens
    const po = await prisma.ordemCompra.findUnique({ where: { numeroPo: '4500000003' }, include: { itens: true } });
    expect(po?.itens.map((i) => i.item).sort()).toEqual(['10', '20']);

    const multa = await prisma.itemPo.findFirst({ where: { possuiMulta: true } });
    expect(multa).toMatchObject({ status: 'EMITIDA', item: '10 20', statusOrigem: 'EMITIDA NOTA FISCAL C/ MULTA' });
    expect(multa?.percentualMulta?.toString()).toBe('88');
  });

  it('é idempotente e registra mudança de status numa reimportação', async () => {
    const arquivo = await criarPlanilha(LINHAS);
    await gravarNoBanco(prisma, await lerPlanilha(arquivo));
    const segunda = await gravarNoBanco(prisma, await lerPlanilha(arquivo));
    expect(segunda).toMatchObject({ inseridas: 0, atualizadas: 0, semMudanca: 7, posCriadas: 0 });
    expect(await prisma.itemPo.count()).toBe(7);
    expect(await prisma.historicoStatus.count()).toBe(7);

    const alteradas = LINHAS.map((l) => [...l]);
    alteradas[5][0] = 'EMITIDA NOTA FISCAL'; // linha 7 da planilha: Emitir Nota → Emitida
    const terceira = await gravarNoBanco(prisma, await lerPlanilha(await criarPlanilha(alteradas)));
    expect(terceira).toMatchObject({ inseridas: 0, atualizadas: 1 });
    const item = await prisma.itemPo.findUnique({ where: { linhaPlanilha: 7 }, include: { historico: { orderBy: { criadoEm: 'asc' } } } });
    expect(item?.historico.map((h) => [h.statusDe, h.statusPara])).toEqual([
      [null, 'EMITIR_NOTA'],
      ['EMITIR_NOTA', 'EMITIDA'],
    ]);
  });

  it('falha com mensagem clara se faltar coluna obrigatória', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('AMETA-2025-NEW').addRow(['STATUS', 'P.O']);
    const arquivo = path.join(await mkdtemp(path.join(tmpdir(), 'ameta-')), 'ruim.xlsx');
    await wb.xlsx.writeFile(arquivo);
    await expect(lerPlanilha(arquivo)).rejects.toThrow(/Colunas obrigatórias ausentes.*ITEM/);
  });
});
