import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      message: "Web console is disabled. Use CLI.",
    },
    { status: 410 },
  );
}
