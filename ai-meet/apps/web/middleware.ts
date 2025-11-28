import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = req.nextUrl;

  // If user is logged in and tries to access /login, redirect to home
  if (pathname === '/login') {
    if (token) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Protect /meeting and /mypage routes
  if (pathname.startsWith('/meeting') || pathname === '/mypage') {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/meeting/:path*', '/mypage'],
};
