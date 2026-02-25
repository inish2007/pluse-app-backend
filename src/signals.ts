import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";

type PendingSignal = {
  signalId: string;
  coupleId: string;
  encEmotion: string;
  iv: string;
  alg: string;
  sentAt: string;
};

// In-memory store for scaffold; replace with DB.
const pendingSignals: PendingSignal[] = [];

export const signalsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/pending", { preHandler: [app.authenticate] }, async (req, reply) => {
    return pendingSignals;
  });

  app.post<{ Params: { id: string }; Body: { deliveredAt: string; deviceId: string } }>(
    "/:id/ack",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params;
      const found = pendingSignals.find((s) => s.signalId === id);
      if (!found) {
        return reply.code(404).send({ error: "not_found" });
      }
      // Remove from pending on ack
      const idx = pendingSignals.findIndex((s) => s.signalId === id);
      if (idx >= 0) pendingSignals.splice(idx, 1);
      return { status: "acknowledged", id, deliveredAt: req.body.deliveredAt, deviceId: req.body.deviceId };
    }
  );

  // Dev helper to seed a pending signal
  app.post("/seed", { preHandler: [app.authenticate] }, async () => {
    const signal: PendingSignal = {
      signalId: randomUUID(),
      coupleId: randomUUID(),
      encEmotion: "enc",
      iv: "iv",
      alg: "AES-256-GCM",
      sentAt: new Date().toISOString(),
    };
    pendingSignals.push(signal);
    return signal;
  });
};
