-- A lost join response can be retried using the same pre-join cookie.
CREATE TABLE group_join_secret (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  secret BLOB NOT NULL
);
INSERT INTO group_join_secret (id, secret) VALUES (1, randomblob(32));
