ALTER TABLE vit_norms ADD COLUMN IF NOT EXISTS documento jsonb NOT NULL DEFAULT
  '{"type":"doc","content":[{"type":"paragraph","attrs":{"indent":0,"barColor":"#e01b84","textAlign":"left"}}]}'::jsonb;

UPDATE vit_norms n SET documento = jsonb_build_object('type', 'doc', 'content', (
  SELECT jsonb_agg(CASE WHEN b.tipo = 'heading' THEN jsonb_build_object(
    'type', 'heading',
    'attrs', jsonb_build_object('level', 2, 'indent', b.nivel_sangria,
      'barColor', CASE WHEN b.color IN ('#e01b84', '#0000ff', '#57ba86') THEN lower(b.color) ELSE '#e01b84' END,
      'textAlign', CASE WHEN b.alineacion IN ('left', 'center', 'right', 'justify') THEN b.alineacion ELSE 'left' END),
    'content', CASE WHEN length(trim(b.contenido)) = 0 THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', b.contenido)) END
  ) ELSE jsonb_build_object(
    'type', 'paragraph',
    'attrs', jsonb_build_object('indent', b.nivel_sangria,
      'barColor', CASE WHEN b.color IN ('#e01b84', '#0000ff', '#57ba86') THEN lower(b.color) ELSE '#e01b84' END,
      'textAlign', CASE WHEN b.alineacion IN ('left', 'center', 'right', 'justify') THEN b.alineacion ELSE 'left' END),
    'content', CASE WHEN length(trim(b.contenido)) = 0 THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', b.contenido)) END
  ) END ORDER BY b.orden, b.id)
  FROM vit_norm_blocks b WHERE b.norm_id = n.id
)) WHERE EXISTS (SELECT 1 FROM vit_norm_blocks b WHERE b.norm_id = n.id);

CREATE OR REPLACE FUNCTION vit_norm_document_valid(p_document jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
  v_valid boolean;
  v_bad_mark boolean;
  v_text_size integer;
BEGIN
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' THEN
    RETURN false;
  END IF;
  IF p_document->>'type' <> 'doc' OR jsonb_typeof(p_document->'content') <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_document->'content') < 1 OR jsonb_array_length(p_document->'content') > 1500
    OR (p_document - 'type' - 'content') <> '{}'::jsonb THEN
    RETURN false;
  END IF;
  WITH RECURSIVE nodes(node, parent_type, depth) AS (
    SELECT child, 'doc'::text, 1
    FROM jsonb_array_elements(p_document->'content') AS top(child)
    UNION ALL
    SELECT child, nodes.node->>'type', nodes.depth + 1
    FROM nodes
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(nodes.node->'content') = 'array' THEN nodes.node->'content' ELSE '[]'::jsonb END
    ) AS nested(child)
  )
  SELECT count(*), COALESCE(bool_and(COALESCE(CASE
    WHEN depth > 2 OR jsonb_typeof(node) <> 'object' THEN false
    WHEN parent_type = 'doc' THEN
      node->>'type' IN ('paragraph', 'heading')
      AND (NOT (node ? 'content') OR jsonb_typeof(node->'content') = 'array')
      AND jsonb_typeof(COALESCE(node->'attrs', '{}'::jsonb)) = 'object'
      AND COALESCE(node->'attrs'->>'indent', '0') ~ '^[0-4]$'
      AND COALESCE(node->'attrs'->>'barColor', '#e01b84') IN ('#e01b84', '#0000ff', '#57ba86')
      AND COALESCE(node->'attrs'->>'textAlign', 'left') IN ('left', 'center', 'right', 'justify')
      AND (node->'attrs' - 'indent' - 'barColor' - 'textAlign' - CASE WHEN node->>'type' = 'heading' THEN 'level' ELSE 'not-a-level' END) = '{}'::jsonb
      AND (node - 'type' - 'attrs' - 'content') = '{}'::jsonb
      AND (node->>'type' <> 'heading' OR COALESCE(node->'attrs'->>'level', '2') = '2')
    WHEN parent_type IN ('paragraph', 'heading') AND node->>'type' = 'text' THEN
      node ? 'text' AND jsonb_typeof(node->'text') = 'string'
      AND length(node->>'text') BETWEEN 1 AND 10000
      AND (node - 'type' - 'text' - 'marks') = '{}'::jsonb
      AND (NOT (node ? 'marks') OR jsonb_typeof(node->'marks') = 'array')
    WHEN parent_type IN ('paragraph', 'heading') AND node->>'type' = 'hardBreak' THEN
      (node - 'type') = '{}'::jsonb
    ELSE false
  END, false)), false)
  INTO v_count, v_valid FROM nodes;
  IF v_count > 4000 OR NOT v_valid THEN RETURN false; END IF;
  WITH RECURSIVE nodes(node) AS (
    SELECT child FROM jsonb_array_elements(p_document->'content') AS top(child)
    UNION ALL
    SELECT child FROM nodes
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(nodes.node->'content') = 'array' THEN nodes.node->'content' ELSE '[]'::jsonb END
    ) AS nested(child)
  )
  SELECT COALESCE(bool_or(
    (jsonb_typeof(node->'marks') IS NOT NULL AND jsonb_typeof(node->'marks') <> 'array')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(node->'marks') = 'array' THEN node->'marks' ELSE '[]'::jsonb END
      ) AS mark(value)
      WHERE jsonb_typeof(value) <> 'object'
        OR value->>'type' NOT IN ('bold', 'italic', 'underline', 'reference')
        OR (value - 'type') <> '{}'::jsonb
    )
  ), false) INTO v_bad_mark FROM nodes WHERE node->>'type' = 'text';
  IF v_bad_mark THEN RETURN false; END IF;
  WITH RECURSIVE nodes(node) AS (
    SELECT child FROM jsonb_array_elements(p_document->'content') AS top(child)
    UNION ALL
    SELECT child FROM nodes
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(nodes.node->'content') = 'array' THEN nodes.node->'content' ELSE '[]'::jsonb END
    ) AS nested(child)
  )
  SELECT COALESCE(sum(length(node->>'text')), 0) INTO v_text_size FROM nodes WHERE node->>'type' = 'text';
  RETURN v_text_size <= 100000;
END;
$$;

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
          'titulo', n.titulo, 'resumen', n.resumen, 'publicado', n.publicado,
          'orden', n.orden, 'documento', n.documento
        ) ORDER BY n.orden, n.id)
        FROM vit_norms n WHERE n.category_id = c.id
      ), '[]'::jsonb)
    ) ORDER BY c.orden, c.id)
    FROM vit_norm_categories c
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION vit_public_norms()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'nombre', c.nombre, 'descripcion', c.descripcion, 'orden', c.orden,
    'normas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'slug', n.slug, 'titulo', n.titulo, 'resumen', n.resumen,
        'documento', n.documento
      ) ORDER BY n.orden, n.id)
      FROM vit_norms n WHERE n.category_id = c.id AND n.publicado
    ), '[]'::jsonb)
  ) ORDER BY c.orden, c.id) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb)
  FROM vit_norm_categories c WHERE c.activa
$$;

DROP FUNCTION IF EXISTS admin_save_vit_norm(bigint, bigint, text, text, text, boolean, jsonb, text, text);
CREATE FUNCTION admin_save_vit_norm(
  p_norm_id bigint,
  p_category_id bigint,
  p_slug text,
  p_title text,
  p_summary text,
  p_published boolean,
  p_document jsonb,
  p_actor text,
  p_identity text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_norm_id bigint := p_norm_id;
  v_order integer;
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
     OR NOT vit_norm_document_valid(p_document) THEN
    RETURN jsonb_build_object('error', 'invalid_document');
  END IF;
  IF EXISTS (SELECT 1 FROM vit_norms WHERE slug = v_slug AND id <> coalesce(v_norm_id, -1)) THEN
    RETURN jsonb_build_object('error', 'duplicate_slug');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vit-norm-write:' || coalesce(v_norm_id::text, v_slug), 0));
  IF v_norm_id IS NULL THEN
    SELECT COALESCE(MAX(orden), -1) + 1 INTO v_order FROM vit_norms WHERE category_id = p_category_id;
    INSERT INTO vit_norms(category_id, slug, titulo, resumen, publicado, orden, documento)
      VALUES (p_category_id, v_slug, v_title, trim(coalesce(p_summary, '')), coalesce(p_published, false), v_order, p_document)
      RETURNING id INTO v_norm_id;
  ELSE
    UPDATE vit_norms SET category_id = p_category_id, slug = v_slug, titulo = v_title,
      resumen = trim(coalesce(p_summary, '')), publicado = coalesce(p_published, false),
      documento = p_document, updated_at = now()
      WHERE id = v_norm_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    DELETE FROM vit_norm_blocks WHERE norm_id = v_norm_id;
  END IF;
  INSERT INTO vit_admin_audit_logs(actor_email, action, entity_type, entity_id, details)
  VALUES (p_actor, CASE WHEN p_norm_id IS NULL THEN 'norm.create' ELSE 'norm.update' END,
    'norm', v_norm_id::text, jsonb_build_object('slug', v_slug, 'published', coalesce(p_published, false), 'document_bytes', octet_length(p_document::text)));
  RETURN jsonb_build_object('ok', true, 'id', v_norm_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'duplicate_slug');
END;
$$;

ALTER FUNCTION vit_admin_norm_categories(text) SET search_path = public, pg_temp;
ALTER FUNCTION vit_public_norms() SET search_path = public, pg_temp;
ALTER FUNCTION vit_norm_document_valid(jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION admin_save_vit_norm(bigint, bigint, text, text, text, boolean, jsonb, text, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_admin_norm_categories(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vit_norm_document_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_save_vit_norm(bigint, bigint, text, text, text, boolean, jsonb, text, text) FROM PUBLIC;
