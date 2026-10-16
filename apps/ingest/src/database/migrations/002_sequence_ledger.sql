-- Sequence ledger (V1-T01): with `last_seq`, the holes still open in a device's sequence numbers,
-- as [[from, to, openedAtMs], ...], and the timestamp of the message that carried `last_seq` (a
-- lower sequence number newer than it is a device restart). Kept per device so every replica counts
-- gaps from the same state.
ALTER TABLE device ADD COLUMN seq_holes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE device ADD COLUMN seq_last_ts timestamptz;
