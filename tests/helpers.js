import { NextRequest } from "next/server";

export function req(path, { method = "GET", body, cookie, origin = "http://localhost", ip } = {}) {
  const headers = { host: "localhost" };
  if (ip) headers["x-forwarded-for"] = ip;
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest("http://localhost" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function cookieDe(res) {
  const sc = res.headers.get("set-cookie") || "";
  return sc.split(";")[0];
}
