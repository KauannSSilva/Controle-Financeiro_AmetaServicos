import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import logo from '../../../assets/logo/logo.png';
import { api, ErroApi } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Carregando } from '../componentes/ui';
import { data } from '../formato';

interface Secao { titulo: string; paragrafos: string[] }
interface Termos { versao: string; data: string; termosDeUso: Secao[]; politicaDePrivacidade: Secao[] }

const useTermos = () => useQuery({ queryKey: ['termos'], queryFn: () => api.get<Termos>('auth/termos'), staleTime: Infinity });

function Texto({ titulo, secoes }: { titulo: string; secoes: Secao[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-marca-800">{titulo}</h2>
      {secoes.map((s) => (
        <div key={s.titulo}>
          <h3 className="font-medium text-slate-900">{s.titulo}</h3>
          {s.paragrafos.map((p) => <p key={p} className="mt-1 text-sm leading-relaxed text-slate-700">{p}</p>)}
        </div>
      ))}
    </section>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-marca-800 to-marca-900 p-4">
      <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow-2xl sm:p-8">
        <img src={logo} alt="Ameta Serviços" className="mx-auto h-20 w-auto" />
        {children}
      </div>
    </main>
  );
}

/** Página pública: /termos ou /privacidade */
export function PaginaTermos({ qual }: { qual: 'termos' | 'privacidade' }) {
  const t = useTermos();
  return (
    <Moldura>
      {t.isLoading && <Carregando />}
      {t.isError && <Alerta>{(t.error as Error).message}</Alerta>}
      {t.data && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">Versão {t.data.versao}, de {data(t.data.data)}</p>
          {qual === 'termos'
            ? <Texto titulo="Termos de Uso" secoes={t.data.termosDeUso} />
            : <Texto titulo="Política de Privacidade" secoes={t.data.politicaDePrivacidade} />}
          <div className="flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm">
            <Link to={qual === 'termos' ? '/privacidade' : '/termos'} className="text-marca-700 underline">
              {qual === 'termos' ? 'Política de Privacidade' : 'Termos de Uso'}
            </Link>
            <Link to="/" className="text-marca-700 underline">Voltar ao site</Link>
          </div>
        </div>
      )}
    </Moldura>
  );
}

/** Depois do login: obrigatório no primeiro acesso e a cada nova versão. */
export function AceitarTermos() {
  const { atualizar, sair, usuario } = useAuth();
  const t = useTermos();
  const [li, setLi] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function aceitar() {
    if (!t.data) return;
    setErro(null);
    setOcupado(true);
    try {
      await api.post('auth/termos/aceitar', { versao: t.data.versao });
      await atualizar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível registrar o aceite.');
      if (e instanceof ErroApi && e.status === 422) t.refetch();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Moldura>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Termos de Uso e Política de Privacidade</h1>
      <p className="mt-1 text-sm text-slate-600">
        Olá, {usuario?.nome}. Para usar o sistema, leia e aceite os termos abaixo. Isso é pedido no primeiro acesso e sempre que eles mudarem.
      </p>
      {t.isLoading && <Carregando />}
      {t.isError && <div className="mt-4"><Alerta>{(t.error as Error).message}</Alerta></div>}
      {t.data && (
        <>
          <div className="mt-4 max-h-[50vh] space-y-6 overflow-y-auto rounded-lg border border-slate-200 p-4" tabIndex={0} aria-label="Texto dos termos">
            <Texto titulo="Termos de Uso" secoes={t.data.termosDeUso} />
            <Texto titulo="Política de Privacidade" secoes={t.data.politicaDePrivacidade} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Versão {t.data.versao}, de {data(t.data.data)}</p>
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={li} onChange={(e) => setLi(e.target.checked)} />
            Li e aceito os Termos de Uso e a Política de Privacidade.
          </label>
          {erro && <div className="mt-3"><Alerta>{erro}</Alerta></div>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Botao variante="fantasma" onClick={sair}>Sair</Botao>
            <Botao onClick={aceitar} disabled={!li || ocupado}>{ocupado ? 'Registrando…' : 'Aceitar e continuar'}</Botao>
          </div>
        </>
      )}
    </Moldura>
  );
}
