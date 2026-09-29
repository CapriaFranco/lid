CREATE OR REPLACE FUNCTION vit_norm_document_valid(p_document jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
  v_valid boolean;
  v_bad_mark boolean;
  v_text_size integer;
BEGIN
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' THEN RETURN false; END IF;
  IF p_document->>'type' <> 'doc' OR jsonb_typeof(p_document->'content') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_document->'content') < 1 OR jsonb_array_length(p_document->'content') > 1500
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_document) AS root_key(name) WHERE name NOT IN ('type', 'content')) THEN RETURN false; END IF;
  WITH RECURSIVE nodes(node, parent_type, depth) AS (
    SELECT child, 'doc'::text, 1 FROM jsonb_array_elements(p_document->'content') AS top(child)
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
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(node->'attrs') = 'object' THEN node->'attrs' ELSE '{}'::jsonb END) AS attr(name)
        WHERE name NOT IN ('indent', 'barColor', 'textAlign', CASE WHEN node->>'type' = 'heading' THEN 'level' ELSE 'not-a-level' END))
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(node) = 'object' THEN node ELSE '{}'::jsonb END) AS node_key(name)
        WHERE name NOT IN ('type', 'attrs', 'content'))
      AND (node->>'type' <> 'heading' OR COALESCE(node->'attrs'->>'level', '2') = '2')
    WHEN parent_type IN ('paragraph', 'heading') AND node->>'type' = 'text' THEN
      node ? 'text' AND jsonb_typeof(node->'text') = 'string'
      AND length(node->>'text') BETWEEN 1 AND 10000
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(node) AS node_key(name) WHERE name NOT IN ('type', 'text', 'marks'))
      AND (NOT (node ? 'marks') OR jsonb_typeof(node->'marks') = 'array')
    WHEN parent_type IN ('paragraph', 'heading') AND node->>'type' = 'hardBreak' THEN
      NOT EXISTS (SELECT 1 FROM jsonb_object_keys(node) AS node_key(name) WHERE name <> 'type')
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
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}'::jsonb END) AS mark_key(name) WHERE name <> 'type')
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

ALTER FUNCTION vit_norm_document_valid(jsonb) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vit_norm_document_valid(jsonb) FROM PUBLIC;
