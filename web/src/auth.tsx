import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, definirAoExpirar, ErroApi } from './api';
import { Perfil, Usuario } from './tipos';

interface EstadoAuth {
  usuario: Usuario | null;
  carregando: boolean;
  /** Mensagem mostrada na tela de login (ex.: sessão expirada) */
  aviso: string | null;
  entrou: (u: Usuario) => void;
  atualizar: () => Promise<void>;
  sair: () => Promise<void>;
  pode: (...perfis: Perfil[]) => boolean;
}

const Contexto = createContext<EstadoAuth | null>(null);

async function buscarEu(): Promise<Usuario | null> {
  try {
    return await api.get<Usuario>('auth/eu');
  } catch (e) {
    if (!(e instanceof ErroApi) || e.status !== 401) throw e;
  }
  // Token de acesso vencido: tenta renovar com o refresh token
  if (!(await api.renovar())) return null;
  return api.get<Usuario>('auth/eu').catch(() => null);
}

export function ProvedorAuth({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const qc = useQueryClient();

  const atualizar = useCallback(async () => {
    setUsuario(await buscarEu().catch(() => null));
  }, []);

  useEffect(() => {
    buscarEu().catch(() => null).then((u) => { setUsuario(u); setCarregando(false); });
    definirAoExpirar(() => {
      setUsuario(null);
      setAviso('Sua sessão expirou. Entre de novo.');
      qc.clear();
    });
  }, [qc]);

  const entrou = useCallback((u: Usuario) => { setAviso(null); setUsuario(u); }, []);

  const sair = useCallback(async () => {
    await api.post('auth/sair').catch(() => undefined);
    setUsuario(null);
    setAviso(null);
    qc.clear();
  }, [qc]);

  const pode = useCallback((...perfis: Perfil[]) => !!usuario && perfis.includes(usuario.perfil), [usuario]);

  return <Contexto.Provider value={{ usuario, carregando, aviso, entrou, atualizar, sair, pode }}>{children}</Contexto.Provider>;
}

export function useAuth() {
  const c = useContext(Contexto);
  if (!c) throw new Error('useAuth fora do ProvedorAuth');
  return c;
}
