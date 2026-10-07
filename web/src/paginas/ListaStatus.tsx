import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { FormItem } from '../componentes/FormItem';
import { CampoOrdem, NomeColuna, TabelaItens } from '../componentes/TabelaItens';
import { Alerta, Botao, Campo, Carregando, Modal, Paginacao, Selecao } from '../componentes/ui';
import { numero } from '../formato';
import { Contadores, Item, OPERADORAS, Pagina, Status, STATUS } from '../tipos';

const POR_PAGINA = 50;

const COLUNAS: Record<Status, NomeColuna[]> = {
  AGUARDANDO_LIBERACAO: ['po', 'item', 'site', 'projeto', 'operadora', 'valor'],
  EMITIR_NOTA: ['po', 'item', 'site', 'projeto', 'operadora', 'valor'],
  EM_EXECUCAO: ['po', 'item', 'site', 'projeto', 'operadora', 'valor'],
  EMITIDA: ['po', 'item', 'site', 'operadora', 'nfse', 'emissao', 'valor', 'multa', 'valorFinal'],
  CANCELADO: ['po', 'item', 'site', 'projeto', 'operadora', 'nfse', 'valor'],
};

export function ListaStatus({ status }: { status: Status }) {
  const { pode } = useAuth();
  const info = STATUS.find((s) => s.valor === status)!;
  const [params, setParams] = useSearchParams();
  const [adicionando, setAdicionando] = useState(false);
  const p = (k: string) => params.get(k) ?? '';
  const pagina = Number(p('pagina')) || 1;
  const ordenarPor = (p('ordenarPor') || undefined) as CampoOrdem | undefined;
  const ordem = (p('ordem') || 'desc') as 'asc' | 'desc';
  const multa = p('multa') as '' | 'com' | 'sem';

  // Filtros digitados só valem ao clicar em Filtrar
  const [busca, setBusca] = useState(p('busca'));
  const [operadora, setOperadora] = useState(p('operadora'));
  const [uf, setUf] = useState(p('uf'));
  const [de, setDe] = useState(p('de'));
  const [ate, setAte] = useState(p('ate'));
  const [valorMin, setValorMin] = useState(p('valorMin'));
  const [valorMax, setValorMax] = useState(p('valorMax'));

  function atualizar(novos: Record<string, string | undefined>) {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) if (v) n.set(k, v); else n.delete(k);
    if (!('pagina' in novos)) n.delete('pagina');
    setParams(n, { replace: true });
  }

  const filtrar = (e: FormEvent) => {
    e.preventDefault();
    const dinheiro = (v: string) => v.trim().replace(/\./g, '').replace(',', '.');
    atualizar({ busca: busca.trim(), operadora, uf: uf.trim().toUpperCase(), de, ate, valorMin: dinheiro(valorMin), valorMax: dinheiro(valorMax) });
  };
  const limpar = () => {
    setBusca(''); setOperadora(''); setUf(''); setDe(''); setAte(''); setValorMin(''); setValorMax('');
    setParams(multa ? { multa } : {}, { replace: true });
  };
  const ordenar = (c: CampoOrdem) =>
    atualizar({ ordenarPor: c, ordem: c === ordenarPor && ordem === 'desc' ? 'asc' : 'desc' });

  const filtros = {
    status, multa: status === 'EMITIDA' ? multa || undefined : undefined,
    busca: p('busca'), operadora: p('operadora'), uf: p('uf'), de: p('de'), ate: p('ate'),
    valorMin: p('valorMin'), valorMax: p('valorMax'), ordenarPor, ordem: ordenarPor ? ordem : undefined,
    pagina, porPagina: POR_PAGINA,
  };
  const lista = useQuery({
    queryKey: ['itens', filtros],
    queryFn: () => api.get<Pagina<Item>>('itens', filtros),
    placeholderData: keepPreviousData,
  });
  const contadores = useQuery({ queryKey: ['contadores'], queryFn: () => api.get<Contadores>('contadores') });
  const temFiltro = ['busca', 'operadora', 'uf', 'de', 'ate', 'valorMin', 'valorMax'].some((k) => p(k));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{info.rotulo}</h1>
        {pode('ADMIN', 'OPERADOR') && <Botao onClick={() => setAdicionando(true)}>+ Adicionar</Botao>}
      </div>

      {status === 'EMITIDA' && (
        <div role="tablist" className="inline-flex rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {([['', 'Todas', contadores.data?.EMITIDA], ['sem', 'Sem multa', contadores.data?.EMITIDA_SEM_MULTA], ['com', 'Com multa', contadores.data?.EMITIDA_COM_MULTA]] as const).map(([v, r, n]) => (
            <button key={v} role="tab" aria-selected={multa === v} type="button" onClick={() => atualizar({ multa: v })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${multa === v ? 'bg-marca-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {r} {n != null && <span className="ml-1 text-xs opacity-75">{numero(n)}</span>}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={filtrar} className="grid gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <Campo rotulo="Buscar" type="search" placeholder="P.O, NFS-e, ID do site, site ou projeto" value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={100} />
        </div>
        <Selecao rotulo="Cliente" value={operadora} onChange={(e) => setOperadora(e.target.value)}>
          <option value="">Todos</option>
          {OPERADORAS.map((o) => <option key={o}>{o}</option>)}
        </Selecao>
        <Campo rotulo="UF" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} maxLength={2} placeholder="SP" />
        <Campo rotulo="Valor mínimo (R$)" inputMode="decimal" value={valorMin} onChange={(e) => setValorMin(e.target.value)} />
        <Campo rotulo="Valor máximo (R$)" inputMode="decimal" value={valorMax} onChange={(e) => setValorMax(e.target.value)} />
        {(status === 'EMITIDA' || status === 'CANCELADO') && (
          <>
            <Campo rotulo="Emitida de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            <Campo rotulo="Emitida até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </>
        )}
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
          <Botao type="submit">Filtrar</Botao>
          {temFiltro && <Botao variante="secundario" onClick={limpar}>Limpar</Botao>}
        </div>
      </form>

      {lista.isError && <Alerta>{(lista.error as Error).message}</Alerta>}
      {lista.isLoading && <Carregando />}
      {lista.data && (
        <div className={`space-y-3 ${lista.isFetching ? 'opacity-70' : ''}`}>
          <TabelaItens itens={lista.data.itens} colunas={COLUNAS[status]} ordenarPor={ordenarPor} ordem={ordem} aoOrdenar={ordenar}
            vazio={temFiltro ? 'Nenhuma P.O com esses filtros.' : 'Nenhuma P.O neste status.'} />
          <Paginacao pagina={lista.data.pagina} porPagina={lista.data.porPagina} total={lista.data.total}
            aoMudar={(n) => { atualizar({ pagina: String(n) }); window.scrollTo({ top: 0 }); }} />
        </div>
      )}

      <Modal titulo="Adicionar P.O" aberto={adicionando} aoFechar={() => setAdicionando(false)} largura="max-w-3xl">
        <FormItem statusInicial={status} aoConcluir={() => setAdicionando(false)} aoCancelar={() => setAdicionando(false)} />
      </Modal>
    </div>
  );
}
