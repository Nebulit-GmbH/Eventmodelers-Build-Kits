import knex, {Knex} from "knex";
import pg from "pg";

export const postgresUrl = process.env.SUPABASE_DB_URL ?? "missing-url"

let knexInstance: Knex | null = null;
let sharedPool: pg.Pool | null = null;

export const getKnexInstance = (): Knex => {
    if (!knexInstance) {
        knexInstance = knex({
            client: 'pg',
            connection: postgresUrl,
            pool: { min: 0, max: 5 },
        });
    }
    return knexInstance;
};

export const getSharedPool = (): pg.Pool => {
    if (!sharedPool) {
        sharedPool = new pg.Pool({ connectionString: postgresUrl, max: 5 });
    }
    return sharedPool;
};

export const closeDb = async (): Promise<void> => {
    await knexInstance?.destroy();
    await sharedPool?.end();
    knexInstance = null;
    sharedPool = null;
};