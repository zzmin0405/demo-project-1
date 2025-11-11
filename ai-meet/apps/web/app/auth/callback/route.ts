import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    try {
      const supabase = createRouteHandlerClient({ cookies });
      await supabase.auth.exchangeCodeForSession(code);
    } catch (error) {
      console.error(error);
      // Redirect to an error page or back to login with an error message
      const errorUrl = new URL('/login', request.url);
      errorUrl.searchParams.set('error', 'Could not exchange code for session');
      if (error instanceof Error) {
        errorUrl.searchParams.set('error_description', error.message);
      }
      return NextResponse.redirect(errorUrl);
    }
  }

  // On success, redirect to the home page, cleaning the URL
  const successUrl = new URL('/', request.url);
  successUrl.search = ''; // Remove query parameters like ?code=...
  return NextResponse.redirect(successUrl);
}
