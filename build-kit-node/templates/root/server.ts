import {join} from 'path';
import {getApplication, startAPI, WebApiSetup} from '@event-driven-io/emmett-expressjs';
import {glob} from "glob";
import express, {Application, Request, Response} from 'express';
import {jsonBigIntReplacer} from './src/util/sanitize';
import {closeDb} from "./src/common/db";
import swaggerUi from 'swagger-ui-express'
import {specs} from './src/swagger';
import cors from 'cors';
import {findEventstore} from "./src/common/loadPostgresEventstore";
import {PostgresEventStore} from "@event-driven-io/emmett-postgresql";

async function startServer() {

    const eventStore = await findEventstore()
    const slicesBase = join(__dirname, 'dist/src/slices');
    const routesPattern = join(slicesBase, '**/routes{,-*}.js');

    const routeFiles = await glob(routesPattern, {nodir: true});
    console.log('Found route files:', routeFiles);

    const processorPattern = join(slicesBase, '**/processor{,-*}.js');
    const processorFiles = await glob(processorPattern, {nodir: true});
    console.log('Found processor files:', processorFiles);

    const commonPattern = join(__dirname, 'src/common/routes{,-*}.@(ts|js)');
    const commonRouteFiles = await glob(commonPattern, {nodir: true});
    console.log('Found common route files:', commonRouteFiles);


    const rootApp: Application = express();
    rootApp.set('json replacer', jsonBigIntReplacer);

    const corsOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) ?? ['http://localhost:3000', 'http://localhost:3001'];
    rootApp.use(cors({
        origin: corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Content-Encoding',  'accept-encoding', 'Authorization','x-user-id','x-causation-id','x-correlation-id']
    }));

    const webApis: WebApiSetup[] = [];

    for (const file of routeFiles.concat(commonRouteFiles)) {
        const webApiModule: { api: () => WebApiSetup } = await import(file);
        if (typeof webApiModule.api == 'function') {
            var module = webApiModule.api()
            webApis.push(module);
        } else {
            console.error(`Expected api function to be defined in ${file}`);
        }
    }

    const startedProcessors: Array<{ stop: () => Promise<void> }> = [];

    for (const processorFile of processorFiles) {
        const processor: { processor: { start: (eventStore: PostgresEventStore) => Promise<void>; stop: () => Promise<void> } } = await import(processorFile);
        if (typeof processor.processor.start == "function") {
            console.log(`starting processor ${processorFile}`)
            processor.processor.start(eventStore).catch(err => console.error(`Processor ${processorFile} failed:`, err));
            startedProcessors.push(processor.processor);
        }
    }

    const shutdown = async (signal: string) => {
        console.log(`${signal} received, shutting down processors...`);
        await Promise.allSettled(startedProcessors.map(p => p.stop()));
        await eventStore.close();
        await closeDb();
        console.log('shutdown complete');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Get the main application from emmett
    const childApp: Application = getApplication({
        apis: webApis,
        disableJsonMiddleware: false,
        enableDefaultExpressEtag: true,
    });
    childApp.set('json replacer', jsonBigIntReplacer);

    // Swagger UI endpoints
    childApp.use('/api-docs', swaggerUi.serve);
    childApp.get('/api-docs', swaggerUi.setup(specs, {
        swaggerOptions: {
            urls: [
                {
                    url: '/swagger.json',
                    name: 'JSON',
                },
            ],
        },
    }));

    // OpenAPI spec endpoint
    childApp.get('/swagger.json', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
    });

    const port = parseInt(process.env.PORT || '3000', 10);
    console.log(`> Ready on port ${port}`);

    rootApp.use((req: Request, _res: Response, next) => {
        console.log(`[${req.method}] ${req.path}`);
        next();
    });

    rootApp.use(express.json());


    rootApp.use(childApp)
    // Start the main application
    startAPI(rootApp, {port: port});

    process.on('unhandledRejection', (reason, promise) => {
        console.error('⛔ Unhandled Rejection:', reason);
        if (reason instanceof Error && reason.stack) {
            console.error('Stack trace:\n', reason.stack);
        }
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});