import { PrismaClient } from '@prisma/client';
import { LeituraPlanilha } from './importar.js';

export interface Checagem {
  nome: string;
  ok: boolean;
  detalhe: string;
}

export interface TotalStatus {
  status: string;
  itens: number;
  valorOriginal: number;
  valorFinal: number;
}

const centavos = (n: number) => Math.round(n * 100);

/** Confere, direto no banco, se o que foi gravado bate com o que foi lido da planilha. */
export async function validarCarga(prisma: PrismaClient, leitura: LeituraPlanilha) {
  const linhas = leitura.validos.map((i) => i.linhaPlanilha);

  const porStatus = await prisma.$queryRaw<{ status: string; itens: bigint; valor_original: string; valor_final: string }[]>`
    SELECT status::text AS status, COUNT(*) AS itens,
           COALESCE(SUM(valor_original), 0)::text AS valor_original,
           COALESCE(SUM(valor_final), 0)::text AS valor_final
    FROM vw_itens_po
    WHERE linha_planilha = ANY(${linhas}::int[])
    GROUP BY status ORDER BY COUNT(*) DESC`;
  const totais: TotalStatus[] = porStatus.map((s) => ({
    status: s.status, itens: Number(s.itens), valorOriginal: Number(s.valor_original), valorFinal: Number(s.valor_final),
  }));

  const esperadoPorStatus = new Map<string, number>();
  for (const i of leitura.validos) esperadoPorStatus.set(i.status, (esperadoPorStatus.get(i.status) ?? 0) + 1);
  const esperadoMulta = leitura.validos.filter((i) => i.possuiMulta).length;

  const [{ multa }] = await prisma.$queryRaw<{ multa: bigint }[]>`
    SELECT COUNT(*) AS multa FROM vw_itens_po WHERE possui_multa AND linha_planilha = ANY(${linhas}::int[])`;
  const [{ pos }] = await prisma.$queryRaw<{ pos: bigint }[]>`
    SELECT COUNT(DISTINCT numero_po) AS pos FROM vw_itens_po WHERE linha_planilha = ANY(${linhas}::int[])`;
  const semHistorico = await prisma.itemPo.count({ where: { linhaPlanilha: { in: linhas }, historico: { none: {} } } });

  const noBanco = totais.reduce((s, t) => s + t.itens, 0);
  const valorBanco = totais.reduce((s, t) => s + t.valorOriginal, 0);
  const valorEsperado = leitura.validos.reduce((s, i) => s + Number(i.valorOriginal ?? 0), 0);
  const valorRejeitado = leitura.totalPrecoOriginal - valorEsperado;
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const checagens: Checagem[] = [
    {
      nome: 'Linhas lidas = importadas + rejeitadas',
      ok: leitura.lidas === leitura.validos.length + leitura.rejeitadas.length,
      detalhe: `${leitura.lidas} = ${leitura.validos.length} + ${leitura.rejeitadas.length}`,
    },
    { nome: 'Itens no banco', ok: noBanco === leitura.validos.length, detalhe: `${noBanco} de ${leitura.validos.length}` },
    {
      nome: 'Itens por status',
      ok: [...esperadoPorStatus].every(([s, n]) => totais.find((t) => t.status === s)?.itens === n),
      detalhe: [...esperadoPorStatus].map(([s, n]) => `${s} ${n}`).join(', '),
    },
    { nome: 'Emitidas com multa', ok: Number(multa) === esperadoMulta, detalhe: `${multa} de ${esperadoMulta}` },
    {
      nome: 'P.Os distintas',
      ok: Number(pos) === new Set(leitura.validos.map((i) => i.numeroPo)).size,
      detalhe: `${pos}`,
    },
    {
      nome: 'Soma do PREÇO ORIGINAL',
      ok: centavos(valorBanco) === centavos(valorEsperado),
      detalhe: `${brl(valorBanco)} no banco + ${brl(valorRejeitado)} rejeitado = ${brl(leitura.totalPrecoOriginal)} na planilha`,
    },
    { nome: 'Todo item tem histórico de status', ok: semHistorico === 0, detalhe: `${semHistorico} sem histórico` },
  ];

  return { checagens, porStatus: totais };
}
