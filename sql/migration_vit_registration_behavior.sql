-- Separates school consent from per-player documentary authorization.
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
  IF (SELECT count(*) FROM vit_teams WHERE course_division_id = v_division_id) >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capacity');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_teams WHERE lower(nombre_equipo) = lower(v_team_name)) THEN
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

ALTER FUNCTION register_vit_team(jsonb, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION register_vit_team(jsonb, text) FROM PUBLIC;
