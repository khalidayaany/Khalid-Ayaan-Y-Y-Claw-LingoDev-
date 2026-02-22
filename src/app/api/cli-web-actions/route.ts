import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    disabled: true,
    message: "Web action API disabled. Use CLI mode.",
    actions: [],
  });
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      error: "Web action API is disabled.",
    },
    { status: 410 },
  );
}
