CREATE TABLE IF NOT EXISTS vit_teams (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, curso text NOT NULL CHECK (curso IN ('1ro','2do','3ro','4to','5to','6to','7mo')), division text NOT NULL CHECK (division IN ('A','B','C','1ra','2da')), nombre_equipo varchar(60) NOT NULL, sistema_juego text NOT NULL CHECK (sistema_juego IN ('6:0','4:2','5:1')), tipo_cuatro_dos text CHECK (tipo_cuatro_dos IN ('c','o')), color_remera varchar(32) NOT NULL, capitan varchar(60) NOT NULL, telefono varchar(24) NOT NULL, autorizacion boolean NOT NULL DEFAULT false, fecha_registro timestamptz NOT NULL DEFAULT now(), CHECK ((curso IN ('1ro','2do','3ro') AND division IN ('A','B','C')) OR (curso IN ('4to','5to','6to','7mo') AND division IN ('1ra','2da'))), CHECK ((sistema_juego = '4:2' AND tipo_cuatro_dos IN ('c','o')) OR (sistema_juego <> '4:2' AND tipo_cuatro_dos IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS vit_teams_name_normalized_idx ON vit_teams (lower(nombre_equipo));
CREATE INDEX IF NOT EXISTS vit_teams_course_division_idx ON vit_teams(curso, division);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS vit_teams_name_trigram_idx ON vit_teams USING gin (lower(nombre_equipo) gin_trgm_ops);
CREATE TABLE IF NOT EXISTS vit_players (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id_equipo bigint NOT NULL REFERENCES vit_teams(id) ON DELETE CASCADE, nombre varchar(64) NOT NULL, posicion text CHECK (posicion IN ('Punta','Opuesto','Central','Armador','Libero')), suplente boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS vit_players_team_idx ON vit_players(id_equipo);
CREATE TABLE IF NOT EXISTS vit_registration_codes (codigo varchar(32) PRIMARY KEY, usado boolean NOT NULL DEFAULT false, cancelado boolean NOT NULL DEFAULT false, id_equipo bigint REFERENCES vit_teams(id) ON DELETE SET NULL, fecha_creacion timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS vit_registration_requests (request_id uuid PRIMARY KEY, team_id bigint NOT NULL REFERENCES vit_teams(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS vit_rate_limits (bucket_key text PRIMARY KEY, hits integer NOT NULL, window_started_at timestamptz NOT NULL);
CREATE OR REPLACE FUNCTION hit_vit_rate_limit(p_key text, p_max integer DEFAULT 20) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_hits integer;
BEGIN
  INSERT INTO vit_rate_limits(bucket_key, hits, window_started_at) VALUES (p_key, 1, date_trunc('minute', now()))
  ON CONFLICT (bucket_key) DO UPDATE SET
    hits = CASE WHEN vit_rate_limits.window_started_at < date_trunc('minute', now()) THEN 1 ELSE vit_rate_limits.hits + 1 END,
    window_started_at = CASE WHEN vit_rate_limits.window_started_at < date_trunc('minute', now()) THEN date_trunc('minute', now()) ELSE vit_rate_limits.window_started_at END
  RETURNING hits INTO v_hits;
  RETURN v_hits <= p_max;
END;
$$;
CREATE OR REPLACE FUNCTION register_vit_team(payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_request_id uuid := (payload->>'requestId')::uuid; v_course text := payload->>'course'; v_division text := payload->>'division'; v_team_name text := trim(payload->>'teamName'); v_code text := upper(trim(payload->>'code')); v_team_id bigint; v_players jsonb := payload->'players'; v_starters integer := (payload->>'starterCount')::integer;
BEGIN
PERFORM pg_advisory_xact_lock(hashtextextended('request:' || v_request_id::text, 0));
PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_course || ':' || v_division, 0));
SELECT team_id INTO v_team_id FROM vit_registration_requests WHERE request_id = v_request_id;
IF v_team_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', true); END IF;
IF (SELECT count(*) FROM vit_teams WHERE curso = v_course AND division = v_division) >= 2 THEN RETURN jsonb_build_object('ok', false, 'reason', 'capacity'); END IF;
IF EXISTS (SELECT 1 FROM vit_teams WHERE lower(nombre_equipo) = lower(v_team_name)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name'); END IF;
PERFORM 1 FROM vit_registration_codes WHERE codigo = v_code AND NOT usado AND NOT cancelado FOR UPDATE;
IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
INSERT INTO vit_teams (curso, division, nombre_equipo, sistema_juego, tipo_cuatro_dos, color_remera, capitan, telefono, autorizacion) VALUES (v_course, v_division, v_team_name, payload->>'system', NULLIF(payload->>'systemType',''), payload->>'color', payload->'players'->0->>'name', payload->>'phone', (payload->>'consent')::boolean) RETURNING id INTO v_team_id;
INSERT INTO vit_players (id_equipo, nombre, posicion, suplente) SELECT v_team_id, item.player->>'name', NULLIF(item.player->>'position',''), (item.ordinality - 1) >= v_starters FROM jsonb_array_elements(v_players) WITH ORDINALITY AS item(player, ordinality);
UPDATE vit_registration_codes SET usado = true, id_equipo = v_team_id WHERE codigo = v_code AND NOT usado;
IF NOT FOUND THEN RAISE EXCEPTION 'registration code was already used'; END IF;
INSERT INTO vit_registration_requests (request_id, team_id) VALUES (v_request_id, v_team_id);
RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', false);
END;
$$;
