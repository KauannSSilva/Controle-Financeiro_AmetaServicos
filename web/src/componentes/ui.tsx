import { ButtonHTMLAttributes, createContext, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Status } from '../tipos';

const estilosBotao = {
  primario: 'bg-marca-800 text-white hover:bg-marca-700 disabled:bg-marca-800/50',
  secundario: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  perigo: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  fantasma: 'text-marca-700 hover:bg-marca-50 disabled:text-slate-400',
};

export function Botao({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: keyof typeof estilosBotao }) {
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${estilosBotao[variante]} ${className}`}
    />
  );
}

const estiloCampo = 'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-teal-marca focus:outline-none disabled:bg-slate-100 disabled:text-slate-500';

interface PropsRotulo { rotulo: string; ajuda?: ReactNode; erro?: string | null; obrigatorio?: boolean }

function Rotulo({ id, rotulo, obrigatorio }: { id: string; rotulo: string; obrigatorio?: boolean }) {
  return (
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
      {rotulo}{obrigatorio && <span className="text-red-600" aria-hidden> *</span>}
    </label>
  );
}

function Rodape({ ajuda, erro }: { ajuda?: ReactNode; erro?: string | null }) {
  if (erro) return <p className="mt-1 text-xs text-red-600">{erro}</p>;
  return ajuda ? <p className="mt-1 text-xs text-slate-500">{ajuda}</p> : null;
}

export function Campo({ rotulo, ajuda, erro, obrigatorio, ...p }: PropsRotulo & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <Rotulo id={id} rotulo={rotulo} obrigatorio={obrigatorio} />
      <input id={id} required={obrigatorio} aria-invalid={!!erro} {...p} className={estiloCampo} />
      <Rodape ajuda={ajuda} erro={erro} />
    </div>
  );
}

export function Selecao({ rotulo, ajuda, erro, obrigatorio, children, ...p }: PropsRotulo & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div>
      <Rotulo id={id} rotulo={rotulo} obrigatorio={obrigatorio} />
      <select id={id} required={obrigatorio} {...p} className={estiloCampo}>{children}</select>
      <Rodape ajuda={ajuda} erro={erro} />
    </div>
  );
}

export function AreaTexto({ rotulo, ajuda, erro, ...p }: PropsRotulo & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div>
      <Rotulo id={id} rotulo={rotulo} />
      <textarea id={id} rows={3} {...p} className={estiloCampo} />
      <Rodape ajuda={ajuda} erro={erro} />
    </div>
  );
}

export function Alerta({ tipo = 'erro', children }: { tipo?: 'erro' | 'sucesso' | 'info'; children: ReactNode }) {
  const cores = { erro: 'bg-red-50 text-red-800 ring-red-200', sucesso: 'bg-green-50 text-green-800 ring-green-200', info: 'bg-marca-50 text-marca-800 ring-marca-100' };
  return <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ring-1 ${cores[tipo]}`}>{children}</div>;
}

/** Janela sobre a tela, usando <dialog> (fecha com Esc e prende o foco). */
export function Modal({ titulo, aberto, aoFechar, children, largura = 'max-w-lg' }: { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; largura?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); aoFechar(); }}
      className={`m-auto w-[calc(100%-2rem)] ${largura} rounded-lg p-0 shadow-xl backdrop:bg-slate-900/50`}
      aria-labelledby={idTitulo}
    >
      {aberto && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={idTitulo} className="text-lg font-semibold text-slate-900">{titulo}</h2>
            <button type="button" onClick={aoFechar} aria-label="Fechar" className="rounded p-1 text-slate-500 hover:bg-slate-100">✕</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Confirmar({ aberto, titulo, mensagem, rotulo = 'Confirmar', perigo, ocupado, erro, aoConfirmar, aoFechar }: {
  aberto: boolean; titulo: string; mensagem: ReactNode; rotulo?: string; perigo?: boolean; ocupado?: boolean; erro?: string | null;
  aoConfirmar: () => void; aoFechar: () => void;
}) {
  return (
    <Modal titulo={titulo} aberto={aberto} aoFechar={aoFechar}>
      <div className="space-y-4">
        <div className="text-sm text-slate-700">{mensagem}</div>
        {erro && <Alerta>{erro}</Alerta>}
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>Voltar</Botao>
          <Botao variante={perigo ? 'perigo' : 'primario'} onClick={aoConfirmar} disabled={ocupado}>{ocupado ? 'Aguarde…' : rotulo}</Botao>
        </div>
      </div>
    </Modal>
  );
}

// Cores dos status seguindo a planilha: cancelado vermelho com letra branca, em execução azul-claro
const coresStatus: Record<Status, string> = {
  AGUARDANDO_LIBERACAO: 'bg-amber-100 text-amber-900',
  EMITIR_NOTA: 'bg-violet-100 text-violet-900',
  EM_EXECUCAO: 'bg-sky-100 text-sky-900',
  EMITIDA: 'bg-green-100 text-green-900',
  CANCELADO: 'bg-red-600 text-white',
};

export function SeloStatus({ status, rotulo, multa }: { status: Status; rotulo: string; multa?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${coresStatus[status]}`}>{rotulo}</span>
      {multa && <span className="whitespace-nowrap rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-900">com multa</span>}
    </span>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <p className="py-8 text-center text-sm text-slate-500" role="status">{texto}</p>;
}

export function Paginacao({ pagina, porPagina, total, aoMudar }: { pagina: number; porPagina: number; total: number; aoMudar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const de = total ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(pagina * porPagina, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>{de.toLocaleString('pt-BR')}–{ate.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}</span>
      <div className="flex items-center gap-1">
        <Botao variante="secundario" onClick={() => aoMudar(1)} disabled={pagina <= 1} aria-label="Primeira página">«</Botao>
        <Botao variante="secundario" onClick={() => aoMudar(pagina - 1)} disabled={pagina <= 1}>Anterior</Botao>
        <span className="px-2">Página {pagina} de {paginas.toLocaleString('pt-BR')}</span>
        <Botao variante="secundario" onClick={() => aoMudar(pagina + 1)} disabled={pagina >= paginas}>Próxima</Botao>
        <Botao variante="secundario" onClick={() => aoMudar(paginas)} disabled={pagina >= paginas} aria-label="Última página">»</Botao>
      </div>
    </div>
  );
}

// ---------- Avisos rápidos (sucesso/erro) no canto da tela ----------
interface Aviso { id: number; tipo: 'sucesso' | 'erro'; texto: string }
const ContextoAviso = createContext<(tipo: Aviso['tipo'], texto: string) => void>(() => {});

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((tipo: Aviso['tipo'], texto: string) => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, tipo, texto }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'erro' ? 8000 : 4000);
  }, []);
  return (
    <ContextoAviso.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`pointer-events-auto rounded-md px-4 py-3 text-sm shadow-lg ${a.tipo === 'sucesso' ? 'bg-green-700 text-white' : 'bg-red-700 text-white'}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </ContextoAviso.Provider>
  );
}

export const useAvisos = () => useContext(ContextoAviso);
