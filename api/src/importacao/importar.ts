import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Prisma, PrismaClient, StatusPo } from '@prisma/client';
import {
  Aviso, Celula, ChaveColuna, COLUNAS, ItemNormalizado, LinhaBruta, normalizarLinha,
} from './normalizar.js';

export const ABA_PRINCIPAL = 'AMETA-2025-NEW';

export interface Rejeicao {
  linha: number;
  motivo: string;
  dados: string;
}

export interface LeituraPlanilha {
  lidas: number;
  validos: ItemNormalizado[];
  rejeitadas: Rejeicao[];
  avisos: Aviso[];
  /** Linhas por texto original do STATUS, contando também as rejeitadas */
  porStatusPlanilha: Record<string, number>;
  /** Soma do PREÇO ORIGINAL de todas as linhas lidas */
  totalPrecoOriginal: number;
}

export interface ResultadoImportacao extends LeituraPlanilha {
  inseridas: number;
  atualizadas: number;
  semMudanca: number;
  posCriadas: number;
}

/** Converte o valor de uma célula do ExcelJS (fórmula, rich text, hyperlink...) em valor simples. */
export function valorCelula(v: ExcelJS.CellValue): Celula {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return valorCelula((v.result ?? null) as ExcelJS.CellValue);
    if ('formula' in v || 'sharedFormula' in v) return null; // fórmula sem valor calculado
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return valorCelula(v.text as ExcelJS.CellValue);
    if ('error' in v) return null;
  }
  return String(v);
}

/**
 * Abre o .xlsx. Arquivos salvos por algumas ferramentas (openpyxl, scripts) gravam caminhos absolutos
 * ("/xl/tables/table1.xml") nos relacionamentos das abas, e o ExcelJS só entende caminhos relativos.
 * Os caminhos são convertidos em memória; o arquivo original não é alterado.
 */
async function carregarWorkbook(arquivo: string): Promise<ExcelJS.Workbook> {
  const zip = await JSZip.loadAsync(await readFile(arquivo));
  for (const nome of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/_rels\/.+\.rels$/.test(n))) {
    const xml = await zip.file(nome)!.async('string');
    if (xml.includes('Target="/xl/')) zip.file(nome, xml.replace(/Target="\/xl\//g, 'Target="../'));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await zip.generateAsync({ type: 'uint8array' })) as unknown as ExcelJS.Buffer);
  return wb;
}

export async function lerPlanilha(arquivo: string, aba = ABA_PRINCIPAL): Promise<LeituraPlanilha> {
  const wb = await carregarWorkbook(arquivo);
  const ws = wb.getWorksheet(aba);
  if (!ws) throw new Error(`Aba "${aba}" não encontrada. Abas: ${wb.worksheets.map((w) => w.name).join(', ')}`);

  // Cabeçalho: compara sem espaços nas pontas ("STATUS " tem espaço no fim na planilha)
  const indice: Partial<Record<ChaveColuna, number>> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const nome = String(valorCelula(cell.value) ?? '').trim();
    const chave = (Object.keys(COLUNAS) as ChaveColuna[]).find((k) => COLUNAS[k] === nome);
    if (chave && indice[chave] === undefined) indice[chave] = col;
  });
  const obrigatorias: ChaveColuna[] = ['status', 'po', 'item', 'precoOriginal', 'nfse', 'dataEmissao'];
  const faltando = obrigatorias.filter((k) => indice[k] === undefined).map((k) => COLUNAS[k]);
  if (faltando.length) throw new Error(`Colunas obrigatórias ausentes na aba "${aba}": ${faltando.join(', ')}`);

  const resultado: LeituraPlanilha = {
    lidas: 0, validos: [], rejeitadas: [], avisos: [], porStatusPlanilha: {}, totalPrecoOriginal: 0,
  };

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const bruta: LinhaBruta = {};
    let vazia = true;
    for (const [chave, col] of Object.entries(indice) as [ChaveColuna, number][]) {
      const v = valorCelula(row.getCell(col).value);
      bruta[chave] = v;
      if (v !== null && String(v).trim() !== '') vazia = false;
    }
    if (vazia) continue;

    resultado.lidas++;
    const statusTexto = String(bruta.status ?? '').trim() || '(vazio)';
    resultado.porStatusPlanilha[statusTexto] = (resultado.porStatusPlanilha[statusTexto] ?? 0) + 1;
    if (typeof bruta.precoOriginal === 'number') resultado.totalPrecoOriginal += bruta.precoOriginal;

    const n = normalizarLinha(r, bruta);
    resultado.avisos.push(...n.avisos);
    if (n.ok) resultado.validos.push(n.item);
    else {
      resultado.rejeitadas.push({
        linha: r,
        motivo: n.motivo,
        dados: (Object.keys(indice) as ChaveColuna[])
          .map((k) => `${COLUNAS[k]}=${formatar(bruta[k])}`)
          .join(' | '),
      });
    }
  }
  resultado.totalPrecoOriginal = Math.round(resultado.totalPrecoOriginal * 100) / 100;
  return resultado;
}

function formatar(v: Celula | undefined): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === null || v === undefined ? '' : String(v);
}

type CamposItem = Omit<ItemNormalizado, 'numeroPo' | 'linhaPlanilha'>;

function camposItem(i: ItemNormalizado): CamposItem {
  const { numeroPo: _po, linhaPlanilha: _l, ...campos } = i;
  return campos;
}

function igual(atual: Record<string, unknown>, novo: CamposItem): boolean {
  return (Object.keys(novo) as (keyof CamposItem)[]).every((k) => {
    const a = atual[k];
    const b = novo[k];
    if (a instanceof Date || b instanceof Date) return (a as Date | null)?.getTime() === (b as Date | null)?.getTime();
    if (a instanceof Prisma.Decimal) return b !== null && a.equals(new Prisma.Decimal(b as string));
    return (a ?? null) === (b ?? null);
  });
}

/**
 * Grava a leitura no banco numa única transação.
 * Idempotente: a chave é a linha da planilha. Rodar de novo com o mesmo arquivo não muda nada;
 * com o arquivo alterado, atualiza as linhas que mudaram e registra no histórico as mudanças de status.
 */
export async function gravarNoBanco(prisma: PrismaClient, leitura: LeituraPlanilha): Promise<ResultadoImportacao> {
  return prisma.$transaction(
    async (tx) => {
      // P.Os
      const numeros = [...new Set(leitura.validos.map((i) => i.numeroPo))];
      const criadas = await tx.ordemCompra.createMany({
        data: numeros.map((numeroPo) => ({ numeroPo })),
        skipDuplicates: true,
      });
      const ordens = await tx.ordemCompra.findMany({ where: { numeroPo: { in: numeros } }, select: { id: true, numeroPo: true } });
      const idPorNumero = new Map(ordens.map((o) => [o.numeroPo, o.id]));

      // Itens já importados antes
      const existentes = await tx.itemPo.findMany({
        where: { linhaPlanilha: { in: leitura.validos.map((i) => i.linhaPlanilha) } },
      });
      const existentePorLinha = new Map(existentes.map((e) => [e.linhaPlanilha!, e]));

      const novos = leitura.validos.filter((i) => !existentePorLinha.has(i.linhaPlanilha));
      await tx.itemPo.createMany({
        data: novos.map((i) => ({ ...camposItem(i), linhaPlanilha: i.linhaPlanilha, ordemCompraId: idPorNumero.get(i.numeroPo)! })),
      });
      const criadosIds = await tx.itemPo.findMany({
        where: { linhaPlanilha: { in: novos.map((i) => i.linhaPlanilha) } },
        select: { id: true, status: true, possuiMulta: true },
      });
      await tx.historicoStatus.createMany({
        data: criadosIds.map((c) => ({
          itemPoId: c.id, statusDe: null, statusPara: c.status, possuiMulta: c.possuiMulta, motivo: 'Importado da planilha',
        })),
      });

      let atualizadas = 0;
      let semMudanca = 0;
      for (const i of leitura.validos) {
        const atual = existentePorLinha.get(i.linhaPlanilha);
        if (!atual) continue;
        const campos = camposItem(i);
        const ordemCompraId = idPorNumero.get(i.numeroPo)!;
        if (atual.ordemCompraId === ordemCompraId && igual(atual as unknown as Record<string, unknown>, campos)) {
          semMudanca++;
          continue;
        }
        await tx.itemPo.update({ where: { id: atual.id }, data: { ...campos, ordemCompraId } });
        if (atual.status !== i.status || atual.possuiMulta !== i.possuiMulta) {
          await tx.historicoStatus.create({
            data: {
              itemPoId: atual.id, statusDe: atual.status, statusPara: i.status as StatusPo,
              possuiMulta: i.possuiMulta, motivo: 'Reimportação da planilha',
            },
          });
        }
        atualizadas++;
      }

      return { ...leitura, inseridas: novos.length, atualizadas, semMudanca, posCriadas: criadas.count };
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
}
