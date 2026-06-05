import {createClient as createSupabaseClient} from '@supabase/supabase-js'
import {Request} from 'express'

let _serviceClient: ReturnType<typeof createSupabaseClient> | null = null;

export const createServiceClient = () => {
    if (!_serviceClient) {
        _serviceClient = createSupabaseClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SECRET_KEY!
        );
    }
    return _serviceClient;
}

/**
 * Creates a Supabase client for verifying JWT tokens
 * Used in backend API endpoints
 */
export default function createClient() {
    return createSupabaseClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        }
    )
}

/**
 * Creates an authenticated Supabase client with the user's JWT token
 * This ensures Row Level Security (RLS) policies are applied with the user's context
 */
export async function createAuthenticatedClient(req: Request) {
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    return createSupabaseClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
            global: {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
        }
    );
}