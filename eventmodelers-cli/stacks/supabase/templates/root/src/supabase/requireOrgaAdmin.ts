import {Response} from 'express';
import {SupabaseClient} from '@supabase/supabase-js';

type RequireOrgaAdminResult = {
    ok: true;
    error: null;
} | {
    ok: false;
    error: string;
};

export async function requireOrgaAdmin(
    supabase: SupabaseClient,
    orgaId: string,
    userId: string,
    res: Response,
): Promise<RequireOrgaAdminResult> {
    const {data, error} = await supabase
        .from('user_organizations')
        .select('role')
        .eq('orga_id', orgaId)
        .eq('user_id', userId)
        .eq('role', 'admin')
        .single();

    if (error || !data) {
        res.status(403).json({error: 'Forbidden: admin role required'});
        return {ok: false, error: 'FORBIDDEN'};
    }

    return {ok: true, error: null};
}
