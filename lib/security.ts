/**
 * PostgreSQL is accessed only from server modules through Neon’s parameterized
 * tagged-template API. Never interpolate user data into SQL strings.
 * Apply DB migrations with a separate deployment credential, not at runtime.
 */
export const databaseGuidance = "Parameterized Neon queries only";
