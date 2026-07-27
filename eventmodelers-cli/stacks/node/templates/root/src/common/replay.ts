import {PostgreSQLProjectionDefinition, rebuildPostgreSQLProjections} from "@event-driven-io/emmett-postgresql";
import {postgresUrl} from "./db";
import {glob} from "glob";
import path from "path";

const slicesRoot = path.resolve(__dirname, '../slices');

export const replayProjection = async (projectionName: string): Promise<void> => {
    const [filePath] = await glob(`**/${projectionName}.{ts|js}`, {cwd: slicesRoot, absolute: true});
    if (!filePath) throw new Error(`Projection not found: ${projectionName}`);

    const projectionImport = await import(filePath);
    const projection: PostgreSQLProjectionDefinition = projectionImport[projectionName];

    return rebuildPostgreSQLProjections({projection, connectionString: postgresUrl}).start();
}