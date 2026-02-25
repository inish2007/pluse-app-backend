import { z } from "zod";

export const envSchema = z.object({
  PORT: z.string().default("8080"),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_AUDIENCE: z.string().default("pulse-app"),
  JWT_ISSUER: z.string().default("pulse-backend"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
