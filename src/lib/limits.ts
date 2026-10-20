/**
 * Product caps that both a server action and the control in front of it need.
 *
 * Their natural home would be beside the action that enforces them, but a
 * `"use server"` file may only export async functions — exporting a number from
 * one makes every page that imports it fail at runtime with "a 'use server'
 * file can only export async functions". So they live here, in a module with no
 * directive, and the action imports them like anything else.
 */

/**
 * How many Census places one account may follow.
 *
 * Not a preference — a cost. The planner makes one Ticketmaster call per
 * distinct grid cell each week against a 5000/day budget the whole audience
 * shares, so an unbounded follow list is a way for one account to spend
 * everyone's quota. The curated grid is bounded by being a list of 43; this
 * path is open to 32,329 places and needs its own ceiling.
 */
export const FOLLOWED_PLACE_LIMIT = 10;
