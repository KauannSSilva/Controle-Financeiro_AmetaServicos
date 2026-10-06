/**
 * Conexão com o banco e o perfil usado pelas políticas de RLS (Row Level Security).
 *
 * Toda consulta feita dentro de comPerfil()/comoSistema() roda numa transação que começa com
 * SET LOCAL app.perfil e app.usuario_id; as políticas do PostgreSQL liberam leitura e escrita
 * conforme esse perfil. Fora desse contexto nada é configurado e as políticas negam tudo.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PerfilUsuario, Prisma, PrismaClient } from '@prisma/client';

/** Cliente normal ou o cliente de dentro de uma transação. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** SISTEMA = login, sessão, convite e scripts do terminal (antes de existir um usuário logado) */
export type PerfilBanco = PerfilUsuario | 'SISTEMA';

interface ContextoBanco {
  perfil: PerfilBanco | null;
  usuarioId: string | null;
  /** Já dentro de uma transação configurada: as consultas usam o SET LOCAL dela */
  emTransacao?: boolean;
}

const contexto = new AsyncLocalStorage<ContextoBanco>();

export function comPerfil<T>(perfil: PerfilBanco, usuarioId: string | null, fn: () => T): T {
  return contexto.run({ perfil, usuarioId }, fn);
}

export const comoSistema = <T>(fn: () => T): T => comPerfil('SISTEMA', null, fn);

/** Scripts do terminal (importação, primeiro ADMIN): tudo o que vier depois roda como SISTEMA. */
export function entrarComoSistema() {
  contexto.enterWith({ perfil: 'SISTEMA', usuarioId: null });
}

/** Contexto de uma requisição HTTP: começa vazio e a autenticação preenche o perfil. */
export function contextoRequisicao(fn: () => void) {
  contexto.run({ perfil: null, usuarioId: null }, fn);
}

/** Troca o perfil do contexto atual (usado pela API depois de validar o login). */
export function definirPerfil(perfil: PerfilBanco | null, usuarioId: string | null) {
  const c = contexto.getStore();
  if (!c) throw new Error('definirPerfil fora de um contexto de requisição');
  c.perfil = perfil;
  c.usuarioId = usuarioId;
}

/** No docker compose o banco se chama "postgres", não "localhost": BANCO_HOST troca o endereço das URLs do .env. */
export function trocarHost(url: string | undefined): string | undefined {
  if (!url || !process.env.BANCO_HOST) return url;
  const u = new URL(url);
  u.hostname = process.env.BANCO_HOST;
  u.port = '5432';
  return u.toString();
}

const configurar = (c: ContextoBanco) =>
  Prisma.sql`SELECT set_config('app.perfil', ${c.perfil ?? ''}, true), set_config('app.usuario_id', ${c.usuarioId ?? ''}, true)`;

export function criarPrisma(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('DATABASE_URL não definida. Copie .env.example para .env.');
  const base = new PrismaClient({ datasources: { db: { url } } });

  const estendido = base.$extends({
    query: {
      // Consulta solta: vira uma transação curta com o SET LOCAL antes
      async $allOperations({ args, query }) {
        const c = contexto.getStore();
        if (!c?.perfil || c.emTransacao) return query(args);
        const [, resultado] = await base.$transaction([base.$executeRaw(configurar(c)), query(args)]);
        return resultado;
      },
    },
  });

  // Transações: o SET LOCAL é a primeira coisa feita dentro delas
  return new Proxy(estendido, {
    get(alvo, prop, receptor) {
      if (prop !== '$transaction') return Reflect.get(alvo, prop, receptor);
      return (arg: unknown, opcoes?: object) => {
        const c = contexto.getStore();
        const transacao = alvo.$transaction.bind(alvo) as (a: unknown, o?: object) => Promise<unknown>;
        if (!c?.perfil || c.emTransacao) return transacao(arg, opcoes);
        const dentro = { ...c, emTransacao: true };
        if (typeof arg === 'function') {
          return alvo.$transaction(
            (tx) => contexto.run(dentro, async () => {
              await tx.$executeRaw(configurar(c));
              return (arg as (t: typeof tx) => Promise<unknown>)(tx);
            }),
            opcoes,
          );
        }
        return contexto.run(dentro, () =>
          (transacao([base.$executeRaw(configurar(c)), ...(arg as unknown[])], opcoes) as Promise<unknown[]>).then((r) => r.slice(1)));
      };
    },
  }) as unknown as PrismaClient;
}
