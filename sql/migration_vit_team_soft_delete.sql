-- Preserve removed teams for audit/recovery while releasing their division slot.
ALTER TABLE vit_teams
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;

CREATE INDEX IF NOT EXISTS vit_teams_active_division_idx
  ON vit_teams(course_division_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vit_teams_deleted_at_idx
  ON vit_teams(deleted_at DESC) WHERE deleted_at IS NOT NULL;
DROP INDEX IF EXISTS vit_teams_name_normalized_idx;
CREATE UNIQUE INDEX IF NOT EXISTS vit_teams_active_name_normalized_idx
  ON vit_teams(lower(nombre_equipo)) WHERE deleted_at IS NULL;

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
      'deleted_at', CASE WHEN p_admin THEN t.deleted_at END,
      'integrantes', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN p_admin THEN p.id END, 'nombre', p.nombre,
          'posicion', CASE WHEN p_admin THEN p.posicion ELSE COALESCE(p.posicion, '-') END,
          'suplente', p.suplente, 'autorizacion', p.autorizacion
        ) - CASE WHEN p_admin THEN ARRAY[]::text[] ELSE ARRAY['id']::text[] END)
        ORDER BY p.orden, p.id)
        FROM vit_players p WHERE p.id_equipo = t.id
      ), '[]'::jsonb)
    ) ORDER BY c.orden, d.orden, lower(t.nombre_equipo), t.id
  ), '[]'::jsonb)
  FROM vit_teams t
  JOIN vit_course_divisions d ON d.id = t.course_division_id
  JOIN vit_courses c ON c.codigo = d.curso_codigo
  WHERE (p_admin OR t.deleted_at IS NULL)
    AND (p_cycle = 'ambos' OR c.ciclo = p_cycle)
$$;

CREATE OR REPLACE FUNCTION vit_registration_options(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('capacity:' || left(coalesce(p_identity, 'unavailable'), 80), 60) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object(
    'capacities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('curso', capacity_rows.curso, 'division', capacity_rows.division, 'cantidad', capacity_rows.cantidad)
        ORDER BY capacity_rows.course_order, capacity_rows.division_order)
      FROM (
        SELECT c.codigo AS curso, d.codigo AS division, c.orden AS course_order, d.orden AS division_order,
          count(t.id) FILTER (WHERE t.deleted_at IS NULL)::integer AS cantidad
        FROM vit_course_divisions d
        JOIN vit_courses c ON c.codigo = d.curso_codigo
        LEFT JOIN vit_teams t ON t.course_division_id = d.id
        GROUP BY c.codigo, d.codigo, c.orden, d.orden
      ) capacity_rows
    ), '[]'::jsonb),
    'colors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ciclo', color_rows.ciclo, 'color', color_rows.color)
        ORDER BY color_rows.ciclo, color_rows.color)
      FROM (
        SELECT c.ciclo, min(trim(t.color_remera)) AS color
        FROM vit_teams t
        JOIN vit_course_divisions d ON d.id = t.course_division_id
        JOIN vit_courses c ON c.codigo = d.curso_codigo
        WHERE t.deleted_at IS NULL
        GROUP BY c.ciclo, lower(trim(t.color_remera))
      ) color_rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION vit_check_team_name(p_name text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_names jsonb;
BEGIN
  IF NOT hit_vit_rate_limit('name-check:' || left(coalesce(p_identity, 'unavailable'), 80), 30) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nombre', q.nombre_equipo, 'exact', q.exact)
    ORDER BY q.exact DESC, lower(q.nombre_equipo)), '[]'::jsonb)
  INTO v_names
  FROM (
    SELECT nombre_equipo, lower(nombre_equipo) = lower(trim(p_name)) AS exact
    FROM vit_teams
    WHERE deleted_at IS NULL
      AND (lower(nombre_equipo) = lower(trim(p_name))
        OR similarity(lower(nombre_equipo), lower(trim(p_name))) > 0.35)
    ORDER BY (lower(nombre_equipo) = lower(trim(p_name))) DESC, lower(nombre_equipo)
    LIMIT 5
  ) q;
  RETURN jsonb_build_object(
    'exists', COALESCE((SELECT bool_or((item.value->>'exact')::boolean)
      FROM jsonb_array_elements(v_names) AS item(value)), false),
    'similar', COALESCE((SELECT jsonb_agg(item.value->>'nombre')
      FROM jsonb_array_elements(v_names) AS item(value)
      WHERE NOT (item.value->>'exact')::boolean), '[]'::jsonb)
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
  IF v_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', true);
  END IF;
  IF NOT hit_vit_rate_limit('registration:' || left(coalesce(p_identity, 'unavailable'), 80), 8) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  IF v_code !~ '^[A-Z0-9]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  SELECT d.id INTO v_division_id FROM vit_course_divisions d
  WHERE d.curso_codigo = v_course AND d.codigo = v_division;
  IF v_division_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_division_id::text, 0));
  IF (SELECT count(*) FROM vit_teams WHERE course_division_id = v_division_id AND deleted_at IS NULL) >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capacity');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE deleted_at IS NULL AND lower(nombre_equipo) = lower(v_team_name)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;
  PERFORM 1 FROM vit_registration_codes
  WHERE codigo = v_code AND NOT usado AND NOT cancelado FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;

  INSERT INTO vit_teams (course_division_id, nombre_equipo, sistema_juego, tipo_cuatro_dos, color_remera, telefono)
  VALUES (v_division_id, v_team_name, payload->>'system', NULLIF(payload->>'systemType',''), trim(payload->>'color'), payload->>'phone')
  RETURNING id INTO v_team_id;
  INSERT INTO vit_players (id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT v_team_id, trim(item.player->>'name'), NULLIF(item.player->>'position',''),
    (item.ordinality - 1) >= v_starters, false, item.ordinality - 1
  FROM jsonb_array_elements(v_players) WITH ORDINALITY AS item(player, ordinality);
  UPDATE vit_registration_codes SET usado = true, id_equipo = v_team_id
  WHERE codigo = v_code AND NOT usado AND NOT cancelado;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration code was already used'; END IF;
  INSERT INTO vit_registration_requests (request_id, team_id) VALUES (v_request_id, v_team_id);
  RETURN jsonb_build_object('ok', true, 'teamId', v_team_id, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION admin_patch_vit_team(p_team_id bigint, p_actor text, p_changes jsonb, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_team jsonb := COALESCE(p_changes->'team', '{}'::jsonb);
  v_players jsonb := COALESCE(p_changes->'players', '{}'::jsonb);
  v_item jsonb;
  v_current_course text;
  v_current_division text;
  v_current_system text;
  v_current_type text;
  v_final_course text;
  v_final_division text;
  v_final_system text;
  v_final_type text;
  v_division_id smallint;
  v_count integer;
  v_final_count integer;
  v_expected integer;
  v_changed integer;
  v_roster_structure boolean := COALESCE(jsonb_array_length(v_players->'add'), 0) > 0
    OR COALESCE(jsonb_array_length(v_players->'deleteIds'), 0) > 0;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  SELECT d.curso_codigo, d.codigo, t.sistema_juego, t.tipo_cuatro_dos
  INTO v_current_course, v_current_division, v_current_system, v_current_type
  FROM vit_teams t JOIN vit_course_divisions d ON d.id = t.course_division_id
  WHERE t.id = p_team_id AND t.deleted_at IS NULL FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_final_course := COALESCE(v_team->>'curso', v_current_course);
  v_final_division := COALESCE(v_team->>'division', v_current_division);
  v_final_system := COALESCE(v_team->>'sistema', v_current_system);
  v_final_type := CASE WHEN v_team ? 'tipo' THEN v_team->>'tipo' ELSE v_current_type END;
  IF (v_final_system = '4:2' AND (v_final_type IS NULL OR v_final_type NOT IN ('c', 'o')))
    OR (v_final_system <> '4:2' AND v_final_type IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_system_type');
  END IF;
  IF (v_final_course IN ('1ro', '2do', '3ro') AND v_final_division NOT IN ('A', 'B', 'C'))
    OR (v_final_course IN ('4to', '5to', '6to', '7mo') AND v_final_division NOT IN ('1ra', '2da')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division');
  END IF;
  IF v_team ? 'nombre' AND EXISTS (
    SELECT 1 FROM vit_teams
    WHERE deleted_at IS NULL AND lower(nombre_equipo) = lower(trim(v_team->>'nombre')) AND id <> p_team_id
  ) THEN RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name'); END IF;

  SELECT id INTO v_division_id FROM vit_course_divisions
  WHERE curso_codigo = v_final_course AND codigo = v_final_division;
  IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;
  SELECT count(*) INTO v_count FROM vit_players WHERE id_equipo = p_team_id;
  v_final_count := v_count + COALESCE(jsonb_array_length(v_players->'add'), 0)
    - COALESCE(jsonb_array_length(v_players->'deleteIds'), 0);
  IF v_roster_structure AND (v_final_count < 6 OR v_final_count > 9) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_roster');
  END IF;
  IF v_roster_structure AND v_final_count = 9 AND length(trim(COALESCE(
    v_team->>'justificacion_admin', (SELECT justificacion_admin FROM vit_teams WHERE id = p_team_id), ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ninth_player_justification');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_players->'update', '[]'::jsonb)) AS changed(item)
    WHERE NOT EXISTS (SELECT 1 FROM vit_players p WHERE p.id = (changed.item->>'id')::bigint AND p.id_equipo = p_team_id)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_players->'deleteIds', '[]'::jsonb)) AS deleted(id)
    WHERE NOT EXISTS (SELECT 1 FROM vit_players p WHERE p.id = deleted.id::bigint AND p.id_equipo = p_team_id)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_players->'deleteIds', '[]'::jsonb)) deleted(id)
    JOIN jsonb_array_elements(COALESCE(v_players->'update', '[]'::jsonb)) changed(item)
      ON deleted.id::bigint = (changed.item->>'id')::bigint
  ) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found_player'); END IF;

  IF v_team <> '{}'::jsonb THEN
    UPDATE vit_teams SET
      course_division_id = CASE WHEN v_team ? 'curso' OR v_team ? 'division' THEN v_division_id ELSE course_division_id END,
      nombre_equipo = CASE WHEN v_team ? 'nombre' THEN trim(v_team->>'nombre') ELSE nombre_equipo END,
      sistema_juego = CASE WHEN v_team ? 'sistema' THEN v_final_system ELSE sistema_juego END,
      tipo_cuatro_dos = CASE WHEN v_team ? 'tipo' THEN v_final_type ELSE tipo_cuatro_dos END,
      color_remera = CASE WHEN v_team ? 'color' THEN trim(v_team->>'color') ELSE color_remera END,
      telefono = CASE WHEN v_team ? 'telefono' THEN v_team->>'telefono' ELSE telefono END,
      justificacion_admin = CASE WHEN v_team ? 'justificacion_admin' THEN NULLIF(trim(v_team->>'justificacion_admin'), '') ELSE justificacion_admin END
    WHERE id = p_team_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_players->'update', '[]'::jsonb)) LOOP
    UPDATE vit_players SET
      nombre = CASE WHEN v_item->'changes' ? 'nombre' THEN trim(v_item->'changes'->>'nombre') ELSE nombre END,
      posicion = CASE WHEN v_item->'changes' ? 'posicion'
        THEN CASE WHEN v_final_system = '6:0' THEN NULL ELSE NULLIF(v_item->'changes'->>'posicion', '') END ELSE posicion END,
      suplente = CASE WHEN v_item->'changes' ? 'suplente' THEN (v_item->'changes'->>'suplente')::boolean ELSE suplente END,
      autorizacion = CASE WHEN v_item->'changes' ? 'autorizacion' THEN (v_item->'changes'->>'autorizacion')::boolean ELSE autorizacion END,
      orden = CASE WHEN v_item->'changes' ? 'orden' THEN (v_item->'changes'->>'orden')::integer ELSE orden END
    WHERE id = (v_item->>'id')::bigint AND id_equipo = p_team_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found_player'); END IF;
  END LOOP;
  IF COALESCE(jsonb_array_length(v_players->'deleteIds'), 0) > 0 THEN
    DELETE FROM vit_players p USING jsonb_array_elements_text(v_players->'deleteIds') AS deleted(id)
    WHERE p.id = deleted.id::bigint AND p.id_equipo = p_team_id;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_expected := jsonb_array_length(v_players->'deleteIds');
    IF v_changed <> v_expected THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found_player'); END IF;
  END IF;
  INSERT INTO vit_players(id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT p_team_id, trim(item.player->>'nombre'),
    CASE WHEN v_final_system = '6:0' THEN NULL ELSE NULLIF(item.player->>'posicion', '') END,
    (item.player->>'suplente')::boolean, (item.player->>'autorizacion')::boolean, (item.player->>'orden')::integer
  FROM jsonb_array_elements(COALESCE(v_players->'add', '[]'::jsonb)) AS item(player);

  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'team.update', 'team', p_team_id::text, jsonb_build_object(
    'team_fields', COALESCE((SELECT jsonb_agg(key) FROM jsonb_object_keys(v_team) AS keys(key)), '[]'::jsonb),
    'players_updated', COALESCE(jsonb_array_length(v_players->'update'), 0),
    'players_added', COALESCE(jsonb_array_length(v_players->'add'), 0),
    'players_deleted', COALESCE(jsonb_array_length(v_players->'deleteIds'), 0)
  ));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_vit_team(p_team_id bigint, p_actor text, p_payload jsonb, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_player_count integer := jsonb_array_length(p_payload->'integrantes'); v_division_id smallint;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  IF v_player_count < 6 OR v_player_count > 9 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_players'); END IF;
  IF v_player_count = 9 AND length(trim(coalesce(p_payload->>'justificacion_admin', ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ninth_player_justification');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE deleted_at IS NULL
    AND lower(nombre_equipo) = lower(trim(p_payload->>'nombre')) AND id <> p_team_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;
  SELECT id INTO v_division_id FROM vit_course_divisions
  WHERE curso_codigo = p_payload->>'curso' AND codigo = p_payload->>'division';
  IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;
  UPDATE vit_teams SET course_division_id = v_division_id,
    nombre_equipo = trim(p_payload->>'nombre'), sistema_juego = p_payload->>'sistema',
    tipo_cuatro_dos = NULLIF(p_payload->>'tipo', ''), color_remera = trim(p_payload->>'color'),
    telefono = p_payload->>'telefono', justificacion_admin = NULLIF(trim(p_payload->>'justificacion_admin'), '')
  WHERE id = p_team_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  DELETE FROM vit_players WHERE id_equipo = p_team_id;
  INSERT INTO vit_players(id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT p_team_id, trim(item.player->>'nombre'),
    CASE WHEN p_payload->>'sistema' = '6:0' THEN NULL ELSE NULLIF(item.player->>'posicion', '') END,
    coalesce((item.player->>'suplente')::boolean, false), coalesce((item.player->>'autorizacion')::boolean, false), item.ordinality - 1
  FROM jsonb_array_elements(p_payload->'integrantes') WITH ORDINALITY AS item(player, ordinality);
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'team.update', 'team', p_team_id::text,
    jsonb_build_object('nombre', p_payload->>'nombre', 'curso', p_payload->>'curso', 'division', p_payload->>'division', 'integrantes', v_player_count));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_soft_delete_vit_team(p_team_id bigint, p_actor text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_name text; v_deleted_at timestamptz;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  SELECT nombre_equipo INTO v_name FROM vit_teams WHERE id = p_team_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  UPDATE vit_teams SET deleted_at = now(), deleted_by = left(coalesce(p_actor, 'admin'), 254)
  WHERE id = p_team_id AND deleted_at IS NULL RETURNING deleted_at INTO v_deleted_at;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (left(coalesce(p_actor, 'admin'), 254), 'team.soft_delete', 'team', p_team_id::text,
    jsonb_build_object('nombre', v_name, 'deleted_at', v_deleted_at, 'capacity_released', true));
  RETURN jsonb_build_object('ok', true, 'deleted_at', v_deleted_at);
END;
$$;

CREATE OR REPLACE FUNCTION admin_restore_vit_team(p_team_id bigint, p_actor text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_name text; v_division_id smallint; v_limit integer;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  SELECT nombre_equipo, course_division_id INTO v_name, v_division_id
  FROM vit_teams WHERE id = p_team_id AND deleted_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_division_id::text, 0));
  SELECT COALESCE(exact.max_teams, course.max_teams, 2)::integer INTO v_limit
  FROM vit_course_divisions d
  LEFT JOIN vit_capacity_overrides exact ON exact.course_code = d.curso_codigo AND exact.division_code = d.codigo
  LEFT JOIN vit_capacity_overrides course ON course.course_code = d.curso_codigo AND course.division_code IS NULL
  WHERE d.id = v_division_id;
  IF (SELECT count(*) FROM vit_teams WHERE course_division_id = v_division_id AND deleted_at IS NULL) >= COALESCE(v_limit, 2) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capacity');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE deleted_at IS NULL AND id <> p_team_id
    AND lower(nombre_equipo) = lower(v_name)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;
  UPDATE vit_teams SET deleted_at = NULL, deleted_by = NULL WHERE id = p_team_id AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (left(coalesce(p_actor, 'admin'), 254), 'team.restore', 'team', p_team_id::text,
    jsonb_build_object('nombre', v_name, 'capacity_claimed', true));
  RETURN jsonb_build_object('ok', true);
END;
$$;

ALTER FUNCTION vit_team_list(text, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION vit_registration_options(text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_check_team_name(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION register_vit_team(jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_patch_vit_team(bigint, text, jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_update_vit_team(bigint, text, jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_soft_delete_vit_team(bigint, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_restore_vit_team(bigint, text, text) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION vit_team_list(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_registration_options(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_check_team_name(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_vit_team(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_patch_vit_team(bigint, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_vit_team(bigint, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_soft_delete_vit_team(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_restore_vit_team(bigint, text, text) FROM PUBLIC;
