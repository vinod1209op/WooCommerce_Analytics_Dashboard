import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { wooBaseUrl: process.env.WOO_BASE_URL },
    update: {
      name: process.env.STORE_NAME ?? 'MCRDSE',
      wooKey: process.env.WOO_KEY,
      wooSecret: process.env.WOO_SECRET,
    },
    create: {
      name: process.env.STORE_NAME ?? 'MCRDSE',
      wooBaseUrl: process.env.WOO_BASE_URL,
      wooKey: process.env.WOO_KEY,
      wooSecret: process.env.WOO_SECRET,
    },
  });
  console.log('Upserted store:', store.id, store.name);
}

main().finally(() => prisma.$disconnect());
