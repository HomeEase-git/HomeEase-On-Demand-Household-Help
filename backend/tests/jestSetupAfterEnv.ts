import prisma from '@config/database';
import { ownerDb } from './ownerDb';

afterAll(async () => {
  await prisma.$disconnect();
  await ownerDb.$disconnect();
});
