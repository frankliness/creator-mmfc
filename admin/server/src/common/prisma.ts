import { PrismaClient } from "@prisma/client";

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

export const prisma = new PrismaClient();
