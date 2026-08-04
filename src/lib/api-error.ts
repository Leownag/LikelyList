import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { DEV_MODE_COOKIE, isDevMode } from "@/lib/dev-mode";
import { AppError, errorBody, errorStatus } from "@/lib/errors";

/**
 * The single place a route turns a thrown thing into a response.
 *
 * Always logs the raw error server-side, and only ever *responds* with the raw
 * error when the caller is in dev mode. Keeping both halves here means a new route
 * cannot accidentally forget the filtering and leak an upstream message, which is
 * how "400 Unsupported value: 'temperature' does not support 0" ended up in front
 * of a reader.
 */
export async function errorResponse(
  request: NextRequest,
  error: unknown,
): Promise<NextResponse> {
  const env = readEnv();

  // Logged unconditionally. The response is filtered; observability is not.
  const label = error instanceof AppError ? error.code : "UNEXPECTED";
  console.error(`[${label}] ${request.method} ${request.nextUrl.pathname}`, error);

  const devMode = await isDevMode({
    cookieValue: request.cookies.get(DEV_MODE_COOKIE)?.value,
    secret: env.cronSecret,
  });

  return NextResponse.json(errorBody(error, devMode), {
    status: errorStatus(error),
  });
}

/** Whether this request should be shown codes and detail. */
export async function requestIsDevMode(request: NextRequest): Promise<boolean> {
  const env = readEnv();
  return isDevMode({
    cookieValue: request.cookies.get(DEV_MODE_COOKIE)?.value,
    secret: env.cronSecret,
  });
}
