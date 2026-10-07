import { FormEvent, useState } from 'react';
import { api, ErroApi } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Campo } from './ui';

/** Troca da própria senha. Depois de trocar, as outras sessões do usuário são encerradas. */
export function FormSenha({ aoConcluir, aoCancelar }: { aoConcluir: () => void; aoCancelar?: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [codigo, setCodigo] = useState('');
  // Na troca da senha provisória o código acabou de ser usado no login; nas outras, pede de novo
  const pedirCodigo = !useAuth().usuario?.deveTrocarSenha;
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova !== repetir) return setErro('A nova senha e a confirmação estão diferentes.');
    setOcupado(true);
    try {
      await api.post('auth/trocar-senha', { senhaAtual: atual, novaSenha: nova, codigo: pedirCodigo ? codigo : undefined });
      aoConcluir();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível trocar a senha.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo rotulo="Senha atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} obrigatorio />
      <Campo rotulo="Nova senha" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} obrigatorio
        minLength={12} maxLength={128} ajuda="Pelo menos 12 caracteres. Uma frase fácil de lembrar funciona bem. Senhas comuns são recusadas." />
      <Campo rotulo="Repita a nova senha" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} obrigatorio />
      {pedirCodigo && (
        <Campo rotulo="Código do app autenticador" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
          ajuda="Os 6 dígitos de Ameta Serviços no app do celular." value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} obrigatorio />
      )}
      {erro && <Alerta>{erro}</Alerta>}
      <div className="flex justify-end gap-2">
        {aoCancelar && <Botao variante="secundario" onClick={aoCancelar}>Cancelar</Botao>}
        <Botao type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Trocar senha'}</Botao>
      </div>
    </form>
  );
}
