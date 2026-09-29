-- Clears school-consent values mistakenly copied into player authorization.
-- Teams with an audited admin edit retain their individually reviewed status.
UPDATE vit_players AS player
SET autorizacion = false
WHERE player.autorizacion
  AND NOT EXISTS (
    SELECT 1
    FROM vit_admin_audit_logs AS audit
    WHERE audit.action = 'team.update'
      AND audit.entity_type = 'team'
      AND audit.entity_id = player.id_equipo::text
  );
