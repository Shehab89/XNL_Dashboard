import type { Party, Politician, SourceRef, TimelineEvent, Topic } from "../types";

import { slug } from "../utils/format";

/**
 * Reference data. Parties, seats, leaders and politicians come from the backend (config/entities.yaml, published in
 * the web snapshot) and are filled in by applyReference() when the data loads; every page that shows them waits for
 * that. Topics, glossary and history are static texts kept here.
 */

export const REF = {
  asOf: "",
  seatsSource: { name: "Tweede Kamer, Fracties", url: "https://www.tweedekamer.nl/kamerleden_en_commissies/fracties", verification: "verified" } as SourceRef,
  cabinet: "",
  cabinetSource: { name: "Parlement.com, Kabinetsformatie 2025-2026", url: "https://parlement.com/kabinetsformatie-2025-2026", verification: "verified" } as SourceRef,
};

/** The election itself, for the timeline. Seats shown elsewhere are current fractie sizes from the backend. */
export const ELECTION_2025: SourceRef = {
  name: "Kiesraad: uitslag Tweede Kamerverkiezing 29 oktober 2025",
  url: "https://www.kiesraad.nl/verkiezingen/tweede-kamer",
  verification: "verified",
};

/** Ordered by seats (then name). Not a left-right ordering: the monitor does not place parties on an ideological axis. */
export const PARTIES: Party[] = [];
export const POLITICIANS: Politician[] = [];

export interface RawReference {
  as_of?: string; seats_source?: string; cabinet?: string; cabinet_source?: string;
  parties: { name: string; color: string; full_name?: string; seats?: number | null; leader?: string | null; coalition?: boolean }[];
  politicians: { name: string; party: string; role: string }[];
}

/** Replaces the reference lists in place, so every module that imported them sees the backend's current facts. */
export function applyReference(raw: RawReference) {
  REF.asOf = raw.as_of ?? "";
  REF.cabinet = raw.cabinet ?? "";
  REF.seatsSource = { ...REF.seatsSource, name: raw.seats_source ?? REF.seatsSource.name, updated: REF.asOf };
  REF.cabinetSource = { ...REF.cabinetSource, name: raw.cabinet_source ?? REF.cabinetSource.name, updated: REF.asOf };
  const people = raw.politicians.map((p) => ({ id: slug(p.name), name: p.name, partyId: slug(p.party), role: p.role,
    roleSource: { name: "Tweede Kamer, Fracties; NOS, kabinet-Jetten", updated: REF.asOf, verification: "verified" as const } }));
  const parties = raw.parties.map((p) => ({
    id: slug(p.name), name: p.name, fullName: p.full_name ?? p.name, color: p.color, seats: p.seats ?? null,
    leader: p.leader ?? undefined, leaderId: people.find((x) => x.name === p.leader)?.id, coalition: !!p.coalition,
    seatsSource: REF.seatsSource,
  })).sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0) || a.name.localeCompare(b.name, "nl"));
  PARTIES.splice(0, PARTIES.length, ...parties);
  POLITICIANS.splice(0, POLITICIANS.length, ...people);
  for (const [map, list] of [[partyById, PARTIES], [politicianById, POLITICIANS]] as const) {
    map.clear();
    for (const x of list) (map as Map<string, typeof x>).set(x.id, x);
  }
  partyByName.clear(); for (const p of PARTIES) partyByName.set(p.name, p);
  politicianByName.clear(); for (const p of POLITICIANS) politicianByName.set(p.name, p);
}

const topic = (id: string, name: string, nameEn: string, nl: string, en: string): Topic => ({ id, name, nameEn, scope: { nl, en } });

/** The monitor's fixed topic labels (config/entities.yaml) and what each label covers. */
export const TOPICS: Topic[] = [
  topic("kabinet-formatie", "Kabinet & formatie", "Cabinet & coalition talks",
    "Kabinetsformatie, coalities, het kabinet als geheel, ministers en vertrouwen.", "Coalition building, the cabinet as a whole, ministers and confidence votes."),
  topic("veiligheid-justitie", "Veiligheid & justitie", "Security & justice",
    "Politie, criminaliteit, rechtspraak, gevangenissen en terrorismebestrijding.", "Police, crime, courts, prisons and counter-terrorism."),
  topic("defensie-oekraine", "Defensie & Oekraïne", "Defence & Ukraine",
    "Defensie-uitgaven, NAVO, steun aan Oekraïne en internationale veiligheid.", "Defence spending, NATO, support for Ukraine and international security."),
  topic("europa", "Europa", "Europe", "De Europese Unie, Europese regels en de Nederlandse rol in Brussel.", "The EU, European rules and the Dutch role in Brussels."),
  topic("onderwijs", "Onderwijs", "Education", "Scholen, leraren, hoger onderwijs, studiefinanciering.", "Schools, teachers, higher education, student finance."),
  topic("midden-oosten", "Midden-Oosten", "Middle East", "Het Nederlandse beleid rond Israël, Gaza en de regio.", "Dutch policy on Israel, Gaza and the region."),
  topic("economie-koopkracht", "Economie & koopkracht", "Economy & cost of living",
    "Inflatie, koopkracht, begroting en economische groei.", "Inflation, purchasing power, budget and growth."),
  topic("landbouw-stikstof", "Landbouw & stikstof", "Farming & nitrogen", "Stikstofbeleid, boeren, natuur en het platteland.", "Nitrogen policy, farmers, nature and rural areas."),
  topic("wonen", "Wonen", "Housing", "Woningtekort, huren, hypotheken en bouwen.", "Housing shortage, rents, mortgages and construction."),
  topic("migratie-asiel", "Migratie & asiel", "Migration & asylum", "Asielbeleid, opvang, arbeidsmigratie en integratie.", "Asylum policy, reception, labour migration and integration."),
  topic("klimaat-energie", "Klimaat & energie", "Climate & energy", "Klimaatdoelen, energieprijzen, energietransitie.", "Climate targets, energy prices, energy transition."),
  topic("werk-inkomen", "Werk & inkomen", "Work & income", "Arbeidsmarkt, lonen, uitkeringen en pensioenen.", "Labour market, wages, benefits and pensions."),
  topic("belastingen-toeslagen", "Belastingen & toeslagen", "Taxes & benefits", "Belastingplannen, toeslagen en de hersteloperatie.", "Tax plans, benefit allowances and the compensation scheme."),
  topic("rechtsstaat-discriminatie", "Rechtsstaat & discriminatie", "Rule of law & discrimination",
    "Grondrechten, discriminatie, de rechtsstaat en democratische instituties.", "Fundamental rights, discrimination, rule of law and democratic institutions."),
  topic("zorg", "Zorg", "Healthcare", "Zorgkosten, eigen risico, ziekenhuizen en ouderenzorg.", "Healthcare costs, deductible, hospitals and elderly care."),
];

/** Dutch political terms with neutral explanations, used by the glossary and by search. */
export const GLOSSARY: { term: string; en: string; nl: string; enText: string }[] = [
  { term: "Tweede Kamer", en: "House of Representatives", nl: "De 150 gekozen volksvertegenwoordigers. Controleert de regering, stemt over wetten en kan wetten wijzigen.", enText: "The 150 elected representatives. Scrutinises the government, votes on bills and can amend them." },
  { term: "Eerste Kamer", en: "Senate", nl: "75 senatoren, gekozen door de Provinciale Staten. Stemt als laatste over wetsvoorstellen, maar kan ze niet wijzigen.", enText: "75 senators elected by the provincial councils. Has the final vote on bills but cannot amend them." },
  { term: "Kabinet", en: "Cabinet", nl: "De ministers en staatssecretarissen samen. Het kabinet regeert en heeft het vertrouwen van een Kamermeerderheid nodig.", enText: "The ministers and state secretaries together. Governs and needs the confidence of a majority in the House." },
  { term: "Coalitie", en: "Coalition", nl: "De partijen die samen het kabinet steunen en een regeerakkoord sluiten.", enText: "The parties that together support the cabinet and agree a coalition agreement." },
  { term: "Oppositie", en: "Opposition", nl: "De partijen in de Kamer die niet in de coalitie zitten.", enText: "Parties in parliament that are not part of the coalition." },
  { term: "Formatie", en: "Government formation", nl: "Het proces na verkiezingen waarin partijen onderhandelen over een nieuw kabinet.", enText: "The process after elections in which parties negotiate a new cabinet." },
  { term: "Fractie", en: "Parliamentary group", nl: "De Kamerleden van één partij samen.", enText: "The members of one party in parliament." },
  { term: "Motie", en: "Motion", nl: "Een verzoek of uitspraak van de Kamer aan de regering. Niet bindend, wel politiek zwaarwegend.", enText: "A request or statement from the House to the government. Not binding, but politically weighty." },
  { term: "Amendement", en: "Amendment", nl: "Een voorstel om de tekst van een wetsvoorstel te wijzigen.", enText: "A proposal to change the text of a bill." },
  { term: "Wetsvoorstel", en: "Bill", nl: "Een voorstel voor een nieuwe wet of een wetswijziging.", enText: "A proposal for a new law or a change to a law." },
  { term: "Stemming", en: "Vote", nl: "Het moment waarop de Kamer over moties, amendementen en wetsvoorstellen beslist; meestal op dinsdag.", enText: "When the House decides on motions, amendments and bills; usually on Tuesdays." },
  { term: "Debat", en: "Debate", nl: "Een vergadering waarin Kamerleden met elkaar en met de regering discussiëren.", enText: "A sitting in which members debate with each other and with the government." },
  { term: "Verkiezingen", en: "Elections", nl: "Tweede Kamer, Provinciale Staten, gemeenteraden, waterschappen en Europees Parlement hebben elk eigen verkiezingen.", enText: "The House, provinces, municipalities, water boards and the European Parliament each have their own elections." },
];

export const partyById = new Map<string, Party>();
export const partyByName = new Map<string, Party>();
export const politicianById = new Map<string, Politician>();
export const politicianByName = new Map<string, Politician>();
export const topicById = new Map(TOPICS.map((t) => [t.id, t]));
export const topicByName = new Map(TOPICS.map((t) => [t.name, t]));
export const TOTAL_SEATS = 150;
export const MAJORITY = 76;

const PARLEMENT_COM: SourceRef = { name: "Parlement.com (PDC)", url: "https://www.parlement.com/", verification: "unverified" };

/** Recent Dutch political history for the timeline's historical view. Compiled by hand, so marked unverified. */
export const HISTORY: TimelineEvent[] = [
  { id: "hist-2021-01", date: "2021-01-15", kind: "government", title: "Kabinet-Rutte III treedt af na de toeslagenaffaire", parties: [], topics: ["belastingen-toeslagen"], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2021-03", date: "2021-03-17", kind: "election", title: "Tweede Kamerverkiezing 2021", parties: [], topics: [], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2022-01", date: "2022-01-10", kind: "government", title: "Kabinet-Rutte IV beëdigd", parties: [], topics: ["kabinet-formatie"], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2023-07", date: "2023-07-07", kind: "government", title: "Kabinet-Rutte IV valt over migratiebeleid", parties: [], topics: ["migratie-asiel"], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2023-11", date: "2023-11-22", kind: "election", title: "Tweede Kamerverkiezing 2023", parties: [], topics: [], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2024-07", date: "2024-07-02", kind: "government", title: "Kabinet-Schoof beëdigd", parties: [], topics: ["kabinet-formatie"], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2025-06", date: "2025-06-03", kind: "government", title: "PVV stapt uit het kabinet-Schoof", parties: ["pvv"], topics: ["kabinet-formatie", "migratie-asiel"], sources: [PARLEMENT_COM], layer: "fact" },
  { id: "hist-2025-10", date: "2025-10-29", kind: "election", title: "Tweede Kamerverkiezing 2025", parties: [], topics: [], sources: [ELECTION_2025], layer: "fact" },
  { id: "hist-2026-02", date: "2026-02-23", kind: "government", title: "Kabinet-Jetten beëdigd: minderheidskabinet van D66, VVD en CDA", parties: ["d66", "vvd", "cda"], topics: ["kabinet-formatie"], sources: [{ name: "Parlement.com, Kabinetsformatie 2025-2026", url: "https://parlement.com/kabinetsformatie-2025-2026", verification: "verified" }], layer: "fact" },
  { id: "hist-2026-06", date: "2026-06-09", kind: "parliament", title: "Fractie GroenLinks-PvdA heet voortaan PRO (Progressief Nederland)", parties: ["pro"], topics: [], sources: [{ name: "Parlement.com, 9 juni 2026", url: "https://www.parlement.com/nieuws/202606/fractie-groenlinks-pvda-heet-voortaan-pro", verification: "verified" }], layer: "fact" },
];
