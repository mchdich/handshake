import { NextResponse, type NextRequest } from "next/server";

// Every visitor gets a private demo workspace, so judges never see each other's contracts.
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get("hs_ws")) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    res.cookies.set("hs_ws", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    req.cookies.set("hs_ws", id);
    return NextResponse.next({ request: { headers: new Headers(req.headers) }, headers: res.headers });
  }
  return res;
}

export const config = { matcher: ["/((?!_next|favicon).*)"] };
