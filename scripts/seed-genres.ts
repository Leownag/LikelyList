/**
 * Seeds public.genres from Ticketmaster's live /classifications endpoint.
 *
 * Run with: npm run seed:genres
 *
 * The genre IDs are read from the API rather than written into the codebase on
 * purpose — Ticketmaster publishes no genre ID table and third-party lists
 * contradict each other, so a hardcoded list would silently filter on the wrong
 * genre. Re-run this whenever the taxonomy might have shifted; it upserts.
 */

import { createTicketmasterClient } from "../src/lib/ticketmaster/client";
import { fetchMusicGenres } from "../src/lib/ticketmaster/classifications";
import { MUSIC_SEGMENT_ID } from "../src/lib/ticketmaster/types";
import { adminClientFromProcessEnv } from "./_shared";

async function main() {
  const supabase = adminClientFromProcessEnv();
  const client = createTicketmasterClient(process.env.TICKETMASTER_API_KEY ?? "");

  console.log(`Reading music genres (segment ${MUSIC_SEGMENT_ID})…`);
  const genres = await fetchMusicGenres(client);

  if (genres.length === 0) {
    throw new Error(
      "Ticketmaster returned no music genres. Check TICKETMASTER_API_KEY and try again — " +
        "seeding an empty taxonomy would leave every user unable to pick a genre.",
    );
  }

  const rows = genres.map((genre, index) => ({
    tm_genre_id: genre.tmGenreId,
    tm_segment_id: genre.tmSegmentId,
    name: genre.name,
    slug: genre.slug,
    sort_order: index,
  }));

  const { error } = await supabase
    .from("genres")
    .upsert(rows, { onConflict: "tm_genre_id" });

  if (error) throw new Error(`Upsert failed: ${error.message}`);

  console.log(`Seeded ${rows.length} genres:`);
  for (const row of rows) {
    console.log(`  ${row.tm_genre_id.padEnd(16)} ${row.name}`);
  }
  console.log(`\nTicketmaster requests used: ${client.requestCount()}`);
  console.log("Rate limit:", client.rateLimit());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
