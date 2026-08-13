-- 005_comment_targets.sql
--
-- A comment now says which part of the node it is about. The parts are the
-- seven sections a node page renders — the six required fields and the
-- division into children — plus 'node' for the node in general.
--
-- Three additions, no new table:
--
--   parts     which sections the comment targets. An array, because one
--             argument can be about the definition and the exclusions at
--             once. Every comment written before this migration was about
--             the node in general, which is exactly what the default says.
--   title     required of new comments, enforced by the API. Nullable here
--             because the comments that exist have none, and inventing
--             titles for them would put words in their authors' mouths.
--   evidence  a citation, a URL, or an atlas node path — an internal
--             cross-reference counts. Required of new comments, nullable
--             here for the same reason as title. The API checks it is
--             non-empty and distinct from the body; nothing anywhere checks
--             that it is a *good* source, because that is the reader's
--             judgement, not a constraint.
--
--     psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f 005_comment_targets.sql

SET LOCAL search_path = atlas, public;

ALTER TABLE atlas.comments
  ADD COLUMN parts    TEXT[] NOT NULL DEFAULT ARRAY['node'],
  ADD COLUMN title    TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200),
  ADD COLUMN evidence TEXT CHECK (evidence IS NULL OR char_length(evidence) BETWEEN 1 AND 1000);

-- The set is closed. A part that is not one of these is not a section a node
-- page has, so a comment claiming it would render nowhere.
ALTER TABLE atlas.comments
  ADD CONSTRAINT comments_parts_known CHECK (
    parts <> '{}'
    AND parts <@ ARRAY[
      'node', 'definition', 'inclusion', 'exclusion',
      'sources', 'boundary_cases', 'uncertainty', 'children'
    ]
  );
