-- ============================================================
-- Processor dead-letter queue
-- ============================================================

CREATE TABLE public.processor_dlq (
                                      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                      processor_id TEXT NOT NULL,
                                      stream_id    TEXT NOT NULL,
                                      event        JSONB NOT NULL,
                                      error        TEXT NOT NULL,
                                      ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
