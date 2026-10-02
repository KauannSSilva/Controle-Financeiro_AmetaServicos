import { Prisma, PrismaClient } from '@prisma/client';

/** Cliente normal ou o cliente de dentro de uma transação. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function criarPrisma(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('DATABASE_URL não definida. Copie .env.example para .env.');
  return new PrismaClient({ datasources: { db: { url } } });
}
