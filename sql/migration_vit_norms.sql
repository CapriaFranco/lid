CREATE TABLE IF NOT EXISTS vit_norm_categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug varchar(48) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  nombre varchar(80) NOT NULL,
  descripcion varchar(240) NOT NULL DEFAULT '',
  orden integer NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vit_norms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id bigint NOT NULL REFERENCES vit_norm_categories(id) ON DELETE RESTRICT,
  slug varchar(64) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  titulo varchar(120) NOT NULL,
  resumen varchar(300) NOT NULL DEFAULT '',
  publicado boolean NOT NULL DEFAULT false,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vit_norm_blocks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  norm_id bigint NOT NULL REFERENCES vit_norms(id) ON DELETE CASCADE,
  tipo varchar(24) NOT NULL CHECK (tipo IN ('paragraph','heading','list','note')),
  contenido text NOT NULL CHECK (length(contenido) <= 5000),
  nivel_sangria smallint NOT NULL DEFAULT 0 CHECK (nivel_sangria BETWEEN 0 AND 4),
  alineacion varchar(16) NOT NULL DEFAULT 'left' CHECK (alineacion IN ('left','center','right')),
  tamano varchar(16) NOT NULL DEFAULT 'normal' CHECK (tamano IN ('small','normal','large')),
  color varchar(7) NOT NULL DEFAULT '#344238' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  orden integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS vit_norms_public_order_idx ON vit_norms(category_id, publicado, orden);
CREATE INDEX IF NOT EXISTS vit_norm_blocks_order_idx ON vit_norm_blocks(norm_id, orden);

CREATE OR REPLACE FUNCTION register_vit_team(payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_request_id uuid := (payload->>'requestId')::uuid;
  v_course text := payload->>'course';
  v_division text := payload->>'division';
  v_team_name text := trim(payload->>'teamName');
  v_code text := upper(trim(payload->>'code'));
  v_team_id bigint;
  v_players jsonb := payload->'players';
  v_starters integer := (payload->>'starterCount')::integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('request:' || v_request_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_course || ':' || v_division, 0));
  SELECT team_id INTO v_team_id FROM vit_registration_requests WHERE request_id = v_request_id;
  IF v_team_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', true); END IF;
  IF (SELECT count(*) FROM vit_teams WHERE curso = v_course AND division = v_division) >= 2 THEN RETURN jsonb_build_object('ok', false, 'reason', 'capacity'); END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE lower(nombre_equipo) = lower(v_team_name)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name'); END IF;
  PERFORM 1 FROM vit_registration_codes WHERE codigo = v_code AND NOT usado AND NOT cancelado FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  INSERT INTO vit_teams (curso, division, nombre_equipo, sistema_juego, tipo_cuatro_dos, color_remera, capitan, telefono)
    VALUES (v_course, v_division, v_team_name, payload->>'system', NULLIF(payload->>'systemType',''), payload->>'color', payload->'players'->0->>'name', payload->>'phone') RETURNING id INTO v_team_id;
  INSERT INTO vit_players (id_equipo, nombre, posicion, suplente, autorizacion, orden)
    SELECT v_team_id, item.player->>'name', NULLIF(item.player->>'position',''), (item.ordinality - 1) >= v_starters, (payload->>'consent')::boolean, item.ordinality - 1
    FROM jsonb_array_elements(v_players) WITH ORDINALITY AS item(player, ordinality);
  UPDATE vit_registration_codes SET usado = true, id_equipo = v_team_id WHERE codigo = v_code AND NOT usado;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration code was already used'; END IF;
  INSERT INTO vit_registration_requests (request_id, team_id) VALUES (v_request_id, v_team_id);
  RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION register_vit_team(jsonb) FROM PUBLIC;
