-- Restoring an archived team must recover its slot even when that exceeds
-- the current configured limit. New registrations remain guarded separately.
CREATE OR REPLACE FUNCTION admin_restore_vit_team(p_team_id bigint, p_actor text, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_name text;
  v_division_id smallint;
  v_limit integer;
  v_active_count integer;
  v_capacity_exceeded boolean;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  SELECT nombre_equipo, course_division_id
    INTO v_name, v_division_id
  FROM vit_teams
  WHERE id = p_team_id AND deleted_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('division:' || v_division_id::text, 0));

  SELECT COALESCE(exact.max_teams, course.max_teams, 2)::integer
    INTO v_limit
  FROM vit_course_divisions d
  LEFT JOIN vit_capacity_overrides exact
    ON exact.course_code = d.curso_codigo AND exact.division_code = d.codigo
  LEFT JOIN vit_capacity_overrides course
    ON course.course_code = d.curso_codigo AND course.division_code IS NULL
  WHERE d.id = v_division_id;
  v_limit := COALESCE(v_limit, 2);

  IF EXISTS (
    SELECT 1 FROM vit_teams
    WHERE deleted_at IS NULL AND id <> p_team_id
      AND lower(nombre_equipo) = lower(v_name)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;

  UPDATE vit_teams
  SET deleted_at = NULL, deleted_by = NULL
  WHERE id = p_team_id AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT count(*)::integer INTO v_active_count
  FROM vit_teams
  WHERE course_division_id = v_division_id AND deleted_at IS NULL;
  v_capacity_exceeded := v_active_count > v_limit;

  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (
    left(coalesce(p_actor, 'admin'), 254), 'team.restore', 'team', p_team_id::text,
    jsonb_build_object(
      'nombre', v_name,
      'capacity_claimed', true,
      'capacity_exceeded', v_capacity_exceeded,
      'active_count', v_active_count,
      'limit', v_limit
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'capacityExceeded', v_capacity_exceeded,
    'activeCount', v_active_count,
    'limit', v_limit
  );
END;
$$;

ALTER FUNCTION admin_restore_vit_team(bigint, text, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION admin_restore_vit_team(bigint, text, text) FROM PUBLIC;
