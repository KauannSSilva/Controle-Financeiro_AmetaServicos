import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import logo from '../../../assets/logo/logo.png';
import { api } from '../api';
import { useAuth } from '../auth';
import { numero } from '../formato';
import { Contadores, ROTULO_PERFIL, STATUS } from '../tipos';
import { ConfirmarIdentidade } from './ConfirmarIdentidade';
import { FormSenha } from './FormSenha';
import { Botao, Modal, useAvisos } from './ui';

function ItemMenu({ para, rotulo, contador, aoClicar }: { para: string; rotulo: string; contador?: number; aoClicar: () => void }) {
  return (
    <NavLink
      to={para}
      end={para === '/'}
      onClick={aoClicar}
      className={({ isActive }) =>
        `flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-white/15 text-white' : 'text-marca-100 hover:bg-white/10 hover:text-white'
        }`}
    >
      <span>{rotulo}</span>
      {contador != null && (
        <span className="min-w-8 rounded-full bg-white/15 px-2 py-0.5 text-center text-xs tabular-nums">{numero(contador)}</span>
      )}
    </NavLink>
  );
}

export function Layout() {
  const { usuario, sair, pode } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const avisar = useAvisos();
  const local = useLocation();
  const contadores = useQuery({ queryKey: ['contadores'], queryFn: () => api.get<Contadores>('contadores') });
  const fechar = () => setMenuAberto(false);

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Menu lateral fixo (no celular abre pelo botão ☰) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-marca-800 transition-transform lg:translate-x-0 ${menuAberto ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Menu principal"
      >
        <div className="m-3 rounded-lg bg-white p-3">
          <img src={logo} alt="Ameta Serviços Telecomunicações" className="mx-auto h-20 w-auto" />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <ItemMenu para="/" rotulo="Início" aoClicar={fechar} />
          {STATUS.map((s) => (
            <ItemMenu key={s.valor} para={s.caminho} rotulo={s.rotulo} contador={contadores.data?.[s.valor]} aoClicar={fechar} />
          ))}
          {pode('ADMIN') && (
            <>
              <div className="mx-3 my-3 border-t border-white/15" />
              <ItemMenu para="/usuarios" rotulo="Usuários" aoClicar={fechar} />
              <ItemMenu para="/auditoria" rotulo="Auditoria" aoClicar={fechar} />
              <ItemMenu para="/removidos" rotulo="Removidos" aoClicar={fechar} />
            </>
          )}
        </nav>
      </aside>
      {menuAberto && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={fechar} aria-hidden />}

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button type="button" className="rounded p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">☰</button>
        <div className="flex-1" />
        <div className="text-right text-sm leading-tight">
          <div className="font-medium text-slate-900">{usuario?.nome}</div>
          <div className="text-xs text-slate-500">{usuario && ROTULO_PERFIL[usuario.perfil]}</div>
        </div>
        <Botao variante="fantasma" className="hidden sm:inline-flex" onClick={() => setTrocandoSenha(true)}>Trocar senha</Botao>
        <Botao variante="secundario" onClick={sair}>Sair</Botao>
      </header>

      <main key={local.pathname} className="mx-auto max-w-[1400px] p-4 lg:p-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-[1400px] px-4 pb-6 text-xs text-slate-500 lg:px-6">
        <a href="/termos" className="underline hover:text-marca-700">Termos de Uso</a>
        {' · '}
        <a href="/privacidade" className="underline hover:text-marca-700">Política de Privacidade</a>
      </footer>

      <Modal titulo="Trocar senha" aberto={trocandoSenha} aoFechar={() => setTrocandoSenha(false)}>
        <FormSenha
          aoCancelar={() => setTrocandoSenha(false)}
          aoConcluir={() => { setTrocandoSenha(false); avisar('sucesso', 'Senha trocada. Use a nova senha no próximo acesso.'); }}
        />
      </Modal>
      <ConfirmarIdentidade />
    </div>
  );
}
