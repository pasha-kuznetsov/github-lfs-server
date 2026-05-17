import { exports } from "cloudflare:workers";

export function get(path: string, init?: RequestInit) {
  return exports.default.fetch(new Request(`http://w${path}`, init));
}

export function postForm(path: string, body: URLSearchParams) {
  return exports.default.fetch(
    new Request(`http://w${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
}
