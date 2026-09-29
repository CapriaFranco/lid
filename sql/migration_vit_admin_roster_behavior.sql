-- Normaliza las posiciones heredadas al guardar equipos con sistema 6:0.
CREATE OR REPLACE FUNCTION admin_update_vit_team(p_team_id bigint, p_actor text, p_payload jsonb, p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_player_count integer := jsonb_array_length(p_payload->'integrantes'); v_division_id smallint;
BEGIN
  IF NOT hit_vit_rate_limit('admin:teams-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  IF v_player_count < 6 OR v_player_count > 9 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_players');
  END IF;
  IF v_player_count = 9 AND length(trim(coalesce(p_payload->>'justificacion_admin', ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ninth_player_justification');
  END IF;
  IF EXISTS (
    SELECT 1 FROM vit_teams
    WHERE lower(nombre_equipo) = lower(trim(p_payload->>'nombre')) AND id <> p_team_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  END IF;
  SELECT id INTO v_division_id FROM vit_course_divisions
  WHERE curso_codigo = p_payload->>'curso' AND codigo = p_payload->>'division';
  IF v_division_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_division');
  END IF;

  UPDATE vit_teams
  SET course_division_id = v_division_id,
      nombre_equipo = trim(p_payload->>'nombre'),
      sistema_juego = p_payload->>'sistema',
      tipo_cuatro_dos = NULLIF(p_payload->>'tipo', ''),
      color_remera = trim(p_payload->>'color'),
      telefono = p_payload->>'telefono',
      justificacion_admin = NULLIF(trim(p_payload->>'justificacion_admin'), '')
  WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  DELETE FROM vit_players WHERE id_equipo = p_team_id;
  INSERT INTO vit_players(id_equipo, nombre, posicion, suplente, autorizacion, orden)
  SELECT p_team_id,
         trim(item.player->>'nombre'),
         CASE WHEN p_payload->>'sistema' = '6:0' THEN NULL
              ELSE NULLIF(item.player->>'posicion', '') END,
         coalesce((item.player->>'suplente')::boolean, false),
         coalesce((item.player->>'autorizacion')::boolean, false),
         item.ordinality - 1
  FROM jsonb_array_elements(p_payload->'integrantes') WITH ORDINALITY AS item(player, ordinality);

  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, 'team.update', 'team', p_team_id::text,
          jsonb_build_object('nombre', p_payload->>'nombre', 'curso', p_payload->>'curso',
                             'division', p_payload->>'division', 'integrantes', v_player_count));
  RETURN jsonb_build_object('ok', true);
END;
$$;

ALTER FUNCTION admin_update_vit_team(bigint, text, jsonb, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION admin_update_vit_team(bigint, text, jsonb, text) FROM PUBLIC;
