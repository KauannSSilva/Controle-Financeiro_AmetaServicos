/** Chamadas à API. Os cookies da sessão vão sozinhos; o token CSRF vai no cabeçalho. */

export class ErroApi extends Error {
  constructor(public status: number, mensagem: string, public codigo?: string, public detalhes?: { campo: string; mensagem: string }[]) {
    super(mensagem);
  }
}

function csrf() {
  const m = document.cookie.match(/(?:^|; )ameta_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Chamado quando a sessão acabou de vez (o site volta para o login). */
let aoExpirar: () => void = () => {};
export function definirAoExpirar(fn: () => void) {
  aoExpirar = fn;
}

let renovando: Promise<boolean> | null = null;
async function renovar(): Promise<boolean> {
  renovando ??= fetch('/api/v1/auth/renovar', { method: 'POST', headers: { 'x-csrf-token': csrf() }, credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => { renovando = null; }, 0));
  return renovando;
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function chamar(metodo: Metodo, caminho: string, corpo?: unknown, tentarRenovar = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (metodo !== 'GET') headers['x-csrf-token'] = csrf();
  const r = await fetch(`/api/v1/${caminho}`, {
    method: metodo, headers, credentials: 'same-origin',
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  // Token de acesso venceu (15 min): renova uma vez e repete
  if (r.status === 401 && tentarRenovar && !caminho.startsWith('auth/')) {
    if (await renovar()) return chamar(metodo, caminho, corpo, false);
    aoExpirar();
  }
  return r;
}

async function json<T>(r: Response): Promise<T> {
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : {};
  if (!r.ok) {
    const msg = dados.detalhes?.length
      ? dados.detalhes.map((d: { campo: string; mensagem: string }) => (d.campo ? `${d.campo}: ${d.mensagem}` : d.mensagem)).join('; ')
      : dados.erro ?? `Erro ${r.status}`;
    throw new ErroApi(r.status, dados.correlacao ? `${msg} (código ${dados.correlacao})` : msg, dados.codigo, dados.detalhes);
  }
  return dados as T;
}

export const api = {
  get: <T>(caminho: string, params?: Record<string, string | number | boolean | undefined | null>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return chamar('GET', q ? `${caminho}?${q}` : caminho).then((r) => json<T>(r));
  },
  post: <T>(caminho: string, corpo?: unknown) => chamar('POST', caminho, corpo ?? {}).then((r) => json<T>(r)),
  patch: <T>(caminho: string, corpo: unknown) => chamar('PATCH', caminho, corpo).then((r) => json<T>(r)),
  delete: <T>(caminho: string) => chamar('DELETE', caminho).then((r) => json<T>(r)),
  renovar,
};
