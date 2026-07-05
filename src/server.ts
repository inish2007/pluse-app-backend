
console.log("1 - server.ts loaded");

import * as dotenv from "dotenv";
dotenv.config();

console.log("2 - dotenv loaded");

import { initializeDatabase } from "./db/pool.js";

console.log("3 - db imported");

import { buildApp } from "./app.js";
import { ensureFirebaseAdminInitialized } from "./firebase/admin.js";

console.log("4 - app imported");

console.log("5 - starting...");



const requiredEnv = ['DATABASE_URL', 'JWT_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

if (process.env.PORT && Number.isNaN(Number(process.env.PORT))) {
  console.error(`Invalid PORT value: ${process.env.PORT}`);
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;

const logStartupError = (error: unknown) => {
  console.error('Startup failure:', error);
  process.exit(1);
};

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

const start = async () => {
  try {
    console.log("[START] ensureFirebaseAdminInitialized()");
    ensureFirebaseAdminInitialized();
    console.log("[START] Firebase Admin initialization verified");

    console.log("[START] initializeDatabase()");
    await initializeDatabase();
    console.log("[START] initializeDatabase complete");

    console.log("[START] buildApp()");
    const app = buildApp();
    console.log("[START] buildApp complete");

    console.log("[START] app.listen()");
    await app.listen({ port, host: '0.0.0.0' });
    console.log("[START] listening");
    app.log.info(`Server listening on port ${port}`);
  } catch (err) {
    logStartupError(err);
  }
};

start();
