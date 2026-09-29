import "server-only";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth-options";

export const auth = betterAuth(authOptions);
