-- civilization_versions rows are immutable: replays re-simulate under the exact civ version
-- a match was played with. New behavior means a new version row, never an edit.
CREATE OR REPLACE FUNCTION civilization_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'civilization_versions rows are immutable (civ_id=%, version=%)', OLD.civ_id, OLD.version;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER civilization_versions_no_update
  BEFORE UPDATE OR DELETE ON civilization_versions
  FOR EACH ROW EXECUTE FUNCTION civilization_versions_immutable();
