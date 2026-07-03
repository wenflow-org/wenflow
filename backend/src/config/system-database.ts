import 'dotenv/config';
import { PrismaClient } from '../generated/system-client';

const globalForSystemPrisma = globalThis as unknown as {
  systemPrisma: PrismaClient | undefined;
};

export const systemPrisma = globalForSystemPrisma.systemPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForSystemPrisma.systemPrisma = systemPrisma;
}

export default systemPrisma;
