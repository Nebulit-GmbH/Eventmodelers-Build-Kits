import {Request, Response, Router} from 'express';
import {WebApiSetup} from "@event-driven-io/emmett-expressjs";
import {assertNotEmpty} from "../util/assertions";
import {replayProjection} from "./replay";


export const api =
    (
        // external dependencies
    ): WebApiSetup =>
        (router: Router): void => {

            router.post('/api/replay/:projection', async (req: Request, res: Response) => {
                const projection = assertNotEmpty(req.params.projection)
                await replayProjection(projection)
                res.status(200).json({"projection":projection})
            });
        };

