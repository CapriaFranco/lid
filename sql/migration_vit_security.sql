-- Pin functions to the expected schema and remove default PUBLIC execution.
-- The application connects as the database owner, which retains execution rights.
ALTER FUNCTION hit_vit_rate_limit(text, integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION register_vit_team(jsonb)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION hit_vit_rate_limit(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_vit_team(jsonb) FROM PUBLIC;
