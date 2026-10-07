import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, definirAoPedirConfirmacao, ErroApi } from '../api';
import { Alerta, Botao, Campo, Modal } from './ui';

/**
 * Janela que aparece quando o ADMIN faz uma ação sensível (mexer em usuários, restaurar ou excluir de vez):
 * pede a senha e o código do app. Confirmando, a ação continua sozinha e as próximas ficam liberadas por 5 minutos.
 */
export function ConfirmarIdentidade() {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    definirAoPedirConfirmacao(() => new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setSenha(''); setCodigo(''); setErro(null); setAberto(true);
    }));
    return () => definirAoPedirConfirmacao(async () => false);
  }, []);

  function fechar(ok: boolean) {
    setAberto(false);
    setSenha(''); setCodigo('');
    resolver.current?.(ok);
    resolver.current = null;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api.post('auth/confirmar-identidade', { senha, codigo });
      fechar(true);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível confirmar.');
      setCodigo('');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal titulo="Confirme que é você" aberto={aberto} aoFechar={() => fechar(false)}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-slate-600">
          Esta ação é sensível. Digite sua senha e o código do app autenticador. Depois disso, as próximas ações ficam liberadas por 5 minutos.
        </p>
        <Campo rotulo="Sua senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} obrigatorio autoFocus />
        <Campo rotulo="Código do app autenticador" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
          value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} obrigatorio />
        {erro && <Alerta>{erro}</Alerta>}
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => fechar(false)}>Cancelar</Botao>
          <Botao type="submit" disabled={ocupado || codigo.length !== 6}>{ocupado ? 'Conferindo…' : 'Confirmar'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
