import "server-only";
import { betterAuth } from "better-auth";
import { getAuthOptions } from "./auth-options";

let authInstance: ReturnType<typeof betterAuth<ReturnType<typeof getAuthOptions>>> | undefined;

export function getAuth() {
  authInstance ??= betterAuth(getAuthOptions());
  return authInstance!;
}
