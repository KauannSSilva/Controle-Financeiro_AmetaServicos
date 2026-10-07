import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FormEvent, Fragment, useState } from 'react';
import { api } from '../api';
import { Alerta, Botao, Campo, Carregando, Paginacao, Selecao } from '../componentes/ui';
import { quando } from '../formato';
import { ACOES, frase, mudancas } from '../auditoria';
import { RegistroAuditoria } from '../tipos';

const POR_PAGINA = 50;

export function Auditoria() {
  const [filtro, setFiltro] = useState({ acao: '', de: '', ate: '' });
  const [aplicado, setAplicado] = useState(filtro);
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<string | null>(null);
  const consulta = useQuery({
    queryKey: ['auditoria', aplicado, pagina],
    queryFn: () => api.get<{ total: number; pagina: number; porPagina: number; registros: RegistroAuditoria[] }>('auditoria', { ...aplicado, pagina, porPagina: POR_PAGINA }),
    placeholderData: keepPreviousData,
  });

  const filtrar = (e: FormEvent) => { e.preventDefault(); setAplicado(filtro); setPagina(1); };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Auditoria</h1>
      <form onSubmit={filtrar} className="grid gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-4">
        <Selecao rotulo="Tipo de ação" value={filtro.acao} onChange={(e) => setFiltro({ ...filtro, acao: e.target.value })}>
          <option value="">Todas</option>
          {Object.entries(ACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selecao>
        <Campo rotulo="De" type="date" value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.target.value })} />
        <Campo rotulo="Até" type="date" value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })} />
        <div className="flex items-end"><Botao type="submit">Filtrar</Botao></div>
      </form>

      {consulta.isLoading && <Carregando />}
      {consulta.isError && <Alerta>{(consulta.error as Error).message}</Alerta>}
      {consulta.data && (
        <div className="space-y-3">
          <div className="relative overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr><th className="px-3 py-2.5">Quando</th><th className="px-3 py-2.5">Quem</th><th className="px-3 py-2.5">O que aconteceu</th><th className="px-3 py-2.5"><span className="sr-only">Detalhes</span></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consulta.data.registros.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">Nenhum registro.</td></tr>}
                {consulta.data.registros.map((r) => {
                  const lista = mudancas(r);
                  const falhou = r.acao === 'LOGIN_FALHOU' || r.acao === 'CONVITE_NAO_ENVIADO' || r.acao === 'USUARIO_BLOQUEADO_TENTATIVAS';
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums text-slate-600">{quando(r.criadoEm)}</td>
                        <td className="px-3 py-2 align-top font-medium text-slate-900">{r.usuarioNome ?? <span className="font-normal text-slate-500">{r.acao === 'LOGIN_FALHOU' ? 'Desconhecido' : 'Sistema'}</span>}</td>
                        <td className={`px-3 py-2 align-top ${falhou ? 'text-red-700' : ''}`}>{frase(r)}</td>
                        <td className="px-3 py-1.5 text-right align-top">
                          <Botao variante="fantasma" className="whitespace-nowrap px-2 py-1 text-xs" aria-expanded={aberto === r.id} onClick={() => setAberto(aberto === r.id ? null : r.id)}>
                            {aberto === r.id ? 'Ocultar' : lista.length ? 'Ver mudanças' : 'Detalhes'}
                          </Botao>
                        </td>
                      </tr>
                      {aberto === r.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={4} className="px-3 py-3">
                            {lista.length > 0 && (
                              <table className="mb-2 text-sm">
                                <thead className="text-left text-xs text-slate-500"><tr><th className="pr-6 font-semibold">Campo</th><th className="pr-6 font-semibold">Antes</th><th className="font-semibold">Depois</th></tr></thead>
                                <tbody>
                                  {lista.map((m) => (
                                    <tr key={m.campo}>
                                      <td className="pr-6 text-slate-600">{m.campo}</td>
                                      <td className="pr-6 text-slate-500 line-through decoration-slate-300">{m.antes}</td>
                                      <td className="font-medium text-slate-900">{m.depois}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <p className="text-xs text-slate-500">
                              {ACOES[r.acao] ?? r.acao} · {quando(r.criadoEm)}{r.ip ? ` · computador (IP) ${r.ip}` : ''}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={consulta.data.total} aoMudar={setPagina} />
        </div>
      )}
    </div>
  );
}
