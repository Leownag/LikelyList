import { redirect } from "next/navigation";

/**
 * Kept only as a redirect.
 *
 * Screenshot import now lives as a section of /app/subscriptions, but this URL is
 * already sitting in every digest email that has been sent, so it cannot simply stop
 * existing. The fragment lands the reader on the section rather than the top of a page
 * that is now four screens long.
 */
export default function FeedsPage() {
  redirect("/app/subscriptions#screenshots");
}
