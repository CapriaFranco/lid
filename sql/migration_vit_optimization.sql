-- Consolidate application reads and writes in PostgreSQL functions and normalize
-- school course/division data. Apply through npm run db:migrate.

CREATE TABLE IF NOT EXISTS vit_courses (
  codigo text PRIMARY KEY,
  ciclo text NOT NULL CHECK (ciclo IN ('basico', 'superior')),
  orden smallint NOT NULL UNIQUE CHECK (orden BETWEEN 1 AND 7)
);

INSERT INTO vit_courses (codigo, ciclo, orden) VALUES
  ('1ro', 'basico', 1), ('2do', 'basico', 2), ('3ro', 'basico', 3),
  ('4to', 'superior', 4), ('5to', 'superior', 5), ('6to', 'superior', 6), ('7mo', 'superior', 7)
ON CONFLICT (codigo) DO UPDATE SET ciclo = EXCLUDED.ciclo, orden = EXCLUDED.orden;

CREATE TABLE IF NOT EXISTS vit_course_divisions (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  curso_codigo text NOT NULL REFERENCES vit_courses(codigo) ON UPDATE CASCADE ON DELETE RESTRICT,
  codigo text NOT NULL,
  orden smallint NOT NULL,
  UNIQUE (curso_codigo, codigo),
  UNIQUE (curso_codigo, orden)
);

INSERT INTO vit_course_divisions (curso_codigo, codigo, orden)
SELECT c.codigo, division.codigo, division.orden
FROM vit_courses c
CROSS JOIN LATERAL unnest(CASE WHEN c.ciclo = 'basico' THEN ARRAY['A','B','C']::text[] ELSE ARRAY['1ra','2da']::text[] END)
  WITH ORDINALITY AS division(codigo, orden)
ON CONFLICT (curso_codigo, codigo) DO UPDATE SET orden = EXCLUDED.orden;

ALTER TABLE vit_teams ADD COLUMN IF NOT EXISTS course_division_id smallint;
UPDATE vit_teams t
SET course_division_id = d.id
FROM vit_course_divisions d
WHERE d.curso_codigo = t.curso AND d.codigo = t.division AND t.course_division_id IS NULL;
ALTER TABLE vit_teams ALTER COLUMN course_division_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vit_teams_course_division_fk') THEN
    ALTER TABLE vit_teams ADD CONSTRAINT vit_teams_course_division_fk
      FOREIGN KEY (course_division_id) REFERENCES vit_course_divisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ DECLARE item record; BEGIN
  FOR item IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'vit_teams'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%curso%' OR pg_get_constraintdef(oid) ILIKE '%division%')
  LOOP EXECUTE format('ALTER TABLE vit_teams DROP CONSTRAINT %I', item.conname); END LOOP;
END $$;
DROP INDEX IF EXISTS vit_teams_course_division_idx;
ALTER TABLE vit_teams DROP COLUMN IF EXISTS curso, DROP COLUMN IF EXISTS division, DROP COLUMN IF EXISTS capitan;
CREATE INDEX IF NOT EXISTS vit_teams_course_division_id_idx ON vit_teams(course_division_id);

CREATE OR REPLACE FUNCTION vit_team_list(p_cycle text, p_admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'nombre', t.nombre_equipo, 'curso', c.codigo, 'division', d.codigo,
      'sistema', t.sistema_juego, 'tipo', t.tipo_cuatro_dos, 'color', t.color_remera,
      'capitan', (SELECT p.nombre FROM vit_players p WHERE p.id_equipo = t.id ORDER BY p.orden, p.id LIMIT 1),
      'telefono', CASE WHEN p_admin THEN t.telefono END,
      'justificacion_admin', CASE WHEN p_admin THEN COALESCE(t.justificacion_admin, '') END,
      'fecha_registro', CASE WHEN p_admin THEN t.fecha_registro END,
      'integrantes', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN p_admin THEN p.id END, 'nombre', p.nombre,
          'posicion', CASE WHEN p_admin THEN p.posicion ELSE COALESCE(p.posicion, '-') END,
          'suplente', p.suplente, 'autorizacion', p.autorizacion
        ) - CASE WHEN p_admin THEN ARRAY[]::text[] ELSE ARRAY['id']::text[] END) ORDER BY p.orden, p.id) FROM vit_players p WHERE p.id_equipo = t.id
      ), '[]'::jsonb)
    ) ORDER BY c.orden, d.orden, lower(t.nombre_equipo), t.id
  ), '[]'::jsonb)
  FROM vit_teams t
  JOIN vit_course_divisions d ON d.id = t.course_division_id
  JOIN vit_courses c ON c.codigo = d.curso_codigo
  WHERE p_cycle = 'ambos' OR c.ciclo = p_cycle
$$;

CREATE OR REPLACE FUNCTION vit_registration_options(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('capacity:' || left(coalesce(p_identity, 'unavailable'), 80), 60) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object(
    'capacities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('curso', capacity_rows.curso, 'division', capacity_rows.division, 'cantidad', capacity_rows.cantidad) ORDER BY capacity_rows.course_order, capacity_rows.division_order)
      FROM (
        SELECT c.codigo AS curso, d.codigo AS division, c.orden AS course_order, d.orden AS division_order, count(t.id)::integer AS cantidad
        FROM vit_course_divisions d JOIN vit_courses c ON c.codigo = d.curso_codigo
        LEFT JOIN vit_teams t ON t.course_division_id = d.id
        GROUP BY c.codigo, d.codigo, c.orden, d.orden
      ) capacity_rows
    ), '[]'::jsonb),
    'colors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ciclo', color_rows.ciclo, 'color', color_rows.color) ORDER BY color_rows.ciclo, color_rows.color)
      FROM (
        SELECT c.ciclo, min(trim(t.color_remera)) AS color
        FROM vit_teams t JOIN vit_course_divisions d ON d.id = t.course_division_id
        JOIN vit_courses c ON c.codigo = d.curso_codigo
        GROUP BY c.ciclo, lower(trim(t.color_remera))
      ) color_rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION vit_public_teams(p_cycle text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_cycle NOT IN ('basico', 'superior', 'ambos') THEN RETURN jsonb_build_object('error', 'invalid_cycle'); END IF;
  IF NOT hit_vit_rate_limit('teams:' || left(coalesce(p_identity, 'unavailable'), 80), 90) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object('teams', vit_team_list(p_cycle, false));
END;
$$;

CREATE OR REPLACE FUNCTION vit_check_team_name(p_name text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_names jsonb;
BEGIN
  IF NOT hit_vit_rate_limit('name-check:' || left(coalesce(p_identity, 'unavailable'), 80), 30) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nombre', q.nombre_equipo, 'exact', q.exact) ORDER BY q.exact DESC, lower(q.nombre_equipo)), '[]'::jsonb)
  INTO v_names
  FROM (
    SELECT nombre_equipo, lower(nombre_equipo) = lower(trim(p_name)) AS exact
    FROM vit_teams
    WHERE lower(nombre_equipo) = lower(trim(p_name))
       OR similarity(lower(nombre_equipo), lower(trim(p_name))) > 0.35
    ORDER BY (lower(nombre_equipo) = lower(trim(p_name))) DESC, lower(nombre_equipo)
    LIMIT 5
  ) q;
  RETURN jsonb_build_object(
    'exists', COALESCE((SELECT bool_or((item.value->>'exact')::boolean) FROM jsonb_array_elements(v_names) AS item(value)), false),
    'similar', COALESCE((SELECT jsonb_agg(item.value->>'nombre') FROM jsonb_array_elements(v_names) AS item(value) WHERE NOT (item.value->>'exact')::boolean), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION register_vit_team(payload jsonb, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_request_id uuid := (payload->>'requestId')::uuid;
  v_course text := payload->>'course';
  v_division text := payload->>'division';
  v_team_name text := trim(payload->>'teamName');
  v_code text := upper(trim(payload->>'code'));
  v_team_id bigint;
  v_division_id smallint;
  v_players jsonb := payload->'players';
  v_starters integer := (payload->>'starterCount')::integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('request:' || v_request_id::text, 0));
  SELECT team_id INTO v_team_id FROM vit_registration_requests WHERE request_id = v_request_id;
  IF v_team_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', true); END IF;
  IF NOT hit_vit_rate_limit('registration:' || left(coalesce(p_identity, 'unavailable'), 80), 8) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT d.id INTO v_division_id FROM vit_course_divisions d WHERE d.curso_codigo = v_course AND d.codigo = v_division;
  IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_division_id::text, 0));
  IF (SELECT count(*) FROM vit_teams WHERE course_division_id = v_division_id) >= 2 THEN RETURN jsonb_build_object('ok', false, 'reason', 'capacity'); END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE lower(nombre_equipo) = lower(v_team_name)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name'); END IF;
  PERFORM 1 FROM vit_registration_codes WHERE codigo = v_code AND NOT usado AND NOT cancelado FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  INSERT INTO vit_teams (course_division_id, nombre_equipo, sistema_juego, tipo_cuatro_dos, color_remera, telefono)
  VALUES (v_division_id, v_team_name, payload->>'system', NULLIF(payload->>'systemType',''), trim(payload->>'color'), payload->>'phone')
  RETURNING id INTO v_team_id;
  INSERT INTO vit_players (id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT v_team_id, trim(item.player->>'name'), NULLIF(item.player->>'position',''),
    (item.ordinality - 1) >= v_starters, (payload->>'consent')::boolean, item.ordinality - 1
  FROM jsonb_array_elements(v_players) WITH ORDINALITY AS item(player, ordinality);
  UPDATE vit_registration_codes SET usado = true, id_equipo = v_team_id WHERE codigo = v_code AND NOT usado AND NOT cancelado;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration code was already used'; END IF;
  INSERT INTO vit_registration_requests (request_id, team_id) VALUES (v_request_id, v_team_id);
  RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION vit_public_norms()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'nombre', c.nombre, 'descripcion', c.descripcion, 'orden', c.orden,
    'normas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'slug', n.slug, 'titulo', n.titulo, 'resumen', n.resumen,
        'bloques', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'tipo', b.tipo, 'contenido', b.contenido, 'nivel', b.nivel_sangria,
          'alineacion', b.alineacion, 'tamano', b.tamano, 'color', b.color
        ) ORDER BY b.orden, b.id) FROM vit_norm_blocks b WHERE b.norm_id = n.id), '[]'::jsonb)
      ) ORDER BY n.orden, n.id) FROM vit_norms n WHERE n.category_id = c.id AND n.publicado
    ), '[]'::jsonb)
  ) ORDER BY c.orden, c.id) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb)
  FROM vit_norm_categories c WHERE c.activa
$$;

CREATE OR REPLACE FUNCTION vit_admin_dashboard(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('admin:read:' || left(coalesce(p_identity, 'unavailable'), 80), 90) THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
  RETURN jsonb_build_object(
    'teams', vit_team_list('ambos', true),
    'codes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'codigo', c.codigo, 'usado', c.usado, 'cancelado', c.cancelado, 'fecha_creacion', c.fecha_creacion,
      'id_equipo', c.id_equipo, 'equipo', t.nombre_equipo
    ) ORDER BY c.fecha_creacion DESC) FROM (SELECT * FROM vit_registration_codes ORDER BY fecha_creacion DESC LIMIT 300) c
    LEFT JOIN vit_teams t ON t.id = c.id_equipo), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION admin_generate_vit_codes(p_candidates jsonb, p_count integer, p_actor text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_code text; v_inserted text; v_created text[] := ARRAY[]::text[];
BEGIN
  IF NOT hit_vit_rate_limit('admin:codes-write:' || left(coalesce(p_identity, 'unavailable'), 80), 12) THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
  IF p_count < 1 OR p_count > 50 OR jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) < p_count OR jsonb_array_length(p_candidates) > 500 THEN RAISE EXCEPTION 'invalid code generation request'; END IF;
  FOR v_code IN SELECT jsonb_array_elements_text(p_candidates) LOOP
    IF v_code !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid code candidate'; END IF;
    v_inserted := NULL;
    INSERT INTO vit_registration_codes(codigo) VALUES (v_code) ON CONFLICT (codigo) DO NOTHING RETURNING codigo INTO v_inserted;
    IF v_inserted IS NOT NULL THEN v_created := array_append(v_created, v_inserted); END IF;
    EXIT WHEN cardinality(v_created) = p_count;
  END LOOP;
  IF cardinality(v_created) <> p_count THEN RAISE EXCEPTION 'not enough unique code candidates'; END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'codes.generate', 'registration_code', left(array_to_string(v_created, ','), 96), jsonb_build_object('count', cardinality(v_created)));
  RETURN jsonb_build_object('codes', to_jsonb(v_created));
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_vit_code(p_code text, p_action text, p_actor text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_updated text;
BEGIN
  IF NOT hit_vit_rate_limit('admin:codes-write:' || left(coalesce(p_identity, 'unavailable'), 80), 12) THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
  IF p_action = 'cancel' THEN
    UPDATE vit_registration_codes SET cancelado = true, usado = true WHERE codigo = p_code AND NOT usado AND NOT cancelado RETURNING codigo INTO v_updated;
  ELSIF p_action = 'mark-used' THEN
    UPDATE vit_registration_codes SET usado = true WHERE codigo = p_code AND NOT usado AND NOT cancelado RETURNING codigo INTO v_updated;
  ELSE RETURN jsonb_build_object('ok', false); END IF;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'code.' || p_action, 'registration_code', p_code, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_vit_team(p_team_id bigint, p_actor text, p_payload jsonb, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_player_count integer := jsonb_array_length(p_payload->'integrantes'); v_division_id smallint;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
  IF v_player_count < 6 OR v_player_count > 9 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_players'); END IF;
  IF v_player_count = 9 AND length(trim(coalesce(p_payload->>'justificacion_admin', ''))) < 8 THEN RETURN jsonb_build_object('ok', false, 'reason', 'ninth_player_justification'); END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE lower(nombre_equipo) = lower(trim(p_payload->>'nombre')) AND id <> p_team_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name'); END IF;
  SELECT id INTO v_division_id FROM vit_course_divisions WHERE curso_codigo = p_payload->>'curso' AND codigo = p_payload->>'division';
  IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;
  UPDATE vit_teams SET course_division_id = v_division_id, nombre_equipo = trim(p_payload->>'nombre'),
    sistema_juego = p_payload->>'sistema', tipo_cuatro_dos = NULLIF(p_payload->>'tipo', ''),
    color_remera = trim(p_payload->>'color'), telefono = p_payload->>'telefono',
    justificacion_admin = NULLIF(trim(p_payload->>'justificacion_admin'), '')
  WHERE id = p_team_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  DELETE FROM vit_players WHERE id_equipo = p_team_id;
  INSERT INTO vit_players(id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT p_team_id, trim(item.player->>'nombre'), NULLIF(item.player->>'posicion', ''),
    coalesce((item.player->>'suplente')::boolean, false), coalesce((item.player->>'autorizacion')::boolean, false), item.ordinality - 1
  FROM jsonb_array_elements(p_payload->'integrantes') WITH ORDINALITY AS item(player, ordinality);
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'team.update', 'team', p_team_id::text,
    jsonb_build_object('nombre', p_payload->>'nombre', 'curso', p_payload->>'curso', 'division', p_payload->>'division', 'integrantes', v_player_count));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION vit_admin_norm_categories(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('admin:norms-read:' || left(coalesce(p_identity, 'unavailable'), 80), 90) THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
  RETURN jsonb_build_object('categories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'slug', slug, 'nombre', nombre, 'descripcion', descripcion, 'orden', orden, 'activa', activa
  ) ORDER BY orden, id) FROM vit_norm_categories), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION admin_create_vit_norm_category(p_slug text, p_name text, p_description text, p_actor text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_category jsonb;
BEGIN
  IF NOT hit_vit_rate_limit('admin:norms-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vit-norm-category-order', 0));
  INSERT INTO vit_norm_categories(slug, nombre, descripcion, orden)
  VALUES (p_slug, p_name, p_description, (SELECT COALESCE(MAX(orden), -1) + 1 FROM vit_norm_categories))
  ON CONFLICT (slug) DO NOTHING
  RETURNING jsonb_build_object('id', id, 'slug', slug, 'nombre', nombre, 'descripcion', descripcion, 'orden', orden, 'activa', activa) INTO v_category;
  IF v_category IS NULL THEN RETURN jsonb_build_object('error', 'duplicate'); END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'norm-category.create', 'norm_category', v_category->>'id', jsonb_build_object('slug', p_slug));
  RETURN jsonb_build_object('category', v_category);
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'vit_norms_public_order_idx') THEN
    CREATE INDEX vit_norms_public_order_idx ON vit_norms(category_id, publicado, orden);
  END IF;
END $$;

ALTER FUNCTION vit_team_list(text, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION vit_registration_options(text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_public_teams(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_check_team_name(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION register_vit_team(jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_public_norms() SET search_path = public, pg_temp;
ALTER FUNCTION vit_admin_dashboard(text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_generate_vit_codes(jsonb, integer, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_update_vit_code(text, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_update_vit_team(bigint, text, jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_admin_norm_categories(text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_create_vit_norm_category(text, text, text, text, text) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION vit_team_list(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_registration_options(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_public_teams(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_check_team_name(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_vit_team(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_public_norms() FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_admin_dashboard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_generate_vit_codes(jsonb, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_vit_code(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_vit_team(bigint, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_admin_norm_categories(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_create_vit_norm_category(text, text, text, text, text) FROM PUBLIC;

DROP FUNCTION IF EXISTS register_vit_team(jsonb);
DROP FUNCTION IF EXISTS admin_update_vit_code(text, text, text);
DROP FUNCTION IF EXISTS admin_update_vit_team(bigint, text, jsonb);
