export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { id: process.env.NEXT_PUBLIC_BUILD_ID ?? '' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
