import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyJwt from "@fastify/jwt";
import { loadEnv } from "./env";
import { logger } from "./logger";
import { signalsRoutes } from "./signals";

const env = loadEnv();

const app = Fastify({
  logger,
  trustProxy: true,
  ajv: { customOptions: { removeAdditional: "all" } },
});

app.register(helmet, { contentSecurityPolicy: false });
app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

app.register(fastifyJwt, {
  decode: { complete: true },
  verify: {
    allowedAud: env.JWT_AUDIENCE,
    issuer: env.JWT_ISSUER,
  },
  secret: env.JWT_PUBLIC_KEY || "development-secret",
});

// Auth hook (replace with real key verification)
app.decorate(
  "authenticate",
  async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  }
);

app.register(signalsRoutes, { prefix: "/signals" });

const start = async () => {
  try {
    await app.listen({ port: Number(env.PORT), host: "0.0.0.0" });
    logger.info(`Server listening on ${env.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();

declare module "fastify" {
  interface FastifyInstance {
    authenticate: any;
  }
}
