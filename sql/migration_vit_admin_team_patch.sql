-- Applies only admin-edited team fields and player fields, preserving untouched legacy data.
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
  v_roster_structure boolean := COALESCE(jsonb_array_length(v_players->'add'), 0) > 0 OR COALESCE(jsonb_array_length(v_players->'deleteIds'), 0) > 0;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  SELECT d.curso_codigo, d.codigo, t.sistema_juego, t.tipo_cuatro_dos
  INTO v_current_course, v_current_division, v_current_system, v_current_type
  FROM vit_teams t JOIN vit_course_divisions d ON d.id = t.course_division_id
  WHERE t.id = p_team_id FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_final_course := COALESCE(v_team->>'curso', v_current_course);
  v_final_division := COALESCE(v_team->>'division', v_current_division);
  v_final_system := COALESCE(v_team->>'sistema', v_current_system);
  v_final_type := CASE WHEN v_team ? 'tipo' THEN v_team->>'tipo' ELSE v_current_type END;
  IF (v_final_system = '4:2' AND (v_final_type IS NULL OR v_final_type NOT IN ('c', 'o'))) OR (v_final_system <> '4:2' AND v_final_type IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_system_type');
  END IF;
  IF (v_final_course IN ('1ro', '2do', '3ro') AND v_final_division NOT IN ('A', 'B', 'C'))
     OR (v_final_course IN ('4to', '5to', '6to', '7mo') AND v_final_division NOT IN ('1ra', '2da')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division');
  END IF;

  IF v_team ? 'nombre' AND EXISTS (
    SELECT 1 FROM vit_teams WHERE lower(nombre_equipo) = lower(trim(v_team->>'nombre')) AND id <> p_team_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;

  SELECT id INTO v_division_id FROM vit_course_divisions
  WHERE curso_codigo = v_final_course AND codigo = v_final_division;
  IF v_division_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division'); END IF;

  SELECT count(*) INTO v_count FROM vit_players WHERE id_equipo = p_team_id;
  v_final_count := v_count + COALESCE(jsonb_array_length(v_players->'add'), 0) - COALESCE(jsonb_array_length(v_players->'deleteIds'), 0);
  IF v_roster_structure AND (v_final_count < 6 OR v_final_count > 9) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_roster');
  END IF;
  IF v_roster_structure AND v_final_count = 9 AND length(trim(COALESCE(v_team->>'justificacion_admin', (SELECT justificacion_admin FROM vit_teams WHERE id = p_team_id), ''))) < 8 THEN
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
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found_player');
  END IF;

  IF v_team <> '{}'::jsonb THEN
    UPDATE vit_teams SET
      course_division_id = CASE WHEN v_team ? 'curso' OR v_team ? 'division' THEN v_division_id ELSE course_division_id END,
      nombre_equipo = CASE WHEN v_team ? 'nombre' THEN trim(v_team->>'nombre') ELSE nombre_equipo END,
      sistema_juego = CASE WHEN v_team ? 'sistema' THEN v_final_system ELSE sistema_juego END,
      tipo_cuatro_dos = CASE WHEN v_team ? 'tipo' THEN v_final_type ELSE tipo_cuatro_dos END,
      color_remera = CASE WHEN v_team ? 'color' THEN trim(v_team->>'color') ELSE color_remera END,
      telefono = CASE WHEN v_team ? 'telefono' THEN v_team->>'telefono' ELSE telefono END,
      justificacion_admin = CASE WHEN v_team ? 'justificacion_admin' THEN NULLIF(trim(v_team->>'justificacion_admin'), '') ELSE justificacion_admin END
    WHERE id = p_team_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_players->'update', '[]'::jsonb)) LOOP
    UPDATE vit_players SET
      nombre = CASE WHEN v_item->'changes' ? 'nombre' THEN trim(v_item->'changes'->>'nombre') ELSE nombre END,
      posicion = CASE WHEN v_item->'changes' ? 'posicion' THEN
        CASE WHEN v_final_system = '6:0' THEN NULL ELSE NULLIF(v_item->'changes'->>'posicion', '') END
        ELSE posicion END,
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

ALTER FUNCTION admin_patch_vit_team(bigint, text, jsonb, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION admin_patch_vit_team(bigint, text, jsonb, text) FROM PUBLIC;
