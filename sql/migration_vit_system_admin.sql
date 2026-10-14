-- Resumen de almacenamiento, auditoria y exportacion logica para el panel admin.
-- No exporta tablas de autenticacion, rate limits ni sesiones.
CREATE OR REPLACE FUNCTION vit_admin_system_snapshot(p_identity text, p_actor_email text, p_backup boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_names text[] := ARRAY[
    'vit_courses', 'vit_course_divisions', 'vit_teams', 'vit_players',
    'vit_registration_codes', 'vit_registration_requests', 'vit_norm_categories',
    'vit_norms', 'vit_norm_blocks', 'vit_admin_audit_logs'
  ];
  v_name text;
  v_bytes bigint;
  v_size bigint := pg_database_size(current_database());
  v_counts jsonb := '{}'::jsonb;
  v_sizes jsonb := '[]'::jsonb;
  v_audit jsonb;
  v_data jsonb;
  v_now timestamptz := now();
BEGIN
  IF NOT hit_vit_rate_limit(
    CASE WHEN p_backup THEN 'admin:system-backup:' ELSE 'admin:system-read:' END || left(coalesce(p_identity, 'unavailable'), 80),
    CASE WHEN p_backup THEN 3 ELSE 30 END
  ) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  IF p_backup THEN
    INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
    VALUES (left(coalesce(p_actor_email, 'admin'), 254), 'system.backup', 'database', current_database(),
            jsonb_build_object('format', 'LID JSON', 'scope', 'tournament data and audit'));
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    IF to_regclass('public.' || v_name) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_name) INTO v_bytes;
      v_counts := v_counts || jsonb_build_object(v_name, v_bytes);
      v_bytes := pg_total_relation_size(to_regclass('public.' || v_name));
      v_sizes := v_sizes || jsonb_build_array(jsonb_build_object('name', v_name, 'bytes', v_bytes));
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'actor_email', actor_email, 'action', action, 'entity_type', entity_type,
    'entity_id', entity_id, 'details', details, 'created_at', created_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM (SELECT actor_email, action, entity_type, entity_id, details, created_at
        FROM vit_admin_audit_logs ORDER BY created_at DESC LIMIT 100) recent;

  IF p_backup THEN
    SELECT jsonb_build_object(
      'vit_courses', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.codigo) FROM vit_courses t), '[]'::jsonb),
      'vit_course_divisions', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_course_divisions t), '[]'::jsonb),
      'vit_teams', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_teams t), '[]'::jsonb),
      'vit_players', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_players t), '[]'::jsonb),
      'vit_registration_codes', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.fecha_creacion, t.codigo) FROM vit_registration_codes t), '[]'::jsonb),
      'vit_registration_requests', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.request_id) FROM vit_registration_requests t), '[]'::jsonb),
      'vit_norm_categories', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_norm_categories t), '[]'::jsonb),
      'vit_norms', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_norms t), '[]'::jsonb),
      'vit_norm_blocks', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_norm_blocks t), '[]'::jsonb),
      'vit_admin_audit_logs', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vit_admin_audit_logs t), '[]'::jsonb)
    ) INTO v_data;
  END IF;

  RETURN jsonb_build_object(
    'database', current_database(), 'generated_at', v_now,
    'database_size_bytes', v_size, 'counts', v_counts, 'table_sizes', v_sizes,
    'audit', v_audit,
    'backup', CASE WHEN p_backup THEN jsonb_build_object(
      'format', 'lid-tournament-backup', 'version', 1, 'generated_at', v_now,
      'scope', 'Tournament application tables only; excludes authentication accounts and sessions, schema, and rate limits.',
      'counts', v_counts, 'data', v_data
    ) ELSE NULL END
  );
END;
$$;

ALTER FUNCTION vit_admin_system_snapshot(text, text, boolean) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_admin_system_snapshot(text, text, boolean) FROM PUBLIC;
