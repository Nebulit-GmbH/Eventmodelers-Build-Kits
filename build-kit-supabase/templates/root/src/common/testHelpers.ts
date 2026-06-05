import {execSync} from 'child_process';
import {readFileSync, writeFileSync, unlinkSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import knex from 'knex';

export async function runFlywayMigrations(connectionString: string): Promise<void> {
    const stubsPath = join(process.cwd(), 'supabase', 'migrations', '_V0__supabase_stubs.sql');
    const stubsSql = readFileSync(stubsPath, 'utf8');
    const db = knex({client: 'pg', connection: connectionString});
    try {
        await db.raw(stubsSql);
    } finally {
        await db.destroy();
    }

    const url = new URL(connectionString);
    const jdbcUrl = `jdbc:postgresql://${url.hostname}:${url.port || 5432}${url.pathname}`;
    const user = url.username;
    const password = url.password;

    const tempConfigPath = join(tmpdir(), `flyway-test-${Date.now()}.conf`);
    const migrationsPath = join(process.cwd(), 'supabase', 'migrations');

    const config = `
flyway.url=${jdbcUrl}
flyway.user=${user}
flyway.password=${password}
flyway.locations=filesystem:${migrationsPath}
flyway.schemas=public
flyway.placeholderReplacement=false
flyway.validateOnMigrate=true
flyway.cleanDisabled=false
`;

    try {
        writeFileSync(tempConfigPath, config, 'utf8');
        execSync(`flyway -configFiles=${tempConfigPath} migrate`, {
            stdio: 'pipe',
            encoding: 'utf8'
        });
    } catch (error: any) {
        console.error('Flyway migration failed:', error.message);
        if (error.stdout) console.error('STDOUT:', error.stdout);
        if (error.stderr) console.error('STDERR:', error.stderr);
        throw new Error(`Flyway migration failed: ${error.message}`);
    } finally {
        try {
            unlinkSync(tempConfigPath);
        } catch {
            // ignore
        }
    }
}