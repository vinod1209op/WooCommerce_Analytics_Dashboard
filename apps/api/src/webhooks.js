import crypto from 'crypto';
import express from 'express';
import { prisma } from '../../../packages/database/index.js'; 

const router = express.Router();

router.post('/webhooks/woocommerce', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const topic = req.get('X-WC-Webhook-Topic') || 'unknown';
    const baseUrl = req.get('X-WC-Webhook-Source') || ''; // not always present
    const payload = req.body;
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');

    // find store by base URL if you pass it as a header/custom secret, or map by webhook id
    const store = await prisma.store.findFirst({ where: { wooBaseUrl: { contains: baseUrl.replace(/\/$/, '') } } });
    if (!store) return res.status(200).end(); 

    await prisma.webhookEvent.create({
      data: { storeId: store.id, topic, payloadHash, valid: true, receivedAt: new Date() },
    });

    res.status(200).end();
  } catch (e) {
    console.error('Webhook error', e);
    res.status(200).end();
  }
});

export default router;
