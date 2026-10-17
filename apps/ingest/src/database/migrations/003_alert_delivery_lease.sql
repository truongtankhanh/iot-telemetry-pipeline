-- Outbox lease (IMP-10.1): a worker that takes a row to deliver sets `locked_until` and releases the
-- database before it calls the command center. Another worker skips the row while the lease runs;
-- if the worker dies, the row becomes available again when it ends. NULL means not leased, so
-- existing rows and workers that do not know the column are unaffected.
ALTER TABLE alert_delivery ADD COLUMN locked_until timestamptz;
