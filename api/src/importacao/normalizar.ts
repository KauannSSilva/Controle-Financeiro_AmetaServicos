import { StatusPo } from '@prisma/client';
import { ITENS_PERMITIDOS } from '../ordens/status.js';

/** Valor de célula já resolvido (fórmulas trazem o último valor calculado pelo Excel). */
export type Celula = string | number | boolean | Date | null;

/** Colunas da aba AMETA-2025-NEW usadas na importação (cabeçalho comparado sem espaços nas pontas). */
export const COLUNAS = {
  status: 'STATUS',
  obs: 'OBS. DA NF-e',
  idSite: 'ID SITE',
  po: 'P.O',
  item: 'ITEM',
  site: 'SITE',
  fase: 'FASE',
  tecnologia: 'TECNOLOGIA',
  projeto: 'PROJETOS',
  uf: 'UF',
  operadora: 'OPERADORA',
  multa: 'MULTA',
  precoComMulta: 'PREÇO c/MULTA',
  precoOriginal: 'PREÇO ORIGINAL',
  nfse: 'N°NFS-e',
  dataEmissao: 'NOTA EMITIDA',
  migo: 'N°MIGO',
  statusFinanceiro: 'STATUS FINANCEIRO',
} as const;

export type ChaveColuna = keyof typeof COLUNAS;
export type LinhaBruta = Partial<Record<ChaveColuna, Celula>>;

export interface ItemNormalizado {
  linhaPlanilha: number;
  numeroPo: string;
  item: string | null;
  idSite: string | null;
  site: string | null;
  fase: string | null;
  tecnologia: string | null;
  projeto: string | null;
  uf: string | null;
  operadora: string | null;
  valorOriginal: string | null;
  percentualMulta: string | null;
  possuiMulta: boolean;
  status: StatusPo;
  statusOrigem: string;
  numeroNfse: string | null;
  dataEmissao: Date | null;
  numeroMigo: string | null;
  observacoes: string | null;
}

export interface Aviso {
  linha: number;
  coluna: string;
  valor: string;
  motivo: string;
}

export type ResultadoLinha =
  | { ok: true; item: ItemNormalizado; avisos: Aviso[] }
  | { ok: false; linha: number; motivo: string; avisos: Aviso[] };

/**
 * Status da planilha → enum. Inclui os rótulos antigos com o mapeamento decidido pela Ameta em 01/10/2026,
 * para que versões antigas da planilha também importem.
 */
const MAPA_STATUS: Record<string, { status: StatusPo; multa?: boolean }> = {
  'AGUARDANDO LIBERAÇÃO': { status: 'AGUARDANDO_LIBERACAO' },
  'EMITIR NOTA': { status: 'EMITIR_NOTA' },
  'EM EXECUÇÃO': { status: 'EM_EXECUCAO' },
  'EMITIDA NOTA FISCAL': { status: 'EMITIDA' },
  'EMITIDA NOTA FISCAL C/ MULTA': { status: 'EMITIDA', multa: true },
  CANCELADO: { status: 'CANCELADO' },
  'NOTA DUPLICADA CANCELADA': { status: 'CANCELADO' },
  'P.O CANCELADO': { status: 'CANCELADO' },
  'PEDIDO CANCELADO': { status: 'CANCELADO' },
  'SITE CANCELADO': { status: 'CANCELADO' },
  PENDENTE: { status: 'EM_EXECUCAO' },
};

/** trim, troca espaço não separável por espaço comum e junta espaços repetidos. Vazio vira null. */
export function texto(v: Celula | undefined): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (v instanceof Date) s = v.toISOString().slice(0, 10);
  else s = String(v);
  s = s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** Aceita número do Excel ou texto no formato brasileiro ("1.234,56", "R$ 97,90"). Retorna string com 2 casas. */
export function dinheiro(v: Celula | undefined): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : undefined;
  const s = texto(v);
  if (s === null) return null;
  const limpo = s.replace(/R\$/i, '').replace(/\s/g, '');
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return undefined;
  return Number(normalizado).toFixed(2);
}

/** Data do Excel ou texto dd/mm/aaaa ou aaaa-mm-dd. Retorna data à meia-noite UTC. */
export function data(v: Celula | undefined): Date | null | undefined {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = texto(v);
  if (s === null) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return dataValida(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return dataValida(+m[1], +m[2], +m[3]);
  return undefined;
}

function dataValida(ano: number, mes: number, dia: number): Date | undefined {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : undefined;
}

export function chaveStatus(v: Celula | undefined): string {
  return (texto(v) ?? '').toUpperCase();
}

export function normalizarLinha(linha: number, bruta: LinhaBruta): ResultadoLinha {
  const avisos: Aviso[] = [];
  const avisar = (coluna: ChaveColuna, valor: Celula | undefined, motivo: string) =>
    avisos.push({ linha, coluna: COLUNAS[coluna], valor: texto(valor) ?? '', motivo });
  const rejeitar = (motivo: string): ResultadoLinha => ({ ok: false, linha, motivo, avisos });

  // STATUS
  const statusOrigem = texto(bruta.status);
  if (!statusOrigem) return rejeitar('STATUS vazio');
  const mapeado = MAPA_STATUS[chaveStatus(bruta.status)];
  if (!mapeado) return rejeitar(`STATUS não reconhecido: "${statusOrigem}"`);

  // P.O: só dígitos (a planilha usa apóstrofos e acentos no fim para repetir o número)
  const poTexto = texto(bruta.po);
  if (!poTexto) return rejeitar('P.O vazia');
  const numeroPo = poTexto.replace(/\D/g, '');
  if (!numeroPo) return rejeitar(`P.O sem dígitos: "${poTexto}"`);
  if (numeroPo.length > 20) return rejeitar(`P.O com mais de 20 dígitos: "${poTexto}"`);
  if (numeroPo.length !== 10) avisar('po', bruta.po, `P.O com ${numeroPo.length} dígitos (o normal são 10)`);

  // ITEM
  const item = texto(bruta.item);
  if (item !== null && !(ITENS_PERMITIDOS as readonly string[]).includes(item)) {
    return rejeitar(`ITEM fora da lista permitida: "${item}"`);
  }

  // Valores
  const valorOriginal = dinheiro(bruta.precoOriginal);
  if (valorOriginal === undefined) return rejeitar(`PREÇO ORIGINAL inválido: "${texto(bruta.precoOriginal)}"`);
  if (valorOriginal !== null && Number(valorOriginal) < 0) return rejeitar('PREÇO ORIGINAL negativo');

  let percentualMulta = dinheiro(bruta.multa);
  if (percentualMulta === undefined) {
    avisar('multa', bruta.multa, 'MULTA não numérica, importada como vazia');
    percentualMulta = null;
  } else if (percentualMulta !== null && (Number(percentualMulta) < 0 || Number(percentualMulta) > 100)) {
    return rejeitar(`MULTA fora de 0 a 100: "${percentualMulta}"`);
  }

  const possuiMulta = mapeado.multa === true;
  if (possuiMulta && percentualMulta === null) avisar('status', bruta.status, 'Emitida c/ multa sem percentual na coluna MULTA');
  if (!possuiMulta && percentualMulta !== null && mapeado.status === 'EMITIDA') {
    avisar('multa', bruta.multa, 'Percentual de multa preenchido em nota emitida sem multa');
  }

  // Confere o PREÇO c/MULTA da planilha com o cálculo do banco
  const precoComMulta = dinheiro(bruta.precoComMulta);
  if (precoComMulta) {
    const calculado = (Number(valorOriginal ?? 0) * Number(percentualMulta ?? 100)) / 100;
    if (Math.abs(calculado - Number(precoComMulta)) > 0.005) {
      avisar('precoComMulta', bruta.precoComMulta, `PREÇO c/MULTA difere do cálculo (${calculado.toFixed(2)})`);
    }
  }

  // Data
  let dataEmissao = data(bruta.dataEmissao);
  if (dataEmissao === undefined) {
    return rejeitar(`NOTA EMITIDA não é uma data: "${texto(bruta.dataEmissao)}"`);
  }
  if (dataEmissao && dataEmissao.getUTCFullYear() < 2020) {
    avisar('dataEmissao', bruta.dataEmissao, `Data de emissão em ${dataEmissao.getUTCFullYear()} (possível erro de digitação)`);
  }

  // Textos e listas
  const tecnologia = texto(bruta.tecnologia)?.toUpperCase() ?? null;
  if (tecnologia && !['NR', '5G'].includes(tecnologia)) return rejeitar(`TECNOLOGIA desconhecida: "${tecnologia}"`);
  const operadora = texto(bruta.operadora)?.toUpperCase() ?? null;
  if (operadora && !['CLARO', 'VIVO', 'AT&T'].includes(operadora)) return rejeitar(`OPERADORA desconhecida: "${operadora}"`);
  const uf = texto(bruta.uf)?.toUpperCase() ?? null;
  if (uf && !/^[A-Z]{2}$/.test(uf)) return rejeitar(`UF inválida: "${uf}"`);

  const site = texto(bruta.site);
  if (typeof bruta.site === 'number' && Math.abs(bruta.site) >= 1e15) {
    avisar('site', bruta.site, 'SITE gravado pelo Excel como número gigante (texto original perdido na planilha)');
  }

  const numeroNfse = texto(bruta.nfse);
  if (numeroNfse && !/^\d+$/.test(numeroNfse)) avisar('nfse', bruta.nfse, 'N°NFS-e não numérico');
  const emitida = mapeado.status === 'EMITIDA';
  if (emitida && (!numeroNfse || !dataEmissao)) avisar('nfse', bruta.nfse, 'Nota emitida sem número da NFS-e ou sem data');
  if (!emitida && numeroNfse) avisar('nfse', bruta.nfse, `NFS-e preenchida em status ${statusOrigem}`);

  // STATUS FINANCEIRO da planilha diferente da regra (valor digitado por cima da fórmula)
  const sfPlanilha = texto(bruta.statusFinanceiro)?.toUpperCase();
  const sfRegra = mapeado.status === 'EMITIDA' ? 'FECHADO' : mapeado.status === 'EMITIR_NOTA' ? 'ENTREGUE' : 'NOVO';
  if (sfPlanilha && sfPlanilha !== sfRegra) {
    avisar('statusFinanceiro', bruta.statusFinanceiro, `STATUS FINANCEIRO digitado à mão; o banco calcula ${sfRegra}`);
  }

  const normalizado: ItemNormalizado = {
    linhaPlanilha: linha,
    numeroPo,
    item,
    idSite: texto(bruta.idSite),
    site,
    fase: texto(bruta.fase)?.toUpperCase() ?? null,
    tecnologia,
    projeto: texto(bruta.projeto),
    uf,
    operadora,
    valorOriginal,
    percentualMulta,
    possuiMulta,
    status: mapeado.status,
    statusOrigem,
    numeroNfse,
    dataEmissao,
    numeroMigo: texto(bruta.migo),
    observacoes: texto(bruta.obs),
  };

  for (const [campo, limite] of Object.entries(LIMITES) as [keyof typeof LIMITES, number][]) {
    const valor = normalizado[campo];
    if (valor && valor.length > limite) return rejeitar(`${campo} com mais de ${limite} caracteres`);
  }

  return { ok: true, avisos, item: normalizado };
}

/** Tamanhos máximos das colunas de texto no banco. */
const LIMITES = { idSite: 50, site: 100, fase: 20, projeto: 150, numeroNfse: 30, numeroMigo: 30 } as const;
