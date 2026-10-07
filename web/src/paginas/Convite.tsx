import { useState } from 'react';
import { useNavigate } from 'react-router';
import logo from '../../../assets/logo/logo.png';
import { api, ErroApi } from '../api';
import { Alerta, Botao } from '../componentes/ui';

/** Página aberta pelo link do e-mail de convite (/convite#TOKEN). */
export function Convite() {
  const navegar = useNavigate();
  // O token fica depois do #, que o navegador não manda para o servidor
  const [token] = useState(() => window.location.hash.slice(1));
  const [email, setEmail] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(token ? null : 'Link incompleto. Abra o botão "Aceitar convite" direto do e-mail.');
  const [ocupado, setOcupado] = useState(false);

  async function aceitar() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await api.post<{ email: string }>('auth/convite/aceitar', { token });
      setEmail(r.email);
      // Tira o token da barra de endereços e do histórico
      window.history.replaceState(null, '', '/convite');
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível aceitar o convite. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-800 to-marca-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logo} alt="Ameta Serviços Telecomunicações" className="h-24 w-auto" />
          <h1 className="mt-3 text-lg font-semibold text-marca-800">Convite para o Controle de NFS-e e P.Os</h1>
        </div>
        {email ? (
          <div className="space-y-4">
            <Alerta tipo="sucesso">Convite aceito. Agora entre com <strong>{email}</strong> e a senha provisória do e-mail.</Alerta>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Entre com o e-mail e a senha provisória.</li>
              <li>Crie a sua própria senha.</li>
              <li>Cadastre o autenticador do celular com o QR Code.</li>
            </ol>
            <Botao className="w-full" onClick={() => navegar('/', { state: { email } })}>Ir para o login</Botao>
          </div>
        ) : (
          <div className="space-y-4">
            {erro && <Alerta>{erro}</Alerta>}
            {token && (
              <>
                <p className="text-sm text-slate-600">Confirme que este e-mail é seu para liberar o acesso ao site.</p>
                <Botao className="w-full" onClick={aceitar} disabled={ocupado}>{ocupado ? 'Confirmando…' : 'Aceitar convite'}</Botao>
              </>
            )}
            {!token || erro ? <Botao variante="secundario" className="w-full" onClick={() => navegar('/')}>Ir para o login</Botao> : null}
          </div>
        )}
      </div>
    </main>
  );
}
