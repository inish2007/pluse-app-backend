
console.log("1 - server.ts loaded");

import * as dotenv from "dotenv";
dotenv.config();

console.log("2 - dotenv loaded");

import { initializeDatabase } from "./db/pool.js";

console.log("3 - db imported");

import { buildApp } from "./app.js";

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

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
  await initializeDatabase();

  const app = buildApp();

  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${port}`);
  } catch (err) {
    logStartupError(err);
  }
};

start();
