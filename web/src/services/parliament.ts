import type { Motion, ParliamentFeed, SourceRef } from "../types";

/**
 * Parliamentary records: motions, votes, bills and debates. The Tweede Kamer publishes these as open data
 * (Gegevensmagazijn, OData v4). This service is the seam where that feed plugs in; until it is connected the UI
 * shows an explicit "not connected" state instead of invented records.
 */
export const TK_OPEN_DATA: SourceRef = {
  name: "Tweede Kamer Gegevensmagazijn (open data)",
  url: "https://opendata.tweedekamer.nl/",
  verification: "verified",
};

export async function fetchMotions(_filter: { partyId?: string; topicId?: string; personId?: string }): Promise<ParliamentFeed<Motion>> {
  return { status: "not_connected", items: [], source: TK_OPEN_DATA };
}
