import { PrismaClient } from "@prisma/client";

// BigInt fields (seed, completionTokens, totalTokens) cannot be serialized
// by JSON.stringify. This polyfill ensures NextResponse.json() works correctly.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
