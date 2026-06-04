import { buildServer } from "./server.js";
import { readConfig } from "./lib/config.js";

const config = readConfig();
const server = await buildServer(config);

try {
  await server.listen({ host: "0.0.0.0", port: config.apiPort });
  server.log.info(`TSC Capacita API listening on ${config.apiPort}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
