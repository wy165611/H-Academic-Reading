import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_BASE = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

async function proxyRequest(
  req: NextRequest,
  context: { params: { path: string[] } }
) {
  const pathSegments = context.params.path || [];
  const targetPath = pathSegments.join("/");
  const search = req.nextUrl.search || "";
  const targetUrl = `${BACKEND_BASE}/api/${targetPath}${search}`;

  const forwardHeaders = new Headers();
  const passthroughHeaders = [
    "authorization",
    "content-type",
    "cookie",
    "range",
    "accept",
    "user-agent",
  ];
  for (const name of passthroughHeaders) {
    const val = req.headers.get(name);
    if (val) forwardHeaders.set(name, val);
  }

  const init: RequestInit & { duplex?: string } = {
    method: req.method,
    headers: forwardHeaders,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(req.method) && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const respHeaders = new Headers();
    const copyBack = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
      "set-cookie",
      "content-disposition",
    ];
    for (const h of copyBack) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return Response.json(
      { detail: `无法连接后端服务: ${String(err)}` },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
export async function OPTIONS(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxyRequest(req, ctx);
}
