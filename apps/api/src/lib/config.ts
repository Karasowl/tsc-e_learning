import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(24).default("dev-secret-change-this-before-production"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_ROOT: z.string().default("./storage"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("TSC Capacita <capacitacion@tscseguridadprivada.com.mx>"),
  CERTIFICATE_BACKGROUND_URL: z.string().optional(),
  CERTIFICATE_BACKGROUND_PATH: z.string().optional()
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  apiPort: number;
  apiPublicUrl: string;
  webPublicUrl: string;
  databaseUrl: string;
  jwtSecret: string;
  storageDriver: "local" | "s3";
  localStorageRoot: string;
  smtp: {
    host: string | undefined;
    port: number;
    user: string | undefined;
    password: string | undefined;
    from: string;
  };
  certificateBackgroundUrl: string | undefined;
  certificateBackgroundPath: string | undefined;
};

export function readConfig(env = process.env): AppConfig {
  const parsed = configSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    apiPort: parsed.API_PORT,
    apiPublicUrl: parsed.API_PUBLIC_URL,
    webPublicUrl: parsed.WEB_PUBLIC_URL,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    storageDriver: parsed.STORAGE_DRIVER,
    localStorageRoot: parsed.LOCAL_STORAGE_ROOT,
    smtp: {
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      user: parsed.SMTP_USER,
      password: parsed.SMTP_PASSWORD,
      from: parsed.SMTP_FROM
    },
    certificateBackgroundUrl: parsed.CERTIFICATE_BACKGROUND_URL,
    certificateBackgroundPath: parsed.CERTIFICATE_BACKGROUND_PATH
  };
}
