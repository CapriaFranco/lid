-- Return the effective and occupied capacity for every course/division slot.
CREATE OR REPLACE FUNCTION vit_admin_capacity_settings(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('admin:capacity-read:' || left(coalesce(p_identity, 'unavailable'), 80), 60) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object(
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('course', course_code, 'division', division_code,
        'limit', max_teams, 'updated_at', updated_at) ORDER BY course_code, division_code NULLS FIRST)
      FROM vit_capacity_overrides
    ), '[]'::jsonb),
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('course', x.course, 'division', x.division,
        'active', x.active, 'limit', x.max_teams, 'source', x.source)
        ORDER BY x.course_order, x.division_order)
      FROM (
        SELECT c.codigo AS course, d.codigo AS division, c.orden AS course_order,
          d.orden AS division_order,
          count(t.id) FILTER (WHERE t.deleted_at IS NULL)::integer AS active,
          COALESCE(exact.max_teams, course.max_teams, 2)::integer AS max_teams,
          CASE WHEN exact.max_teams IS NOT NULL THEN 'division'
            WHEN course.max_teams IS NOT NULL THEN 'course' ELSE 'default' END AS source
        FROM vit_course_divisions d
        JOIN vit_courses c ON c.codigo = d.curso_codigo
        LEFT JOIN vit_teams t ON t.course_division_id = d.id
        LEFT JOIN vit_capacity_overrides exact ON exact.course_code = c.codigo AND exact.division_code = d.codigo
        LEFT JOIN vit_capacity_overrides course ON course.course_code = c.codigo AND course.division_code IS NULL
        GROUP BY c.codigo, d.codigo, c.orden, d.orden, exact.max_teams, course.max_teams
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION vit_admin_capacity_settings(text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_admin_capacity_settings(text) FROM PUBLIC;
