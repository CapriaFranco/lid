-- Administrative capacity exceptions. Division-specific settings override course-wide settings.
CREATE TABLE IF NOT EXISTS vit_capacity_overrides (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_code text NOT NULL REFERENCES vit_courses(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  division_code text,
  max_teams smallint NOT NULL CHECK (max_teams BETWEEN 2 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (division_code IS NULL OR division_code IN ('A','B','C','1ra','2da'))
);
CREATE UNIQUE INDEX IF NOT EXISTS vit_capacity_overrides_course_idx
  ON vit_capacity_overrides(course_code) WHERE division_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vit_capacity_overrides_division_idx
  ON vit_capacity_overrides(course_code, division_code) WHERE division_code IS NOT NULL;

CREATE OR REPLACE FUNCTION vit_registration_options(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('capacity:' || left(coalesce(p_identity, 'unavailable'), 80), 60) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object(
    'capacities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('curso', x.curso, 'division', x.division,
        'cantidad', x.cantidad, 'limite', x.limite) ORDER BY x.course_order, x.division_order)
      FROM (
        SELECT c.codigo AS curso, d.codigo AS division, c.orden AS course_order,
          d.orden AS division_order, count(t.id) FILTER (WHERE t.deleted_at IS NULL)::integer AS cantidad,
          COALESCE(exact.max_teams, course.max_teams, 2)::integer AS limite
        FROM vit_course_divisions d
        JOIN vit_courses c ON c.codigo = d.curso_codigo
        LEFT JOIN vit_teams t ON t.course_division_id = d.id
        LEFT JOIN vit_capacity_overrides exact ON exact.course_code = c.codigo AND exact.division_code = d.codigo
        LEFT JOIN vit_capacity_overrides course ON course.course_code = c.codigo AND course.division_code IS NULL
        GROUP BY c.codigo, d.codigo, c.orden, d.orden, exact.max_teams, course.max_teams
      ) x
    ), '[]'::jsonb),
    'colors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ciclo', x.ciclo, 'color', x.color) ORDER BY x.ciclo, x.color)
      FROM (
        SELECT c.ciclo, min(trim(t.color_remera)) AS color
        FROM vit_teams t JOIN vit_course_divisions d ON d.id = t.course_division_id
        JOIN vit_courses c ON c.codigo = d.curso_codigo
        WHERE t.deleted_at IS NULL
        GROUP BY c.ciclo, lower(trim(t.color_remera))
      ) x
    ), '[]'::jsonb)
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
  v_limit integer;
  v_players jsonb := payload->'players';
  v_starters integer := (payload->>'starterCount')::integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('request:' || v_request_id::text, 0));
  SELECT team_id INTO v_team_id FROM vit_registration_requests WHERE request_id = v_request_id;
  IF v_team_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', true); END IF;
  IF NOT hit_vit_rate_limit('registration:' || left(coalesce(p_identity, 'unavailable'), 80), 8) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  IF v_code !~ '^[A-Z0-9]{6}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  SELECT d.id INTO v_division_id FROM vit_course_divisions d
    WHERE d.curso_codigo = v_course AND d.codigo = v_division;
  IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_division_id::text, 0));
  SELECT COALESCE(exact.max_teams, course.max_teams, 2)::integer INTO v_limit
  FROM vit_course_divisions d
  LEFT JOIN vit_capacity_overrides exact ON exact.course_code = d.curso_codigo AND exact.division_code = d.codigo
  LEFT JOIN vit_capacity_overrides course ON course.course_code = d.curso_codigo AND course.division_code IS NULL
  WHERE d.id = v_division_id;
  IF (SELECT count(*) FROM vit_teams WHERE course_division_id = v_division_id AND deleted_at IS NULL) >= v_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capacity');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE deleted_at IS NULL AND lower(nombre_equipo) = lower(v_team_name)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;
  PERFORM 1 FROM vit_registration_codes WHERE codigo = v_code AND NOT usado AND NOT cancelado FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  INSERT INTO vit_teams (course_division_id, nombre_equipo, sistema_juego, tipo_cuatro_dos, color_remera, telefono)
  VALUES (v_division_id, v_team_name, payload->>'system', NULLIF(payload->>'systemType',''), trim(payload->>'color'), payload->>'phone')
  RETURNING id INTO v_team_id;
  INSERT INTO vit_players (id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT v_team_id, trim(item.player->>'name'), NULLIF(item.player->>'position',''),
    (item.ordinality - 1) >= v_starters, false, item.ordinality - 1
  FROM jsonb_array_elements(v_players) WITH ORDINALITY AS item(player, ordinality);
  UPDATE vit_registration_codes SET usado = true, id_equipo = v_team_id WHERE codigo = v_code AND NOT usado AND NOT cancelado;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration code was already used'; END IF;
  INSERT INTO vit_registration_requests (request_id, team_id) VALUES (v_request_id, v_team_id);
  RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION vit_admin_capacity_settings(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('admin:capacity-read:' || left(coalesce(p_identity, 'unavailable'), 80), 60) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object('rules', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('course', course_code, 'division', division_code, 'limit', max_teams,
      'updated_at', updated_at) ORDER BY course_code, division_code NULLS FIRST)
    FROM vit_capacity_overrides
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION vit_admin_set_capacity_override(
  p_course text, p_division text, p_limit integer, p_actor text, p_identity text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_cycle text; v_division_id smallint;
BEGIN
  IF NOT hit_vit_rate_limit('admin:capacity-write:' || left(coalesce(p_identity, 'unavailable'), 80), 30) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  SELECT ciclo INTO v_cycle FROM vit_courses WHERE codigo = p_course;
  IF v_cycle IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_course'); END IF;
  IF p_division IS NOT NULL THEN
    SELECT id INTO v_division_id FROM vit_course_divisions WHERE curso_codigo = p_course AND codigo = p_division;
    IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_division_id::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('capacity-course:' || p_course, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('division:' || id::text, 0))
      FROM vit_course_divisions WHERE curso_codigo = p_course ORDER BY id;
  END IF;
  IF p_limit IS NULL THEN
    DELETE FROM vit_capacity_overrides WHERE course_code = p_course
      AND division_code IS NOT DISTINCT FROM p_division;
  ELSE
    IF p_limit NOT BETWEEN 2 AND 5 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_limit'); END IF;
    IF p_division IS NULL THEN
      INSERT INTO vit_capacity_overrides(course_code, division_code, max_teams, updated_at)
        VALUES (p_course, NULL, p_limit, now())
      ON CONFLICT (course_code) WHERE division_code IS NULL
        DO UPDATE SET max_teams = EXCLUDED.max_teams, updated_at = now();
    ELSE
      INSERT INTO vit_capacity_overrides(course_code, division_code, max_teams, updated_at)
        VALUES (p_course, p_division, p_limit, now())
      ON CONFLICT (course_code, division_code) WHERE division_code IS NOT NULL
        DO UPDATE SET max_teams = EXCLUDED.max_teams, updated_at = now();
    END IF;
  END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (left(coalesce(p_actor, 'admin'), 254), CASE WHEN p_limit IS NULL THEN 'capacity.override_removed' ELSE 'capacity.override_saved' END,
    'course_division', p_course || COALESCE(':' || p_division, ''),
    jsonb_build_object('limit', p_limit, 'scope', CASE WHEN p_division IS NULL THEN 'course' ELSE 'division' END));
  RETURN jsonb_build_object('ok', true);
END;
$$;

ALTER FUNCTION vit_registration_options(text) SET search_path = public, pg_temp;
ALTER FUNCTION register_vit_team(jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_admin_capacity_settings(text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_admin_set_capacity_override(text, text, integer, text, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_registration_options(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_vit_team(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_admin_capacity_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_admin_set_capacity_override(text, text, integer, text, text) FROM PUBLIC;
