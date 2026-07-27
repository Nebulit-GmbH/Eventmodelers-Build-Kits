import {Request, Response} from 'express';
import {requireUser} from './requireUser';

type RequireSysUserResult = {
    user: any;
    error: null;
} | {
    user: null;
    error: string;
};

/**
 * Requires the caller to be an authenticated system ("sys") user.
 *
 * Sys privileges are carried in the admin-controlled `app_metadata` claim.
 * `app_metadata` can only be set via the service role / Supabase admin API and
 * never by the end user, which makes it the correct place for privileged roles.
 * A user is "sys" if `app_metadata.role === 'sys'` or `app_metadata.roles`
 * includes 'sys'.
 *
 * If you instead model sys users in a table, swap the claim check below for a
 * lookup using the service client (see requireOrgaAdmin.ts for the table pattern).
 */
export async function requireSysUser(req: Request, res: Response): Promise<RequireSysUserResult> {
    // Verifies the JWT and sends 401 if missing/invalid.
    const {user, error} = await requireUser(req, res);
    if (error || !user) {
        return {user: null, error: error || 'UNAUTHORIZED'};
    }

    const meta = user.app_metadata ?? {};
    const isSys = meta.role === 'sys' || (Array.isArray(meta.roles) && meta.roles.includes('sys'));

    if (!isSys) {
        res.status(403).json({error: 'Forbidden: system user permissions required'});
        return {user: null, error: 'FORBIDDEN'};
    }

    return {user, error: null};
}
