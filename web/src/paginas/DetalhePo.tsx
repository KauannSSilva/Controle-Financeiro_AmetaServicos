import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ErroApi } from '../api';
import { useAuth } from '../auth';
import { useRecarregarPos } from '../consultas';
import { AcoesItem } from '../componentes/AcoesItem';
import { Alerta, Botao, Carregando, Confirmar, SeloStatus, useAvisos } from '../componentes/ui';
import { data, quando, reais } from '../formato';
import { DetalhePo as Detalhe, Item } from '../tipos';

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="text-sm text-slate-900">{children || '—'}</dd>
    </div>
  );
}

function CartaoItem({ item }: { item: Detalhe['itens'][number] }) {
  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-slate-900">Item {item.item ?? '(sem número)'}</h2>
          <SeloStatus status={item.status} rotulo={item.rotuloStatus} multa={item.status === 'EMITIDA' && item.possuiMulta} />
          <span className="text-xs text-slate-500">Status financeiro: <b>{item.statusFinanceiro}</b></span>
        </div>
        <AcoesItem item={item as Item} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 md:grid-cols-4">
        <Info rotulo="ID do site">{item.idSite}</Info>
        <Info rotulo="Site">{item.site}</Info>
        <Info rotulo="Fase">{item.fase}</Info>
        <Info rotulo="Tecnologia">{item.tecnologia}</Info>
        <Info rotulo="Projeto">{item.projeto}</Info>
        <Info rotulo="Cliente">{item.operadora}</Info>
        <Info rotulo="UF">{item.uf}</Info>
        <Info rotulo="Número MIGO">{item.numeroMigo}</Info>
        <Info rotulo="Preço original">{reais(item.valorOriginal)}</Info>
        <Info rotulo="Multa">{item.possuiMulta ? `Sim, recebe ${item.percentualMulta ? Number(item.percentualMulta) : '?'}% (${reais(item.valorMulta)} de multa)` : 'Não'}</Info>
        <Info rotulo="Valor final">{reais(item.valorFinal)}</Info>
        <Info rotulo="NFS-e">{item.numeroNfse}</Info>
        <Info rotulo="Data de emissão">{item.dataEmissao ? data(item.dataEmissao) : null}</Info>
        <Info rotulo="Última alteração">{quando(item.atualizadoEm)}</Info>
        {item.statusOrigem && <Info rotulo="Status na planilha">{item.statusOrigem}</Info>}
        {item.observacoes && (
          <div className="col-span-2 md:col-span-4">
            <Info rotulo="Observações"><span className="whitespace-pre-wrap">{item.observacoes}</span></Info>
          </div>
        )}
      </dl>
      <div className="border-t border-slate-100 px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Histórico de status</h3>
        {item.historico.length === 0 ? <p className="text-sm text-slate-500">Sem registros.</p> : (
          <ol className="space-y-2">
            {[...item.historico].reverse().map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="tabular-nums text-slate-500">{quando(h.criadoEm)}</span>
                <span className="text-slate-800">
                  {h.rotuloDe ? <>{h.rotuloDe} → <b>{h.rotuloPara}</b></> : <>Criada em <b>{h.rotuloPara}</b></>}
                  {h.statusPara === 'EMITIDA' && h.possuiMulta && ' (com multa)'}
                </span>
                <span className="text-slate-500">por {h.usuarioNome ?? 'importação da planilha'}</span>
                {h.motivo && <span className="text-slate-600">· “{h.motivo}”</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function DetalhePo() {
  const { numeroPo = '' } = useParams();
  const { pode } = useAuth();
  const navegar = useNavigate();
  const recarregar = useRecarregarPos();
  const avisar = useAvisos();
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const po = useQuery({ queryKey: ['po', numeroPo], queryFn: () => api.get<Detalhe>(`ordens/${encodeURIComponent(numeroPo)}`), retry: false });

  async function removerPo() {
    setOcupado(true);
    try {
      await api.delete(`ordens/${encodeURIComponent(numeroPo)}`);
      avisar('sucesso', `P.O ${numeroPo} removida.`);
      recarregar();
      navegar(-1);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível remover.');
    } finally {
      setOcupado(false);
    }
  }

  const ativos = po.data?.itens.filter((i) => !i.excluidoEm) ?? [];
  const total = ativos.reduce((s, i) => s + Number(i.valorOriginal ?? 0), 0);

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navegar(-1)} className="text-sm text-marca-700 hover:underline">← Voltar</button>
      {po.isLoading && <Carregando />}
      {po.isError && <Alerta>{(po.error as ErroApi).status === 404 ? `P.O ${numeroPo} não encontrada.` : (po.error as Error).message}</Alerta>}
      {po.data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">P.O {po.data.numeroPo}</h1>
              <p className="text-sm text-slate-500">
                {ativos.length} {ativos.length === 1 ? 'item' : 'itens'}{ativos.length > 1 && ' · PROJETO TX'} · total {reais(total)}
              </p>
            </div>
            {pode('ADMIN', 'OPERADOR') && ativos.length > 1 && (
              <Botao variante="fantasma" className="text-red-700 hover:bg-red-50" onClick={() => setRemovendo(true)}>Remover a P.O inteira</Botao>
            )}
          </div>
          {ativos.length === 0 && <Alerta tipo="info">Todos os itens desta P.O foram removidos. Um administrador pode restaurar em <Link className="underline" to="/removidos">Removidos</Link>.</Alerta>}
          {ativos.map((i) => <CartaoItem key={i.id} item={i} />)}
        </>
      )}
      <Confirmar aberto={removendo} titulo="Remover a P.O inteira?" perigo rotulo="Remover" ocupado={ocupado} erro={erro}
        mensagem={<>Todos os itens da P.O <b>{numeroPo}</b> saem das listas. Um administrador pode restaurar depois.</>}
        aoConfirmar={removerPo} aoFechar={() => { setRemovendo(false); setErro(null); }} />
    </div>
  );
}
