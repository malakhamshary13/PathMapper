import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. Explicitly allow the sign-in and sign-up pages to be viewed publicly
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)', 
  '/sign-up(.*)'
]);

export default clerkMiddleware(async (auth, request) => {
  // 2. Protect everything else. If they aren't on sign-in or sign-up, force them to log in.
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Next.js 14 compatible matcher
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};