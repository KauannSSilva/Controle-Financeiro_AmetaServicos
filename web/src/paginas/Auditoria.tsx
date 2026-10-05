import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FormEvent, Fragment, useState } from 'react';
import { api } from '../api';
import { Alerta, Botao, Campo, Carregando, Paginacao, Selecao } from '../componentes/ui';
import { quando } from '../formato';
import { RegistroAuditoria } from '../tipos';

const ACOES: Record<string, string> = {
  LOGIN_SUCESSO: 'Entrou',
  LOGIN_SENHA_OK: 'Senha correta (falta o código)',
  LOGIN_FALHOU: 'Tentativa de login falhou',
  LOGOUT: 'Saiu',
  MFA_ATIVADO: 'Cadastrou o autenticador',
  MFA_RECUPERACAO_USADA: 'Usou código de recuperação',
  SENHA_ALTERADA: 'Trocou a senha',
  USUARIO_BLOQUEADO_TENTATIVAS: 'Travado por tentativas erradas',
  USUARIO_CRIADO: 'Usuário criado',
  USUARIO_EDITADO: 'Usuário editado',
  USUARIO_EXCLUIDO: 'Usuário excluído',
  USUARIO_DESBLOQUEADO: 'Usuário destravado',
  MFA_RESETADO: 'Autenticador resetado',
  SENHA_REDEFINIDA_ADMIN: 'Senha provisória definida',
  SENHA_REDEFINIDA_CLI: 'Senha redefinida pelo comando',
  ITEM_CRIADO: 'P.O adicionada',
  ITEM_EDITADO: 'P.O editada',
  STATUS_ALTERADO: 'Status alterado',
  ITEM_REMOVIDO: 'P.O removida',
  ITEM_RESTAURADO: 'P.O restaurada',
  ITEM_EXCLUIDO_DEFINITIVO: 'P.O excluída de vez',
};

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
        <Selecao rotulo="Ação" value={filtro.acao} onChange={(e) => setFiltro({ ...filtro, acao: e.target.value })}>
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
                <tr><th className="px-3 py-2.5">Quando</th><th className="px-3 py-2.5">Quem</th><th className="px-3 py-2.5">Ação</th><th className="px-3 py-2.5">IP</th><th className="px-3 py-2.5"><span className="sr-only">Detalhes</span></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consulta.data.registros.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Nenhum registro.</td></tr>}
                {consulta.data.registros.map((r) => {
                  const temDetalhe = r.valoresAntes != null || r.valoresDepois != null;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">{quando(r.criadoEm)}</td>
                        <td className="px-3 py-2">{r.usuarioNome ?? <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2">{ACOES[r.acao] ?? r.acao}</td>
                        <td className="px-3 py-2 text-slate-500">{r.ip ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right">
                          {temDetalhe && (
                            <Botao variante="fantasma" className="px-2 py-1 text-xs" aria-expanded={aberto === r.id} onClick={() => setAberto(aberto === r.id ? null : r.id)}>
                              {aberto === r.id ? 'Ocultar' : 'Detalhes'}
                            </Botao>
                          )}
                        </td>
                      </tr>
                      {aberto === r.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={5} className="px-3 py-2">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div><div className="text-xs font-semibold text-slate-500">Antes</div><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(r.valoresAntes, null, 2)}</pre></div>
                              <div><div className="text-xs font-semibold text-slate-500">Depois</div><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(r.valoresDepois, null, 2)}</pre></div>
                            </div>
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
