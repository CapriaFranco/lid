CREATE OR REPLACE FUNCTION vit_admin_norm_categories(p_identity text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT hit_vit_rate_limit('admin:norms-read:' || left(coalesce(p_identity, 'unavailable'), 80), 90) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  RETURN jsonb_build_object('categories', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'nombre', c.nombre, 'descripcion', c.descripcion,
      'orden', c.orden, 'activa', c.activa,
      'normas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', n.id, 'category_id', n.category_id, 'slug', n.slug,
          'titulo', n.titulo, 'resumen', n.resumen, 'publicado', n.publicado, 'orden', n.orden,
          'bloques', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', b.id, 'tipo', b.tipo, 'contenido', b.contenido,
              'nivel', b.nivel_sangria, 'alineacion', b.alineacion,
              'tamano', b.tamano, 'color', b.color
            ) ORDER BY b.orden, b.id)
            FROM vit_norm_blocks b WHERE b.norm_id = n.id
          ), '[]'::jsonb)
        ) ORDER BY n.orden, n.id)
        FROM vit_norms n WHERE n.category_id = c.id
      ), '[]'::jsonb)
    ) ORDER BY c.orden, c.id)
    FROM vit_norm_categories c
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION admin_save_vit_norm(
  p_norm_id bigint,
  p_category_id bigint,
  p_slug text,
  p_title text,
  p_summary text,
  p_published boolean,
  p_blocks jsonb,
  p_actor text,
  p_identity text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_norm_id bigint := p_norm_id;
  v_order integer;
  v_block jsonb;
  v_block_index integer := 0;
  v_slug text := lower(trim(p_slug));
  v_title text := trim(p_title);
BEGIN
  IF NOT hit_vit_rate_limit('admin:norms-write:' || left(coalesce(p_identity, 'unavailable'), 80), 20) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  IF p_category_id IS NULL OR NOT EXISTS (SELECT 1 FROM vit_norm_categories WHERE id = p_category_id) THEN
    RETURN jsonb_build_object('error', 'invalid_category');
  END IF;
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) > 64
     OR length(v_title) < 2 OR length(v_title) > 120
     OR length(coalesce(p_summary, '')) > 300
     OR p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array'
     OR jsonb_array_length(p_blocks) > 150 THEN
    RETURN jsonb_build_object('error', 'invalid_content');
  END IF;
  IF coalesce(p_published, false) AND jsonb_array_length(p_blocks) = 0 THEN
    RETURN jsonb_build_object('error', 'invalid_content');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_norms WHERE slug = v_slug AND id <> coalesce(v_norm_id, -1)) THEN
    RETURN jsonb_build_object('error', 'duplicate_slug');
  END IF;
  FOR v_block IN SELECT element FROM jsonb_array_elements(p_blocks) AS blocks(element) LOOP
    IF jsonb_typeof(v_block) <> 'object'
      OR coalesce(v_block->>'tipo', '') NOT IN ('heading', 'paragraph', 'note')
      OR length(coalesce(v_block->>'contenido', '')) > 5000
      OR length(trim(coalesce(v_block->>'contenido', ''))) = 0
      OR coalesce(v_block->>'nivel', '') !~ '^[0-4]$'
      OR coalesce(v_block->>'alineacion', '') NOT IN ('left', 'center', 'right')
      OR coalesce(v_block->>'tamano', '') NOT IN ('small', 'normal', 'large')
      OR coalesce(v_block->>'color', '') NOT IN ('#e01b84', '#0000ff', '#57ba86') THEN
      RETURN jsonb_build_object('error', 'invalid_block');
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('vit-norm-write:' || coalesce(v_norm_id::text, v_slug), 0));
  IF v_norm_id IS NULL THEN
    SELECT COALESCE(MAX(orden), -1) + 1 INTO v_order FROM vit_norms WHERE category_id = p_category_id;
    INSERT INTO vit_norms(category_id, slug, titulo, resumen, publicado, orden)
      VALUES (p_category_id, v_slug, v_title, trim(coalesce(p_summary, '')), coalesce(p_published, false), v_order)
      RETURNING id INTO v_norm_id;
  ELSE
    UPDATE vit_norms SET category_id = p_category_id, slug = v_slug, titulo = v_title,
      resumen = trim(coalesce(p_summary, '')), publicado = coalesce(p_published, false), updated_at = now()
      WHERE id = v_norm_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    DELETE FROM vit_norm_blocks WHERE norm_id = v_norm_id;
  END IF;
  FOR v_block IN SELECT element FROM jsonb_array_elements(p_blocks) AS blocks(element) LOOP
    INSERT INTO vit_norm_blocks(norm_id, tipo, contenido, nivel_sangria, alineacion, tamano, color, orden)
    VALUES (
      v_norm_id, v_block->>'tipo', trim(v_block->>'contenido'), (v_block->>'nivel')::smallint,
      v_block->>'alineacion', v_block->>'tamano', v_block->>'color', v_block_index
    );
    v_block_index := v_block_index + 1;
  END LOOP;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, CASE WHEN p_norm_id IS NULL THEN 'norm.create' ELSE 'norm.update' END,
    'norm', v_norm_id::text, jsonb_build_object('slug', v_slug, 'published', coalesce(p_published, false), 'blocks', v_block_index));
  RETURN jsonb_build_object('ok', true, 'id', v_norm_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'duplicate_slug');
END;
$$;

ALTER FUNCTION vit_admin_norm_categories(text) SET search_path = public, pg_temp;
ALTER FUNCTION admin_save_vit_norm(bigint, bigint, text, text, text, boolean, jsonb, text, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_admin_norm_categories(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_save_vit_norm(bigint, bigint, text, text, text, boolean, jsonb, text, text) FROM PUBLIC;
