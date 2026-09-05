-- Backing tables for the distributed-lock leader election (EVENTHANDLER_LOCK, used by JdbcLockRegistry)
-- and the durable event-handling checkpoint (EVENTHANDLER_PROGRESS, used by JdbcProgressTracker) —
-- see com.example.quickstart.config.CqrsConfiguration. Verified against OpenCQRS's own reference
-- application (framework-spring-boot-autoconfigure); portable as-is to PostgreSQL.
CREATE TABLE IF NOT EXISTS EVENTHANDLER_LOCK (
    LOCK_KEY CHAR(36) NOT NULL,
    REGION VARCHAR(100) NOT NULL,
    CLIENT_ID CHAR(36),
    CREATED_DATE TIMESTAMP NOT NULL,
    EXPIRED_AFTER TIMESTAMP NOT NULL,
    CONSTRAINT EVENTHANDLER_LOCK_PK PRIMARY KEY (LOCK_KEY, REGION)
);

CREATE TABLE IF NOT EXISTS EVENTHANDLER_PROGRESS (
    GROUP_KEY VARCHAR(100) NOT NULL,
    PARTITION_ID BIGINT NOT NULL,
    EVENT_ID VARCHAR(100) NOT NULL,
    CONSTRAINT EVENTHANDLER_PROGRESS_PK PRIMARY KEY (GROUP_KEY, PARTITION_ID)
);
