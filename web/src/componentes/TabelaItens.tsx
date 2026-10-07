import { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { data, reais } from '../formato';
import { Item } from '../tipos';
import { AcoesItem } from './AcoesItem';
import { SeloStatus } from './ui';

export type CampoOrdem = 'dataEmissao' | 'valorOriginal' | 'numeroPo' | 'numeroNfse' | 'atualizadoEm' | 'criadoEm';

interface Coluna { titulo: string; ordem?: CampoOrdem; classe?: string; valor: (i: Item) => ReactNode }

const COLUNAS: Record<string, Coluna> = {
  po: { titulo: 'P.O', ordem: 'numeroPo', classe: 'font-medium text-marca-700', valor: (i) => i.numeroPo },
  item: { titulo: 'Item', valor: (i) => i.item ?? '—' },
  site: { titulo: 'Site', valor: (i) => <span className="block max-w-56 truncate" title={i.site ?? ''}>{[i.idSite, i.site].filter(Boolean).join(' · ') || '—'}</span> },
  projeto: { titulo: 'Projeto', valor: (i) => <span className="block max-w-48 truncate" title={i.projeto ?? ''}>{i.projeto ?? '—'}</span> },
  operadora: { titulo: 'Cliente', valor: (i) => [i.operadora, i.uf].filter(Boolean).join(' · ') || '—' },
  valor: { titulo: 'Preço original', ordem: 'valorOriginal', classe: 'text-right tabular-nums', valor: (i) => reais(i.valorOriginal) },
  valorFinal: { titulo: 'Valor final', classe: 'text-right tabular-nums', valor: (i) => reais(i.valorFinal) },
  nfse: { titulo: 'NFS-e', ordem: 'numeroNfse', valor: (i) => i.numeroNfse ?? '—' },
  emissao: { titulo: 'Emissão', ordem: 'dataEmissao', classe: 'tabular-nums', valor: (i) => data(i.dataEmissao) },
  status: { titulo: 'Status', valor: (i) => <SeloStatus status={i.status} rotulo={i.rotuloStatus} multa={i.status === 'EMITIDA' && i.possuiMulta} /> },
  multa: { titulo: 'Multa', valor: (i) => (i.possuiMulta ? <span className="text-orange-700">Sim{i.percentualMulta ? ` (recebe ${Number(i.percentualMulta)}%)` : ''}</span> : 'Não') },
};

export type NomeColuna = keyof typeof COLUNAS;

export function TabelaItens({ itens, colunas, ordenarPor, ordem, aoOrdenar, acoes = true, vazio = 'Nenhuma P.O encontrada.', extra }: {
  itens: Item[];
  colunas: NomeColuna[];
  ordenarPor?: CampoOrdem;
  ordem?: 'asc' | 'desc';
  aoOrdenar?: (c: CampoOrdem) => void;
  acoes?: boolean;
  vazio?: string;
  extra?: (i: Item) => ReactNode;
}) {
  const navegar = useNavigate();
  const cols = colunas.map((c) => COLUNAS[c]);
  return (
    <div className="relative overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>
            {cols.map((c) => (
              <th key={c.titulo} scope="col" className={`whitespace-nowrap px-3 py-2.5 ${c.classe?.includes('text-right') ? 'text-right' : ''}`}
                aria-sort={c.ordem && c.ordem === ordenarPor ? (ordem === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.ordem && aoOrdenar ? (
                  <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-marca-700" onClick={() => aoOrdenar(c.ordem!)}>
                    {c.titulo}
                    <span aria-hidden className="text-slate-400">{c.ordem === ordenarPor ? (ordem === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                ) : c.titulo}
              </th>
            ))}
            {(acoes || extra) && <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {itens.length === 0 && (
            <tr><td colSpan={cols.length + 1} className="px-3 py-8 text-center text-slate-500">{vazio}</td></tr>
          )}
          {itens.map((i) => (
            // Itens removidos (com ações próprias) não abrem o detalhe, que mostra só os ativos
            <tr key={i.id} className={extra ? '' : 'cursor-pointer hover:bg-marca-50/60'} onClick={extra ? undefined : () => navegar(`/po/${i.numeroPo}`)}>
              {cols.map((c) => <td key={c.titulo} className={`whitespace-nowrap px-3 py-2 ${c.classe ?? ''}`}>{c.valor(i)}</td>)}
              {(acoes || extra) && (
                <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                  {extra ? extra(i) : <AcoesItem item={i} compacto />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
