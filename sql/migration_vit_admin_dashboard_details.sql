-- Agrega el curso y la división para identificar quién usó cada código.
CREATE OR REPLACE FUNCTION vit_admin_dashboard(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('admin:read:' || left(coalesce(p_identity, 'unavailable'), 80), 90) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  RETURN jsonb_build_object(
    'teams', vit_team_list('ambos', true),
    'codes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'codigo', c.codigo,
        'usado', c.usado,
        'cancelado', c.cancelado,
        'fecha_creacion', c.fecha_creacion,
        'id_equipo', c.id_equipo,
        'equipo', t.nombre_equipo,
        'curso', d.curso_codigo,
        'division', d.codigo
      ) ORDER BY c.fecha_creacion DESC)
      FROM (
        SELECT * FROM vit_registration_codes
        ORDER BY fecha_creacion DESC
        LIMIT 300
      ) c
      LEFT JOIN vit_teams t ON t.id = c.id_equipo
      LEFT JOIN vit_course_divisions d ON d.id = t.course_division_id
    ), '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION vit_admin_dashboard(text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_admin_dashboard(text) FROM PUBLIC;
