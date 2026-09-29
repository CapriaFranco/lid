-- Ejecutar en Neon con credenciales administrativas nuevas y rotadas.
-- Este archivo puede aplicarse luego de migration_vit_registration.sql.

ALTER TABLE IF EXISTS vit_registration_codes
  ADD COLUMN IF NOT EXISTS cancelado boolean NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS vit_teams
  ADD COLUMN IF NOT EXISTS justificacion_admin varchar(300);
ALTER TABLE IF EXISTS vit_players
  ALTER COLUMN nombre TYPE varchar(64);

CREATE TABLE IF NOT EXISTS vit_admin_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email varchar(254) NOT NULL,
  action varchar(48) NOT NULL,
  entity_type varchar(48) NOT NULL,
  entity_id varchar(96) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vit_admin_audit_created_idx ON vit_admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS vit_admin_audit_entity_idx ON vit_admin_audit_logs(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION admin_update_vit_code(p_code text, p_action text, p_actor text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_updated text;
BEGIN
  IF p_action = 'cancel' THEN
    UPDATE vit_registration_codes
      SET cancelado = true, usado = true
      WHERE codigo = p_code AND NOT usado AND NOT cancelado
      RETURNING codigo INTO v_updated;
  ELSIF p_action = 'mark-used' THEN
    UPDATE vit_registration_codes
      SET usado = true
      WHERE codigo = p_code AND NOT usado AND NOT cancelado
      RETURNING codigo INTO v_updated;
  ELSE
    RETURN false;
  END IF;

  IF v_updated IS NULL THEN RETURN false; END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
    VALUES (p_actor, 'code.' || p_action, 'registration_code', p_code, '{}'::jsonb);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_vit_team(p_team_id bigint, p_actor text, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_player_count integer;
BEGIN
  v_player_count := jsonb_array_length(p_payload->'integrantes');
  IF v_player_count < 6 OR v_player_count > 9 THEN
    RAISE EXCEPTION 'invalid player count';
  END IF;
  IF v_player_count = 9 AND length(trim(coalesce(p_payload->>'justificacion_admin', ''))) < 8 THEN
    RAISE EXCEPTION 'ninth player requires a justification';
  END IF;

  UPDATE vit_teams SET
    curso = p_payload->>'curso',
    division = p_payload->>'division',
    nombre_equipo = trim(p_payload->>'nombre'),
    sistema_juego = p_payload->>'sistema',
    tipo_cuatro_dos = NULLIF(p_payload->>'tipo', ''),
    color_remera = trim(p_payload->>'color'),
    capitan = trim(p_payload->'integrantes'->0->>'nombre'),
    telefono = p_payload->>'telefono',
    justificacion_admin = NULLIF(trim(p_payload->>'justificacion_admin'), '')
  WHERE id = p_team_id;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM vit_players WHERE id_equipo = p_team_id;
  INSERT INTO vit_players(id_equipo, nombre, posicion, suplente, autorizacion, orden)
    SELECT p_team_id, item.player->>'nombre', NULLIF(item.player->>'posicion', '')::text,
      coalesce((item.player->>'suplente')::boolean, false), coalesce((item.player->>'autorizacion')::boolean, false), item.ordinality - 1
    FROM jsonb_array_elements(p_payload->'integrantes') WITH ORDINALITY AS item(player, ordinality);

  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
    VALUES (p_actor, 'team.update', 'team', p_team_id::text,
      jsonb_build_object('nombre', p_payload->>'nombre', 'curso', p_payload->>'curso', 'division', p_payload->>'division', 'integrantes', v_player_count));
  RETURN true;
END;
$$;

-- Esquema Better Auth (PostgreSQL). Las contraseñas se almacenan únicamente
-- como hashes administrados por Better Auth.
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "role" text NOT NULL DEFAULT 'user',
  "banned" boolean NOT NULL DEFAULT false,
  "banReason" text,
  "banExpires" timestamp
);
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamp NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "impersonatedBy" text
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  "scope" text,
  "password" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account"("userId");
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"("identifier");
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

REVOKE ALL ON FUNCTION admin_update_vit_code(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_vit_team(bigint, text, jsonb) FROM PUBLIC;
