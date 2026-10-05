import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErroApi } from '../api';
import { useRecarregarPos } from '../consultas';
import { TabelaItens } from '../componentes/TabelaItens';
import { Alerta, Botao, Carregando, Confirmar, Paginacao, useAvisos } from '../componentes/ui';
import { Item, Pagina } from '../tipos';

const POR_PAGINA = 50;

/** Itens removidos: só ADMIN restaura ou exclui de vez. */
export function Removidos() {
  const [pagina, setPagina] = useState(1);
  const [acao, setAcao] = useState<{ tipo: 'restaurar' | 'excluir'; item: Item } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = useRecarregarPos();
  const avisar = useAvisos();
  const lista = useQuery({
    queryKey: ['removidos', pagina],
    queryFn: () => api.get<Pagina<Item>>('itens/removidos', { pagina, porPagina: POR_PAGINA }),
    placeholderData: keepPreviousData,
  });

  const fechar = () => { setAcao(null); setErro(null); };
  async function executar() {
    if (!acao) return;
    setOcupado(true);
    try {
      if (acao.tipo === 'restaurar') await api.post(`itens/${acao.item.id}/restaurar`);
      else await api.delete(`itens/${acao.item.id}/definitivo`);
      avisar('sucesso', `P.O ${acao.item.numeroPo} ${acao.tipo === 'restaurar' ? 'restaurada' : 'excluída de vez'}.`);
      fechar();
      recarregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Removidos</h1>
        <p className="text-sm text-slate-500">P.Os tiradas das listas. Restaure para voltar ao status em que estavam.</p>
      </div>
      {lista.isLoading && <Carregando />}
      {lista.isError && <Alerta>{(lista.error as Error).message}</Alerta>}
      {lista.data && (
        <div className="space-y-3">
          <TabelaItens itens={lista.data.itens} colunas={['po', 'item', 'site', 'operadora', 'status', 'valor']} vazio="Nenhum item removido."
            extra={(i) => (
              <div className="flex gap-1">
                <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => setAcao({ tipo: 'restaurar', item: i })}>Restaurar</Botao>
                <Botao variante="fantasma" className="px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => setAcao({ tipo: 'excluir', item: i })}>Excluir de vez</Botao>
              </div>
            )} />
          <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={lista.data.total} aoMudar={setPagina} />
        </div>
      )}
      <Confirmar
        aberto={!!acao}
        titulo={acao?.tipo === 'excluir' ? 'Excluir de vez?' : 'Restaurar?'}
        mensagem={acao?.tipo === 'excluir'
          ? <>A P.O <b>{acao.item.numeroPo}</b> e o histórico dela são apagados e <b>não dá para desfazer</b>. A auditoria guarda uma cópia.</>
          : <>A P.O <b>{acao?.item.numeroPo}</b> volta para a lista de {acao?.item.rotuloStatus}.</>}
        rotulo={acao?.tipo === 'excluir' ? 'Excluir de vez' : 'Restaurar'}
        perigo={acao?.tipo === 'excluir'}
        ocupado={ocupado}
        erro={erro}
        aoConfirmar={executar}
        aoFechar={fechar}
      />
    </div>
  );
}
