import { PrismaClient } from '@prisma/client';

/** Esvazia as tabelas entre os testes. Só roda em banco cujo nome termina em _teste. */
export async function limparBanco(prisma: PrismaClient) {
  const [{ banco }] = await prisma.$queryRaw<{ banco: string }[]>`SELECT current_database() AS banco`;
  if (!banco.endsWith('_teste')) throw new Error(`Recusado: ${banco} não é um banco de teste`);
  await prisma.$executeRawUnsafe(
    'TRUNCATE historico_status, itens_po, ordens_compra, log_auditoria, sessoes, codigos_recuperacao_mfa, usuarios RESTART IDENTITY CASCADE',
  );
}
