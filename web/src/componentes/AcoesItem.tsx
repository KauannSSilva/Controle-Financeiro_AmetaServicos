import { useState } from 'react';
import { api, ErroApi } from '../api';
import { useAuth } from '../auth';
import { useRecarregarPos } from '../consultas';
import { Item } from '../tipos';
import { FormItem } from './FormItem';
import { MoverStatus } from './MoverStatus';
import { Botao, Confirmar, Modal, useAvisos } from './ui';

/** Botões Editar, Mover para… e Remover de um item (só para ADMIN e OPERADOR). */
export function AcoesItem({ item, compacto }: { item: Item; compacto?: boolean }) {
  const { pode } = useAuth();
  const [acao, setAcao] = useState<'editar' | 'mover' | 'remover' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = useRecarregarPos();
  const avisar = useAvisos();
  if (!pode('ADMIN', 'OPERADOR')) return null;

  const fechar = () => { setAcao(null); setErro(null); };
  async function remover() {
    setOcupado(true);
    try {
      await api.delete(`itens/${item.id}?versao=${encodeURIComponent(item.atualizadoEm)}`);
      avisar('sucesso', `P.O ${item.numeroPo}${item.item ? ` item ${item.item}` : ''} removida.`);
      fechar();
      recarregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível remover.');
      if (e instanceof ErroApi && e.status === 409) recarregar();
    } finally {
      setOcupado(false);
    }
  }

  const tam = compacto ? 'px-2 py-1 text-xs' : '';
  return (
    <div className={`flex gap-1 ${compacto ? "flex-nowrap" : "flex-wrap"}`} onClick={(e) => e.stopPropagation()}>
      <Botao variante="secundario" className={tam} onClick={() => setAcao('mover')}>Mover para…</Botao>
      <Botao variante="secundario" className={tam} onClick={() => setAcao('editar')}>Editar</Botao>
      <Botao variante="fantasma" className={`${tam} text-red-700 hover:bg-red-50`} onClick={() => setAcao('remover')}>Remover</Botao>

      <Modal titulo={`Editar P.O ${item.numeroPo}${item.item ? ` · item ${item.item}` : ''}`} aberto={acao === 'editar'} aoFechar={fechar} largura="max-w-3xl">
        <FormItem item={item} aoConcluir={fechar} aoCancelar={fechar} />
      </Modal>
      <Modal titulo={`Mover P.O ${item.numeroPo}${item.item ? ` · item ${item.item}` : ''}`} aberto={acao === 'mover'} aoFechar={fechar}>
        <MoverStatus item={item} aoConcluir={fechar} aoCancelar={fechar} />
      </Modal>
      <Confirmar
        aberto={acao === 'remover'}
        titulo="Remover da lista?"
        mensagem={<>A P.O <b>{item.numeroPo}</b>{item.item && <> item <b>{item.item}</b></>} sai das listas. Ela continua guardada e um administrador pode restaurar depois.</>}
        rotulo="Remover"
        perigo
        ocupado={ocupado}
        erro={erro}
        aoConfirmar={remover}
        aoFechar={fechar}
      />
    </div>
  );
}
