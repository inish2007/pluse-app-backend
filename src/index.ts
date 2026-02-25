import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyJwt, { FastifyJWTOptions } from "@fastify/jwt";
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

const jwtOptions: FastifyJWTOptions = {
  decode: { complete: true },
  verify: {
    allowedAud: env.JWT_AUDIENCE,
    allowedIss: env.JWT_ISSUER,
  },
  sign: {
    iss: env.JWT_ISSUER,
    aud: env.JWT_AUDIENCE,
  },
  secret: env.JWT_PUBLIC_KEY || "development-secret",
};

app.register(fastifyJwt, jwtOptions);

// Auth hook (replace with real key verification)
app.decorate("authenticate", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/token/example", async (request, reply) => {
  const token = await reply.jwtSign({ sub: "example-user" });
  return { token };
});

app.get("/verify/example", { preHandler: [app.authenticate] }, async (request) => {
  return { user: request.user };
});

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
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
  }
}
