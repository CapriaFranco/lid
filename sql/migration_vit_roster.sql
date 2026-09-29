ALTER TABLE vit_players
  ADD COLUMN IF NOT EXISTS autorizacion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orden integer;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY id_equipo ORDER BY id)::integer - 1 AS position
  FROM vit_players
)
UPDATE vit_players AS player
SET orden = numbered.position
FROM numbered
WHERE player.id = numbered.id AND player.orden IS NULL;

ALTER TABLE vit_players
  ALTER COLUMN orden SET NOT NULL,
  ALTER COLUMN orden SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS vit_players_team_order_idx
  ON vit_players(id_equipo, orden, id);

ALTER TABLE vit_players
  DROP CONSTRAINT IF EXISTS vit_players_autorizacion_equipo_check;
ALTER TABLE vit_teams
  DROP COLUMN IF EXISTS autorizacion;
