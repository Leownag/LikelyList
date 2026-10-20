"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_CITY_SLUG,
  guessCitySlug,
  guessTimezone,
  pointForCitySlug,
} from "@/lib/region";
import { TIMEZONES } from "@/lib/time";

/**
 * Reads the visitor's region from the browser.
 *
 * `useSyncExternalStore` rather than an effect that calls setState. The obvious
 * shape — detect in useEffect, store the result in state — triggers a cascading
 * render on every mount and is what `react-hooks/set-state-in-effect` exists to
 * catch. This hook is the intended tool for the situation: the value lives in an
 * external system (the browser's own locale settings), it never changes during a
 * session, and there is a sensible server snapshot.
 *
 * The snapshots are computed once and cached at module scope because
 * `getSnapshot` runs on every render and must return a referentially identical
 * value each time, or React will loop.
 */

const NO_OP_UNSUBSCRIBE = () => {};

/** A timezone does not change mid-session, so there is nothing to subscribe to. */
function subscribe(): () => void {
  return NO_OP_UNSUBSCRIBE;
}

let cachedCitySlug: string | null = null;
function getCitySnapshot(): string {
  cachedCitySlug ??= guessCitySlug();
  return cachedCitySlug;
}

let cachedTimezone: string | null = null;
function getTimezoneSnapshot(): string {
  cachedTimezone ??= guessTimezone(TIMEZONES);
  return cachedTimezone;
}

let cachedPoint: { latitude: number; longitude: number } | null | undefined;
function getPointSnapshot(): { latitude: number; longitude: number } | null {
  if (cachedPoint === undefined) cachedPoint = pointForCitySlug(getCitySnapshot());
  return cachedPoint;
}

/** Nothing to order by until the browser has told us anything. */
function getServerPointSnapshot(): null {
  return null;
}

/** The server has no idea where the visitor is; it renders the default. */
function getServerCitySnapshot(): string {
  return DEFAULT_CITY_SLUG;
}

function getServerTimezoneSnapshot(): string {
  return "America/New_York";
}

/**
 * The slug of the seeded city that best matches the browser's timezone.
 *
 * Always a guess — `America/New_York` covers Maine to Florida — so callers should
 * show it and let it be changed rather than relying on it silently.
 */
export function useDetectedCitySlug(): string {
  return useSyncExternalStore(
    subscribe,
    getCitySnapshot,
    getServerCitySnapshot,
  );
}

/**
 * Roughly where the reader is, from the same timezone guess.
 *
 * Exists so a search box can put nearby places first. Deliberately not
 * `navigator.geolocation`: ordering a dropdown does not justify a permission
 * prompt, and a guess at metro scale is all the ordering needs.
 *
 * Cached at module scope like the others — `getSnapshot` runs on every render
 * and must return a referentially identical value or React loops.
 */
export function useDetectedPoint(): { latitude: number; longitude: number } | null {
  return useSyncExternalStore(subscribe, getPointSnapshot, getServerPointSnapshot);
}

export function useDetectedTimezone(): string {
  return useSyncExternalStore(
    subscribe,
    getTimezoneSnapshot,
    getServerTimezoneSnapshot,
  );
}
