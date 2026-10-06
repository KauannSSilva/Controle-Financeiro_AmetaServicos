/**
 * Row Level Security: a API conecta com um papel sem privilégio de dono, e o banco libera
 * leitura e escrita conforme o perfil passado em cada transação (SET LOCAL app.perfil).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { comPerfil, comoSistema, criarPrisma } from '../src/db.js';
import { inserirItem } from '../src/ordens/ordens.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';
import { urlAppTeste } from './ambiente.js';
import { cripto, SENHA } from './api-util.js';
import { limparBanco } from './util.js';

const dono = new PrismaClient();
const app = criarPrisma(urlAppTeste());
let itemId: string;
let operadorId: string;
let outroId: string;

beforeEach(async () => {
  await limparBanco(dono);
  itemId = (await inserirItem(dono, { numeroPo: '4533000001', item: '10', valorOriginal: 100 })).id;
  operadorId = (await criarUsuario(dono, cripto(), { nome: 'Op', email: 'op@ameta.com.br', perfil: 'OPERADOR', senha: SENHA })).id;
  outroId = (await criarUsuario(dono, cripto(), { nome: 'Outro', email: 'outro@ameta.com.br', perfil: 'OPERADOR', senha: SENHA })).id;
  await dono.logAuditoria.createMany({ data: { acao: 'TESTE', entidade: 'itens_po', entidadeId: itemId } });
});
afterAll(async () => {
  await app.$disconnect();
  await dono.$disconnect();
});

describe('estrutura', () => {
  it('todas as tabelas têm RLS ligado e forçado', async () => {
    const tabelas = await dono.$queryRaw<{ tabela: string; rls: boolean; forcado: boolean }[]>`
      SELECT c.relname AS tabela, c.relrowsecurity AS rls, c.relforcerowsecurity AS forcado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
    expect(tabelas.length).toBeGreaterThanOrEqual(7);
    for (const t of tabelas) expect(t, t.tabela).toMatchObject({ rls: true, forcado: true });
  });

  it('o papel da API não é superusuário, não ignora RLS, não é dono e não vê as migrações', async () => {
    const [papel] = await app.$queryRaw<{ usuario: string; superusuario: boolean; ignora_rls: boolean; cria_banco: boolean }[]>`
      SELECT current_user AS usuario, rolsuper AS superusuario, rolbypassrls AS ignora_rls, rolcreatedb AS cria_banco
      FROM pg_roles WHERE rolname = current_user`;
    expect(papel).toEqual({ usuario: 'ameta_app_teste', superusuario: false, ignora_rls: false, cria_banco: false });
    const [{ donas }] = await app.$queryRaw<{ donas: bigint }[]>`
      SELECT COUNT(*) AS donas FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(donas).toBe(0n);
    await expect(app.$queryRaw`SELECT * FROM _prisma_migrations`).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`CREATE TABLE invasora (id int)`).rejects.toThrow(/permission denied/);
  });
});

// As consultas do Prisma só saem quando alguém espera por elas (await): por isso o await fica dentro do comPerfil
describe('sem perfil na transação', () => {
  it('não vê nada e não grava nada (inclusive pela view)', async () => {
    expect(await app.itemPo.count()).toBe(0);
    expect(await app.usuario.count()).toBe(0);
    const [{ n }] = await app.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM vw_itens_po`;
    expect(n).toBe(0n);
    await expect(app.logAuditoria.createMany({ data: { acao: 'X' } })).rejects.toThrow(/row-level security/);
  });

  it('o SET LOCAL não vaza para a próxima consulta', async () => {
    expect(await comPerfil('ADMIN', null, async () => await app.itemPo.count())).toBe(1);
    expect(await app.itemPo.count()).toBe(0);
  });
});

describe('VISUALIZADOR', () => {
  const como = <T>(fn: () => Promise<T>) => comPerfil('VISUALIZADOR', operadorId, async () => await fn());

  it('lê P.Os e a view, mas não inclui, altera nem apaga', async () => {
    expect(await como(() => app.itemPo.count())).toBe(1);
    expect(await como(() => app.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM vw_itens_po`)).toEqual([{ n: 1n }]);
    await expect(como(() => app.historicoStatus.create({ data: { itemPoId: itemId, statusPara: 'EMITIR_NOTA' } }))).rejects.toThrow();
    const alterados = await como(() => app.itemPo.updateMany({ where: { id: itemId }, data: { projeto: 'invasão' } }));
    expect(alterados.count).toBe(0);
    const apagados = await como(() => app.itemPo.deleteMany({ where: { id: itemId } }));
    expect(apagados.count).toBe(0);
    expect((await dono.itemPo.findUniqueOrThrow({ where: { id: itemId } })).projeto).toBeNull();
  });
});

describe('OPERADOR', () => {
  const como = <T>(fn: () => Promise<T>) => comPerfil('OPERADOR', operadorId, async () => await fn());

  it('altera P.Os, mas não apaga de vez', async () => {
    expect((await como(() => app.itemPo.updateMany({ where: { id: itemId }, data: { projeto: 'PPI' } }))).count).toBe(1);
    expect((await como(() => app.itemPo.deleteMany({ where: { id: itemId } }))).count).toBe(0);
  });

  it('não lê a auditoria nem sessões; altera só a própria linha de usuário', async () => {
    expect(await como(() => app.logAuditoria.count())).toBe(0);
    expect(await como(() => app.sessao.count())).toBe(0);
    expect((await como(() => app.usuario.updateMany({ where: { id: outroId }, data: { perfil: 'ADMIN' } }))).count).toBe(0);
    expect((await como(() => app.usuario.updateMany({ where: { id: operadorId }, data: { tentativasFalhas: 0 } }))).count).toBe(1);
    await expect(como(() => app.usuario.create({ data: { nomeCifrado: Buffer.from([1]), emailCifrado: Buffer.from([1]), emailHash: 'invasor', senhaHash: 'x', perfil: 'ADMIN' } })))
      .rejects.toThrow(/row-level security/);
  });
});

describe('auditoria', () => {
  it('só o ADMIN lê; ninguém altera nem apaga, nem o ADMIN', async () => {
    expect(await comPerfil('ADMIN', null, async () => await app.logAuditoria.count())).toBe(await dono.logAuditoria.count());
    await expect(comPerfil('ADMIN', null, async () => await app.logAuditoria.updateMany({ data: { acao: 'APAGADO' } }))).rejects.toThrow(/permission denied/);
    await expect(comPerfil('ADMIN', null, async () => await app.logAuditoria.deleteMany())).rejects.toThrow(/permission denied/);
    await expect(comoSistema(async () => await app.$executeRaw`TRUNCATE log_auditoria`)).rejects.toThrow(/permission denied/);
  });
});

describe('transações', () => {
  it('a transação inteira usa o perfil, e o lote também', async () => {
    const r = await comPerfil('OPERADOR', operadorId, () => app.$transaction(async (tx) => {
      await tx.itemPo.update({ where: { id: itemId }, data: { projeto: 'Dentro' } });
      return tx.itemPo.count();
    }));
    expect(r).toBe(1);
    expect(await comPerfil('VISUALIZADOR', null, () => app.$transaction([app.itemPo.count(), app.ordemCompra.count()]))).toEqual([1, 1]);
  });
});
