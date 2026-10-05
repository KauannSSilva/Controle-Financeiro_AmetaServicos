import { FormEvent, useState } from 'react';
import { useLocation } from 'react-router';
import logo from '../../../assets/logo/logo.png';
import { api, ErroApi } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Campo } from '../componentes/ui';
import { Usuario } from '../tipos';

type Etapa =
  | { tipo: 'senha' }
  | { tipo: 'configurar'; chave: string; qrCode: string }
  | { tipo: 'verificar' }
  | { tipo: 'codigos'; usuario: Usuario; codigos: string[] };

const msg = (e: unknown) => (e instanceof ErroApi ? e.message : 'Não foi possível falar com o servidor. A API está rodando?');

export function Login() {
  const { entrou, aviso } = useAuth();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'senha' });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const local = useLocation();
  // Vindo da página do convite, o e-mail já aparece preenchido
  const [email, setEmail] = useState<string>((local.state as { email?: string } | null)?.email ?? '');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const [guardou, setGuardou] = useState(false);

  async function executar(fn: () => Promise<void>) {
    setErro(null);
    setOcupado(true);
    try {
      await fn();
    } catch (e) {
      setErro(msg(e));
      // O passo do MFA dura 5 minutos; depois disso volta para a senha
      if (e instanceof ErroApi && e.status === 401 && etapa.tipo !== 'senha' && /sessão|login/i.test(e.message)) setEtapa({ tipo: 'senha' });
    } finally {
      setOcupado(false);
    }
  }

  const enviarSenha = (e: FormEvent) => {
    e.preventDefault();
    executar(async () => {
      const r = await api.post<{ proximaEtapa: 'MFA_CONFIGURAR' | 'MFA_VERIFICAR' }>('auth/login', { email, senha });
      setSenha('');
      setCodigo('');
      if (r.proximaEtapa === 'MFA_CONFIGURAR') {
        const c = await api.post<{ chave: string; qrCode: string }>('auth/mfa/configurar');
        setEtapa({ tipo: 'configurar', chave: c.chave, qrCode: c.qrCode });
      } else {
        setEtapa({ tipo: 'verificar' });
      }
    });
  };

  const ativar = (e: FormEvent) => {
    e.preventDefault();
    executar(async () => {
      const r = await api.post<{ usuario: Usuario; codigosRecuperacao: string[] }>('auth/mfa/ativar', { codigo: codigo.trim() });
      setEtapa({ tipo: 'codigos', usuario: r.usuario, codigos: r.codigosRecuperacao });
    });
  };

  const verificar = (e: FormEvent) => {
    e.preventDefault();
    executar(async () => {
      const corpo = usarRecuperacao ? { codigoRecuperacao: codigo.trim() } : { codigo: codigo.trim() };
      const r = await api.post<{ usuario: Usuario; codigosRecuperacaoRestantes: number }>('auth/mfa/verificar', corpo);
      entrou(r.usuario);
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-800 to-marca-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logo} alt="Ameta Serviços Telecomunicações" className="h-24 w-auto" />
          <h1 className="mt-3 text-lg font-semibold text-marca-800">Controle de NFS-e e P.Os</h1>
        </div>

        {aviso && etapa.tipo === 'senha' && <div className="mb-4"><Alerta tipo="info">{aviso}</Alerta></div>}
        {erro && <div className="mb-4"><Alerta>{erro}</Alerta></div>}

        {etapa.tipo === 'senha' && (
          <form onSubmit={enviarSenha} className="space-y-4">
            <Campo rotulo="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} obrigatorio autoFocus />
            <Campo rotulo="Senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} obrigatorio />
            <Botao type="submit" className="w-full" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</Botao>
            <p className="text-center text-xs text-slate-500">Esqueceu a senha ou perdeu o celular? Fale com o administrador.</p>
          </form>
        )}

        {etapa.tipo === 'configurar' && (
          <form onSubmit={ativar} className="space-y-4">
            <div className="text-sm text-slate-700">
              <p className="font-medium text-slate-900">Primeiro acesso: cadastre o autenticador</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Abra o Google Authenticator ou o Microsoft Authenticator no celular.</li>
                <li>Toque em <b>+</b> e escaneie o QR Code abaixo.</li>
                <li>Digite o código de 6 dígitos que aparecer no app.</li>
              </ol>
            </div>
            <img src={etapa.qrCode} alt="QR Code para o app autenticador" className="mx-auto h-56 w-56" />
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Não consegue escanear? Digite a chave</summary>
              <code className="mt-1 block break-all rounded bg-slate-100 p-2 font-mono text-slate-800">{etapa.chave}</code>
            </details>
            <Campo rotulo="Código do app" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} obrigatorio autoFocus />
            <Botao type="submit" className="w-full" disabled={ocupado || codigo.length !== 6}>{ocupado ? 'Conferindo…' : 'Confirmar'}</Botao>
            <Botao variante="fantasma" className="w-full" onClick={() => { setEtapa({ tipo: 'senha' }); setErro(null); }}>Voltar</Botao>
          </form>
        )}

        {etapa.tipo === 'verificar' && (
          <form onSubmit={verificar} className="space-y-4">
            {usarRecuperacao ? (
              <Campo rotulo="Código de recuperação" ajuda="Um dos 10 códigos que você guardou no primeiro acesso. Cada um vale uma vez."
                placeholder="XXXXX-XXXXX" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} obrigatorio autoFocus />
            ) : (
              <Campo rotulo="Código do app autenticador" ajuda="Abra o app no celular e digite os 6 dígitos de Ameta Serviços."
                inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
                value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} obrigatorio autoFocus />
            )}
            <Botao type="submit" className="w-full" disabled={ocupado || (!usarRecuperacao && codigo.length !== 6)}>{ocupado ? 'Conferindo…' : 'Entrar'}</Botao>
            <Botao variante="fantasma" className="w-full" onClick={() => { setUsarRecuperacao(!usarRecuperacao); setCodigo(''); setErro(null); }}>
              {usarRecuperacao ? 'Usar o código do app' : 'Perdi o celular: usar código de recuperação'}
            </Botao>
          </form>
        )}

        {etapa.tipo === 'codigos' && (
          <div className="space-y-4">
            <Alerta tipo="sucesso">Autenticador cadastrado.</Alerta>
            <div className="text-sm text-slate-700">
              <p className="font-medium text-slate-900">Guarde os seus códigos de recuperação</p>
              <p className="mt-1">Se perder o celular, cada código permite entrar uma vez. Eles aparecem <b>só agora</b>: anote ou imprima e guarde em lugar seguro.</p>
            </div>
            <ul className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-3 font-mono text-sm">
              {etapa.codigos.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <div className="flex gap-2">
              <Botao variante="secundario" className="flex-1" onClick={() => navigator.clipboard?.writeText(etapa.codigos.join('\n'))}>Copiar</Botao>
              <Botao variante="secundario" className="flex-1" onClick={() => window.print()}>Imprimir</Botao>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={guardou} onChange={(e) => setGuardou(e.target.checked)} className="h-4 w-4" />
              Já guardei os códigos
            </label>
            <Botao className="w-full" disabled={!guardou} onClick={() => entrou(etapa.usuario)}>Continuar</Botao>
          </div>
        )}
      </div>
    </main>
  );
}
