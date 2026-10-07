const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export const reais = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : moeda.format(Number(v)));

/** Datas "de calendário" (emissão) vêm como meia-noite UTC: mostra o dia sem converter fuso. */
export function data(v: string | null | undefined) {
  if (!v) return '—';
  const [a, m, d] = v.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export const quando = (v: string | null | undefined) => (v ? dataHora.format(new Date(v)) : '—');

export const hojeIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export const numero = (n: number | undefined) => (n == null ? '' : n.toLocaleString('pt-BR'));
