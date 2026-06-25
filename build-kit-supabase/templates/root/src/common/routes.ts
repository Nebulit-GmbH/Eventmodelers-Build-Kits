import {Request, Response, Router} from 'express';
import {WebApiSetup} from "@event-driven-io/emmett-expressjs";
import {assertNotEmpty} from "../util/assertions";
import {replayProjection} from "./replay";
import {requireSysUser} from "../supabase/requireSysUser";


export const api =
    (
        // external dependencies
    ): WebApiSetup =>
        (router: Router): void => {

            router.post('/api/replay/:projection', async (req: Request, res: Response) => {
                // Replay is a privileged operational action — require a sys user.
                const {error} = await requireSysUser(req, res); // sends 401/403 on failure
                if (error) return;
                const projection = assertNotEmpty(req.params.projection)
                await replayProjection(projection)
                res.status(200).json({"projection":projection})
            });
        };

