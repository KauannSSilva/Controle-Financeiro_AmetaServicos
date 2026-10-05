import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ErroApi } from './api';
import { ProvedorAuth, useAuth } from './auth';
import { Layout } from './componentes/Layout';
import { Carregando, ProvedorAvisos } from './componentes/ui';
import './index.css';
import { Auditoria } from './paginas/Auditoria';
import { DetalhePo } from './paginas/DetalhePo';
import { Inicio } from './paginas/Inicio';
import { ListaStatus } from './paginas/ListaStatus';
import { Login } from './paginas/Login';
import { Removidos } from './paginas/Removidos';
import { TrocarSenhaObrigatoria } from './paginas/TrocarSenhaObrigatoria';
import { Usuarios } from './paginas/Usuarios';
import { STATUS } from './tipos';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Erros de permissão ou de dados não melhoram tentando de novo
      retry: (n, e) => n < 2 && !(e instanceof ErroApi && e.status < 500),
    },
  },
});

function App() {
  const { usuario, carregando, pode } = useAuth();
  if (carregando) return <Carregando />;
  if (!usuario) return <Login />;
  if (usuario.deveTrocarSenha) return <TrocarSenhaObrigatoria />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        {STATUS.map((s) => <Route key={s.valor} path={s.caminho.slice(1)} element={<ListaStatus status={s.valor} />} />)}
        <Route path="po/:numeroPo" element={<DetalhePo />} />
        {pode('ADMIN') && (
          <>
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="auditoria" element={<Auditoria />} />
            <Route path="removidos" element={<Removidos />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ProvedorAvisos>
          <ProvedorAuth>
            <App />
          </ProvedorAuth>
        </ProvedorAvisos>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
