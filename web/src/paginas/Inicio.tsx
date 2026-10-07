import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { TabelaItens } from '../componentes/TabelaItens';
import { Alerta, Carregando } from '../componentes/ui';
import { numero } from '../formato';
import { Contadores, Item, STATUS } from '../tipos';

interface Resumo { ultimasEmitidas: Item[]; emitirNota: { total: number; ultimas: Item[] } }

export function Inicio() {
  const resumo = useQuery({ queryKey: ['inicio'], queryFn: () => api.get<Resumo>('inicio') });
  const contadores = useQuery({ queryKey: ['contadores'], queryFn: () => api.get<Contadores>('contadores') });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Início</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUS.map((s) => (
          <Link key={s.valor} to={s.caminho} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-teal-marca">
            <div className="text-xs font-medium text-slate-500">{s.rotulo}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-marca-800">{numero(contadores.data?.[s.valor]) || '—'}</div>
            {s.valor === 'EMITIDA' && contadores.data && (
              <div className="mt-1 text-xs text-slate-500">{numero(contadores.data.EMITIDA_COM_MULTA)} com multa</div>
            )}
          </Link>
        ))}
      </div>

      {resumo.isError && <Alerta>Não foi possível carregar a tela inicial. {String((resumo.error as Error).message)}</Alerta>}
      {resumo.isLoading && <Carregando />}
      {resumo.data && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="flex items-center gap-4 rounded-lg bg-marca-800 px-5 py-3 text-white">
                <div>
                  <div className="text-xs uppercase tracking-wide text-marca-100">P.Os a emitir</div>
                  <div className="text-3xl font-semibold tabular-nums">{numero(resumo.data.emitirNota.total)}</div>
                </div>
              </div>
              <Link to="/emitir-nota" className="text-sm font-medium text-marca-700 hover:underline">Ver todas →</Link>
            </div>
            <h2 className="text-base font-semibold text-slate-800">Últimas 10 em Emitir Nota</h2>
            <TabelaItens itens={resumo.data.emitirNota.ultimas} colunas={['po', 'item', 'site', 'operadora', 'valor']} vazio="Nenhuma P.O em Emitir Nota." />
          </section>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-800">Últimas 10 emitidas</h2>
              <Link to="/emitidas" className="text-sm font-medium text-marca-700 hover:underline">Ver todas →</Link>
            </div>
            <TabelaItens itens={resumo.data.ultimasEmitidas} colunas={['po', 'item', 'site', 'operadora', 'nfse', 'emissao', 'valor', 'multa']} acoes={false} />
          </section>
        </>
      )}
    </div>
  );
}
