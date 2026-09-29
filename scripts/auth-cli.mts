import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());

const [{ betterAuth }, { authOptions }] = await Promise.all([
  import("better-auth"),
  import("../lib/auth-options"),
]);

export const auth = betterAuth(authOptions);
