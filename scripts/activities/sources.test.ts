import { describe, expect, it } from "vitest";
import { parseSitemap } from "./context.ts";
import { ageRange, parseEntry, properties, toActivity as familienausflugActivity } from "./familienausflug.ts";
import { toActivities as ferienplauschActivities } from "./ferienplausch.ts";
import { parseCoordinates } from "./geo.ts";
import { eventShape, geocodeQueries, parseCalendar, parseDetail, toActivity as kikukaActivity } from "./kikuka.ts";
import { centreName, isForKids, parseOffer, toActivity as gzActivity } from "./gz.ts";
import { toActivity as osmActivity } from "./osm.ts";
import { courseTime, toActivity as sportamtActivity } from "./sportamt.ts";
import { childPrice, kindOf, parseListing, parsePage, parseSchedule, toActivity as freizeitActivity } from "./freizeit.ts";
import { seasonMonths, toActivity as msActivity, type MsAttraction } from "./myswitzerland.ts";
import { parseGeo, pickPlace, placeQueries, toActivity as zoActivity, type ZoCategory } from "./zuerioberland.ts";
import { openMonths, pageSlug, toActivity as zuerichActivity, type ZtPlace } from "./zuerich.ts";
import { classify, parsePost, seasonFromTags, strollerFrom, toActivity as sffActivity } from "./swissfamilyfun.ts";

const SFF_POST = `<html><head><title>Bachtel Kulm • Short hike to Zürich panorama</title>
<script type="application/ld+json" class="yoast-schema-graph">{"@graph":[{"@type":"Article","headline":"Bachtel Kulm &#8226; Short hike to Zürich panorama","articleSection":["Hiking Trail"],"keywords":["Tower"]}]}</script></head>
<body><table><tbody>
<tr><td><strong>Location:</strong></td><td>Zurich region, eastern Switzerland</td></tr>
<tr><td><strong>By car</strong></td><td>parking near Unterbachstrasse 2, 8342 Hinwil<br>30 mins from Zurich</td></tr>
<tr><td><strong>By transit</strong></td><td>closest bus stop Wernetshausen<br>1hr from Zurich HB</td></tr>
<tr><td><strong>Trail</strong></td><td>3 km loop</td></tr>
<tr><td><strong>Elevation</strong></td><td>highest point 1115, 250m climb, 250m descent</td></tr>
<tr><td><strong>Condition</strong></td><td>dirt with some stairs, not suitable for strollers</td></tr>
<tr><td><strong>Skill</strong></td><td>moderate, but short</td></tr>
<tr><td><strong>Open</strong></td><td>year round</td></tr>
<tr><td><strong>Cost</strong></td><td>free</td></tr>
</tbody></table>
<iframe src="https://www.google.com/maps/embed?pb=!1m18!2d8.65!3d47.35!2m3!1s0x0%3A0x0!2sBachtel!5e0"></iframe></body></html>`;

describe("swissfamilyfun", () => {
  it("reads the fact table and turns it into a hike", () => {
    const post = parsePost(SFF_POST);
    expect(post.title).toBe("Bachtel Kulm • Short hike to Zürich panorama");
    expect(post.facts["Trail"]).toBe("3 km loop");
    expect(post.embedPlace).toBe("Bachtel");
    const a = sffActivity("https://swissfamilyfun.com/bachtel/", post)!;
    expect(a).toMatchObject({
      id: "swissfamilyfun:bachtel",
      kind: "Hike",
      setting: "outdoor",
      place: "Zurich region",
      carMin: 30,
      transitMin: 60,
      altitudeM: 1115,
      hike: { km: 3, loop: true, upM: 250, downM: 250, skill: "moderate" },
      stroller: false,
      costChf: 0,
    });
    expect(a.months).toBeUndefined();
  });

  it("skips round-ups without a fact table", () => {
    const post = parsePost(`<title>20 Best Autumn Hikes</title><p>Lots of hikes</p>`);
    expect(sffActivity("https://swissfamilyfun.com/fall-hiking/", post)).toBeNull();
  });

  it("marks rainy-day outdoor places as mixed and museums as indoor", () => {
    expect(classify({ title: "Technorama", sections: ["Science & Technology Museums"], keywords: ["Rainy Day"] })).toEqual({
      kind: "Museum",
      setting: "indoor",
    });
    expect(classify({ title: "Castle visit", sections: ["Castles"], keywords: ["Rainy Day"] }).setting).toBe("mixed");
  });

  it("ties seasonal events to their months but leaves best-season hikes open", () => {
    expect(seasonFromTags("Animals", ["Fall Event", "Zurich Autumn"])).toEqual([9, 10, 11]);
    expect(seasonFromTags("Outing", ["Fall Event", "Winter Event"])).toEqual([11]);
    expect(seasonFromTags("Nature", ["Summer Swim", "Zurich Summer"])).toEqual([6, 7, 8]);
    expect(seasonFromTags("Hike", ["Summer Swim"])).toBeUndefined();
    expect(seasonFromTags("Hike", ["Autumn", "Fall Colors"])).toBeUndefined();
    expect(seasonFromTags("Hike", ["Spring Hiking", "Zurich Spring"])).toEqual([3, 4, 5]);
  });

  it("reads stroller hints", () => {
    expect(strollerFrom("wide flat dirt trail, stroller friendly")).toBe(true);
    expect(strollerFrom("narrow dirt path, rocks, stairs, some cables, no strollers")).toBe(false);
    expect(strollerFrom("café, wheelchair & stroller accessible, lockers")).toBe(true);
    expect(strollerFrom("rocky dirt alpine trails")).toBeUndefined();
  });
});

describe("parseCoordinates", () => {
  it("reads place pins, @ links and DMS notation but not embed map centres", () => {
    expect(parseCoordinates("google.ch/maps/place/X/@47.514,8.762,17z/data=!3m1!8m2!3d47.5140166!4d8.7645841")).toEqual([47.5140166, 8.7645841]);
    expect(parseCoordinates('href="https://www.google.ch/maps/place/Technorama/@47.5140166,8.7623954,17z"')).toEqual([47.5140166, 8.7623954]);
    expect(parseCoordinates("GPS: 46°56’47.7″N 8°41’11.0″E")).toEqual([46.94658, 8.68639]);
    expect(parseCoordinates("google.com/maps/embed?pb=!1m18!1d2909!2d8.65!3d47.35!2m3")).toBeNull();
  });
});

const GZ_OFFER = `<article class="container-fluid post-4268 angebote type-angebote status-closed hentry sparte-werken-gestalten zielgruppen-kinder">
<header><div class="cat-title">Werken/Gestalten</div><h1 class="entry-title m-0">Werken am Mittwoch</h1>
<div class="place-time"> Mi., 21. Okt. 2026 <br> 14:00–17:00 Uhr<br> GZ Witikon <br>
<a data-content="<table class='table'><tr><td>Mi.</td><td>21.10.2026</td><td>14:00–17:00 Uhr</td></tr><tr><td>Mi.</td><td>28.10.2026</td><td>14:00–17:00 Uhr</td></tr></table>">Alle Daten anzeigen</a></div></header>
<div class="entry-content mt-2"><div class="row"><div class="col-lg-6">
<h3 class="m-0">Daten</h3><p>Jeden Mittwoch,<br />14:00 - 17:00 Uhr</p>
<h3 class="m-0">Ort</h3><p>GZ Witikon<br />Witikonerstr. 405<br />8053 Witikon</p>
</div><div class="col-lg-6">
<h3 class="m-0">Kosten</h3><p>CHF 10.-/ Material und kleiner Zvieri</p>
<h3 class="m-0">Anmeldung</h3><p>Einfach vorbeischauen. Wir haben Platz für 20 Kinder.</p>
</div></div><div class=" col-xl-6"><hr><p>Für Kinder ab 6 Jahren.</p></div>
<div class="col-12 social-bookmark-icons mb-2"></div></div></article>`;

describe("gz", () => {
  it("reads dates, fields and audience from an offer page", () => {
    const offer = parseOffer(GZ_OFFER);
    expect(offer.title).toBe("Werken am Mittwoch");
    expect(offer.audiences).toEqual(["kinder"]);
    expect(offer.dates).toEqual([
      { start: "2026-10-21", time: "14:00–17:00" },
      { start: "2026-10-28", time: "14:00–17:00" },
    ]);
    expect(offer.fields["Kosten"]).toBe("CHF 10.-/ Material und kleiner Zvieri");
    const a = gzActivity("https://gz-zh.ch/gz-witikon/angebote/werken-am-mittwoch/", "gz-witikon", offer)!;
    expect(a).toMatchObject({
      id: "gz:gz-witikon/werken-am-mittwoch",
      feed: "gz-witikon",
      kind: "Crafts",
      place: "GZ Witikon",
      ageMin: 6,
      costChf: 10,
      booking: "drop-in",
    });
  });

  it("falls back to the header date when there is no date list", () => {
    const html = `<article class="angebote zielgruppen-familien sparte-theater"><h1>Kasperlitheater</h1>
<div class="place-time"> So., 1. Nov. 2026 <br> 14:00–14:40 Uhr<br> GZ Witikon</div></article>`;
    expect(parseOffer(html).dates).toEqual([{ start: "2026-11-01", time: "14:00–14:40" }]);
  });

  it("keeps kids' and family offers and drops adult ones", () => {
    expect(isForKids({ audiences: ["kinder"], sparten: [], title: "Werken" })).toBe(true);
    expect(isForKids({ audiences: ["familien"], sparten: [], title: "Kasperli" })).toBe(true);
    expect(isForKids({ audiences: ["erwachsene", "familien", "seniorinnen"], sparten: [], title: "Quartierbar" })).toBe(false);
    expect(isForKids({ audiences: ["erwachsene"], sparten: ["ferienangebote"], title: "Ferienwoche" })).toBe(true);
    expect(isForKids({ audiences: ["kinder"], sparten: [], title: "CreaCafé – für Erwachsene" })).toBe(false);
  });

  it("names centres from their slug", () => {
    expect(centreName("gz-witikon")).toBe("GZ Witikon");
    expect(centreName("gz-hoengg")).toBe("GZ Hoengg");
  });
});

describe("sportamt", () => {
  it("turns holiday and semester courses into dated activities", () => {
    const holiday = sportamtActivity({
      angebotId: 26797,
      titel: "GC Unihockey Kids Camp",
      von: "2026-10-12T09:30:00",
      bis: "2026-10-16T16:00:00",
      kursOrt: "Hardau",
      jahrgangVon: 2013,
      jahrgangBis: 2019,
      aktivitaet: "Unihockey",
      kurstypId: 2,
      zeitpunkt3: "9.30–16.00 Uhr",
      status1: "Nicht mehr buchbar",
      anlageBreitengrad: 0,
      anlageLaengengrad: 0,
    })!;
    expect(holiday).toEqual({
      id: "sportamt:26797",
      source: "sportamt",
      title: "GC Unihockey Kids Camp",
      url: "https://www.stadt-zuerich.ch/sport-portal/angebot/26797",
      kind: "Holiday course",
      place: "Hardau",
      birthYears: [2013, 2019],
      dates: [{ start: "2026-10-12", end: "2026-10-16", time: "09:30–16:00" }],
      booking: "closed",
      tags: ["Unihockey"],
    });
    expect(sportamtActivity({ angebotId: 1, titel: "Dance", von: "2026-10-21T17:15:00", bis: "2027-04-21T18:15:00", kurstypId: 3 })).toBeNull();
    expect(sportamtActivity({ angebotId: 2, titel: "School course", von: "2026-08-17", bis: "2027-07-12", kurstypId: 1 })).toBeNull();
  });

  it("formats course times", () => {
    expect(courseTime("9.00–13.30 Uhr")).toBe("09:00–13:30");
    expect(courseTime("Montag bis Freitag")).toBeUndefined();
  });
});

describe("ferienplausch", () => {
  it("keeps only the current period's dates", () => {
    const out = ferienplauschActivities({
      booking_phase_start: "2026-05-02",
      activities: [
        {
          url: "https://ferienplausch.feriennet.projuventute.ch/activity/actionfilme-drehen",
          title: "1. Actionfilme drehen",
          age: { min: 10, max: 16 },
          cost: { min: 137, max: 137 },
          spots: 4,
          dates: [
            { start_date: "2019-07-19", start_time: "10:00:00", end_date: "2019-07-19", end_time: "17:00:00" },
            { start_date: "2026-07-13", start_time: "10:00:00", end_date: "2026-07-13", end_time: "17:00:00" },
            { start_date: "2026-07-14", start_time: "10:00:00", end_date: "2026-07-14", end_time: "17:00:00" },
          ],
          location: "ZHdK\r\nPfingstweidstrasse 96\r\n8005 Zürich",
          coordinate: { lat: 47.39, lon: 8.51 },
          tags: ["Film"],
        },
        { url: "https://x/activity/old", title: "Old", dates: [{ start_date: "2019-07-19" }] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "ferienplausch:actionfilme-drehen",
      title: "Actionfilme drehen",
      place: "Zürich",
      ageMin: 10,
      ageMax: 16,
      costChf: 137,
      dates: [{ start: "2026-07-13", end: "2026-07-14", time: "10:00–17:00" }],
    });
  });
});

describe("osm", () => {
  it("classifies indoor places and pools", () => {
    expect(
      osmActivity({ type: "node", id: 1, lat: 47.25, lon: 8.6, tags: { leisure: "indoor_play", name: "Monkey Town", "addr:city": "Horgen", website: "https://monkeytown.ch/ch/horgen/" } }),
    ).toMatchObject({ id: "osm:node/1", kind: "Indoor play", setting: "indoor", url: "https://monkeytown.ch/ch/horgen/", place: "Horgen" });
    expect(osmActivity({ type: "way", id: 2, center: { lat: 47.4, lon: 8.5 }, tags: { leisure: "water_park", name: "Freibad Oberdorf" } })).toMatchObject({
      kind: "Outdoor pool",
      setting: "outdoor",
      months: [5, 6, 7, 8, 9],
      url: "https://www.openstreetmap.org/way/2",
    });
    expect(osmActivity({ type: "way", id: 3, center: { lat: 47.4, lon: 8.5 }, tags: { leisure: "water_park", name: "Hallenbad Urdorf" } })?.setting).toBe("indoor");
    expect(osmActivity({ type: "way", id: 5, center: { lat: 47.4, lon: 8.5 }, tags: { leisure: "sports_centre", sport: "swimming", name: "Hallen- und Freibad Juch" } })?.setting).toBe("mixed");
    expect(osmActivity({ type: "node", id: 4, lat: 47.4, lon: 8.5, tags: { leisure: "indoor_play" } })).toBeNull();
    expect(osmActivity({ type: "way", id: 5, center: { lat: 47.4, lon: 8.5 }, tags: { leisure: "sports_centre", sport: "swimming", name: "Schulschwimmanlage Borrweg" } })).toBeNull();
    expect(osmActivity({ type: "way", id: 6, center: { lat: 47.4, lon: 8.5 }, tags: { leisure: "water_park", name: "Badesee Husemersee" } })?.setting).toBe("outdoor");
    // Beyond the 45 km radius (Bern).
    expect(osmActivity({ type: "node", id: 7, lat: 46.95, lon: 7.45, tags: { leisure: "indoor_play", name: "Far away" } })).toBeNull();
  });
});

const FA_ENTRY = `<script type="application/ld+json">{"@type":["TouristAttraction"],"name":"Adventure Arena Zürich","address":{"addressLocality":"Dübendorf","addressCountry":"CH"},"geo":{"latitude":"47.394900","longitude":"8.603080"}}</script>
<li data-property="AlterDerKinder"><strong>Alter der Kinder:</strong><div><span class="available AlterDerKinder_5"> 6 bis 10 Jahre </span><span class="available AlterDerKinder_6"> über 10 Jahre </span></div></li>
<li data-property="Kinderwagen"><strong class="no-info">Kinderwagen</strong></li>
<li data-property="Witterung"><span class="available Witterung_1"> Schönwetter </span><span class="available Witterung_2"> Regenwetter </span></li>
<li data-property="KategorieIchBin"><span class="available KategorieIchBin_6"> ein Indoorspielplatz </span></li>
<li data-property="SaisonaleFfnungszeiten"><span class="epsot021">ganzj&#228;hrig ge&#246;ffnet</span></li>`;

describe("familienausflug", () => {
  it("reads property blocks", () => {
    expect(properties(FA_ENTRY)).toEqual({
      AlterDerKinder: ["6 bis 10 Jahre", "über 10 Jahre"],
      Witterung: ["Schönwetter", "Regenwetter"],
      KategorieIchBin: ["ein Indoorspielplatz"],
    });
  });

  it("builds a place near Zürich and drops far-away ones", () => {
    const a = familienausflugActivity("adventure-arena-zurich", parseEntry(FA_ENTRY))!;
    expect(a).toMatchObject({ kind: "Indoor play", setting: "mixed", place: "Dübendorf", ageMin: 6, lat: 47.3949, lng: 8.60308 });
    expect(a.ageMax).toBeUndefined();
    expect(a.months).toBeUndefined();
    const far = FA_ENTRY.replace('"47.394900"', '"46.0"');
    expect(familienausflugActivity("far", parseEntry(far))).toBeNull();
  });

  it("combines age bands", () => {
    expect(ageRange(["2 bis 4 Jahre", "4 bis 6 Jahre"])).toEqual({ min: 2, max: 6 });
    expect(ageRange(["Jugendliche"])).toEqual({ min: 12, max: undefined });
  });
});

const kikukaCard = (path: string, title: string, schedule: string, age: string) => `
<div class="c-event-entry"><a href="${path}" class="js-event-link event-link"><div class="description-label"><div class="list-title">
<h2> ${title} </h2><span class="d-block venue">Landesmuseum Zürich</span>
<span class="d-block time"><div class="c-schedules">${schedule}</div></span>
<span class="list-view-age d-none">${age}</span></div></div></a></div>`;

const KIKUKA_CALENDAR = `
<div class="c-event-list-title" data-calendar-date="2026-10-24"></div>
${kikukaCard("/event/Landesmuseum%20Z%C3%BCrich/1", "Familientag", '<h3 class="schedule-date">Sa.<br />24. Oktober 2026</h3><p><span class="schedule-time">10.00 Uhr – 12.00 Uhr</span> <span class="schedule-time">14.00 Uhr – 16.00 Uhr</span></p>', "4-12 Jahre")}
${kikukaCard("/event/Landesmuseum%20Z%C3%BCrich/2", "Ritter &amp; Burgen", '<h3 class="schedule-date"><span class="nowrap">22. Februar 2024</span> – <span class="nowrap">31. Dezember 2026</span></h3><p><span class="schedule-day">Di., Mi., Do., Fr., Sa., So.: </span><span class="schedule-time">10.00 Uhr – 17.00 Uhr</span></p>', "0-12 Jahre")}
<div class="c-event-list-title" data-calendar-date="2026-10-25"></div>
${kikukaCard("/event/Landesmuseum%20Z%C3%BCrich/1", "Familientag", '<h3 class="schedule-date">So.<br />25. Oktober 2026</h3><p><span class="schedule-time">10.00 Uhr – 12.00 Uhr</span> <span class="schedule-time">14.00 Uhr – 16.00 Uhr</span></p>', "4-12 Jahre")}
${kikukaCard("/event/Landesmuseum%20Z%C3%BCrich/3", "Malkurs", '<h3 class="schedule-date"><span class="nowrap">17. August 2026</span> – <span class="nowrap">12. Februar 2027</span></h3><p><span class="schedule-day">Mittwoch: </span><span class="schedule-time">14.00 Uhr – 15.00 Uhr</span></p>', "6-8 Jahre")}`;

describe("kikuka", () => {
  it("reads cards per calendar day", () => {
    const cards = parseCalendar(KIKUKA_CALENDAR);
    expect(cards.map((c) => [c.id, c.day])).toEqual([
      ["1", "2026-10-24"],
      ["2", "2026-10-24"],
      ["1", "2026-10-25"],
      ["3", "2026-10-25"],
    ]);
    expect(cards[0]).toMatchObject({ title: "Familientag", venue: "Landesmuseum Zürich", ages: [4, 12], time: "10:00–12:00, 14:00–16:00" });
    expect(cards[0].run).toBeUndefined();
    expect(cards[1]).toMatchObject({ title: "Ritter & Burgen", run: { start: "2024-02-22", end: "2026-12-31", weekdays: [0, 2, 3, 4, 5, 6] } });
    expect(cards[3].run?.weekdays).toEqual([3]);
  });

  it("tells programmes, opening hours and weekly courses apart", () => {
    const cards = parseCalendar(KIKUKA_CALENDAR);
    const of = (id: string) => cards.filter((c) => c.id === id);
    expect(eventShape(of("1"))).toBe("dated");
    expect(eventShape(of("2"))).toBe("place");
    expect(eventShape(of("3"))).toBe("course");
    const sundays = [{ ...of("3")[0], run: { start: "2017-01-01", end: "2027-12-31", weekdays: [0] } }];
    expect(eventShape(sundays)).toBe("dated");
  });

  it("builds activities with the Sparte as kind", () => {
    const cards = parseCalendar(KIKUKA_CALENDAR);
    const of = (id: string) => cards.filter((c) => c.id === id);
    expect(kikukaActivity(of("1"), [8, 6], { costChf: 0, booking: "required" })).toMatchObject({
      id: "kikuka:1",
      url: "https://kikuka.ch/event/Landesmuseum%20Z%C3%BCrich/1",
      kind: "Workshop",
      place: "Landesmuseum Zürich",
      ageMin: 4,
      ageMax: 12,
      costChf: 0,
      dates: [{ start: "2026-10-24", end: "2026-10-25", time: "10:00–12:00, 14:00–16:00" }],
      tags: ["workshops", "museum", "Landesmuseum Zürich"],
    });
    const exhibition = kikukaActivity(of("2"), [18], {})!;
    expect(exhibition.kind).toBe("Exhibition");
    expect(exhibition.dates).toBeUndefined();
    expect(kikukaActivity(of("3"), [8], {})).toBeNull();
  });

  it("adds the venue's town to bare street addresses and tries shorter forms", () => {
    const qs = (address: string, venue: string) => geocodeQueries(address, venue).map(({ q, km }) => `${q} ≤${km}`);
    expect(qs("Bergstrasse 111", "8707 Uetikon am See")).toEqual(["Bergstrasse 111, 8707 Uetikon am See ≤80", "8707 Uetikon am See ≤80"]);
    expect(qs("Schiffbauplatz", "Jazzclub Moods")).toEqual(["Schiffbauplatz, Zürich ≤25", "Schiffbauplatz ≤80", "Zürich ≤25"]);
    expect(qs("GZ Affoltern", "GZ Affoltern")).toEqual(["GZ Affoltern, Zürich ≤25", "Affoltern Zürich ≤25", "GZ Affoltern ≤80", "Zürich ≤25"]);
    expect(qs("Kindertreff Viadukt, Josefwiese, Bogen 16, 8005 Zürich", "Kindertreff Viadukt")).toEqual([
      "Kindertreff Viadukt, Josefwiese, Bogen 16, 8005 Zürich ≤80",
      "Josefwiese, Bogen 16, 8005 Zürich ≤80",
      "Bogen 16, 8005 Zürich ≤80",
      "8005 Zürich ≤80",
    ]);
  });

  it("reads address, price and sign-up from the event modal", () => {
    const html = `<span class="description">Da die Platzzahl beschränkt ist, müssen Tickets reserviert werden.<br />Kostenlos </span>
<div class="sub-info"> <strong>Kosten</strong><br> <p> Preiskategorie: CHF gratis<br /> </p> <strong>Veranstaltungsort(e)</strong><br>
<a target="_blank" href="http://maps.google.ch/maps?q=Museumstrasse 2 8001 Zürich">Museumstrasse 2, 8001 Zürich</a> </div> <div class="end-links d-md-none">`;
    expect(parseDetail(html)).toEqual({ address: "Museumstrasse 2, 8001 Zürich", costChf: 0, booking: "required" });
    expect(parseDetail(html.replace("CHF gratis", "CHF 15.– / Kinder CHF 8.–")).costChf).toBe(8);
  });
});

describe("freizeit", () => {
  const EVENT = `<script>dataLayer.push({ "canton": "Z\u00fcrich", "city": "Aathal-Seegr\u00e4ben", "pageCategory": "Feste - M\u00e4rkte - Z\u00fcrich", "pageSection": "Agenda" });</script>
<h1 class="title">Kürbisausstellungen auf den Juckerhöfen</h1>
<section id="calendar" class="block-layout"><div class="calendar-column"><div class="data-container"> <h2>Öffnungszeiten</h2> <h4>Kürbisausstellung Juckerhof</h4><p>Von 19 September bis 25 Oktober 2026</p><p>Von 29 bis 31 Oktober 2026</p><p>von donnerstag bis samstag von 18h00 bis 23h00</p> </div></div>
<div class="calendar-column"><div class="data-container"> <h2>Preise</h2> <div class="tarifs"> <div class="tarif-item"> <span class="key">Erwachsene Sa-So</span> <span class="value"> 13 CHF </span> </div> <div class="tarif-item"> <span class="key">Kinder bis 12 Jahre</span> <span class="value"> Gratis </span> </div> </div></div></div></section>
<div class="nearby-activities" data-center-lat="47.3438954" data-center-lng="8.7726758"></div>`;

  it("reads listing cards and the last page", () => {
    const html = `<article class="card card--typed"> <a class="article-link" href="https://www.freizeit.ch/kalender/x/" data-gtm-contentid="1" data-gtm-post-type="agenda" > </a></article>
<a href="https://www.freizeit.ch/category/region/zug/?page=2">2</a><a href="https://www.freizeit.ch/category/region/zug/?page=8">8</a>`;
    expect(parseListing(html)).toEqual({ cards: [{ url: "https://www.freizeit.ch/kalender/x/", type: "agenda" }], lastPage: 8 });
  });

  it("turns an event page into dated activity with the children's price", () => {
    const page = parsePage(EVENT);
    expect(page).toMatchObject({ title: "Kürbisausstellungen auf den Juckerhöfen", section: "Agenda", categories: ["Feste", "Märkte"], city: "Aathal-Seegräben" });
    expect(freizeitActivity("https://www.freizeit.ch/kalender/kurbisausstellungen/", page, "2026-10-24")).toEqual({
      id: "freizeit:kurbisausstellungen",
      source: "freizeit",
      title: "Kürbisausstellungen auf den Juckerhöfen",
      url: "https://www.freizeit.ch/kalender/kurbisausstellungen/",
      kind: "Event",
      lat: 47.3438954,
      lng: 8.7726758,
      place: "Aathal-Seegräben",
      costChf: 0,
      dates: [{ start: "2026-09-19", end: "2026-10-25" }, { start: "2026-10-29", end: "2026-10-31", time: "18:00–23:00" }],
      tags: ["Feste", "Märkte"],
    });
    expect(freizeitActivity("https://www.freizeit.ch/kalender/k/", page, "2026-11-01")).toBeNull();
  });

  it("reads single dates and ranges across months", () => {
    expect(parseSchedule(["31 Oktober 2026", "samstag von 16h00 bis 22h30", "Von 30 Dezember bis 2 Januar 2027"])).toEqual([
      { start: "2026-10-31", time: "16:00–22:30" },
      { start: "2026-12-30", end: "2027-01-02" },
    ]);
  });

  it("prefers the children's price", () => {
    expect(childPrice({ tariffs: [["Erwachsene", "10 CHF"], ["Kinder (6-15)", "6 CHF"]], calendarText: "" })).toBe(6);
    expect(childPrice({ tariffs: [], calendarText: "Preise\nCHF 6.- pro Person, Kinder bis 5 Jahre gratis\nÖffnungszeiten\ntäglich" })).toBe(6);
  });

  it("names the kind from the categories and leaves out grown-up outings", () => {
    expect(kindOf({ title: "Juckerhof", section: "Activite", categories: ["Agrotourismus", "Bauernhöfe", "Spielplätze"] })).toBe("Animals");
    expect(kindOf({ title: "Hopfen, Malz & Salz Tour", section: "Activite", categories: ["Degustationen", "Museen"] })).toBeNull();
    expect(kindOf({ title: "Sim Racing Sport Bar", section: "Activite", categories: ["Spiele"] })).toBeNull();
    expect(kindOf({ title: "Familienkonzert", section: "Agenda", categories: ["Konzerte"] })).toBe("Event");
    expect(kindOf({ title: "Zürich liest", section: "Agenda", categories: ["Literatur"] })).toBeNull();
  });
});

describe("myswitzerland", () => {
  const cls = (name: string, ...values: string[]) => ({ name, values: values.map((v) => ({ name: v })) });
  const zoo: MsAttraction = {
    identifier: "abc",
    name: "Plättli Zoo",
    url: "https://www.myswitzerland.com/de/erlebnisse/plaettli-zoo/",
    geo: { latitude: 47.5536, longitude: 8.8986 },
    classification: [
      cls("suitablefortype", "family", "children"),
      cls("childrenage", "0to5years", "6to9years"),
      cls("indooroutdoorclassifications", "outdoor"),
      cls("seasons", "spring", "summer", "autumn", "winter"),
      cls("experiencetype", "nature", "education"),
    ],
  };

  it("turns a family attraction into an outing with ages and setting", () => {
    expect(msActivity(zoo)).toEqual({
      id: "myswitzerland:abc",
      source: "myswitzerland",
      title: "Plättli Zoo",
      url: "https://www.myswitzerland.com/de/erlebnisse/plaettli-zoo/",
      kind: "Animals",
      setting: "outdoor",
      lat: 47.5536,
      lng: 8.8986,
      ageMax: 9,
      tags: ["nature", "education"],
    });
  });

  it("leaves out attractions not for families and far ones, and reads seasons", () => {
    expect(msActivity({ ...zoo, classification: [cls("suitablefortype", "couples")] })).toBeNull();
    expect(msActivity({ ...zoo, geo: { latitude: 46.6, longitude: 8.6 } })).toBeNull();
    const run = msActivity({ ...zoo, name: "Sommer-Rodelbahn", classification: [cls("suitablefortype", "family"), cls("seasons", "summer", "autumn"), cls("childrenage", "6to9years", "14plus")] });
    expect(run).toMatchObject({ kind: "Adventure park", months: [4, 5, 6, 7, 8, 9, 10], ageMin: 6 });
    expect(run?.ageMax).toBeUndefined();
  });

  it("takes months only from clear season patterns", () => {
    expect(seasonMonths(["winter"])).toEqual([12, 1, 2, 3]);
    expect(seasonMonths(["winter", "summer"])).toBeUndefined();
    expect(seasonMonths(["spring", "summer", "autumn", "winter"])).toBeUndefined();
    expect(msActivity({ ...zoo, name: "Sihlpark Wellness" })).toBeNull();
  });
});

describe("zuerioberland", () => {
  const categories = new Map<number, ZoCategory>([
    [291, { id: 291, name: "Tiere &amp; Bauernhöfe", parent: 285 }],
    [288, { id: 288, name: "Familien", parent: 285 }],
    [376, { id: 376, name: "Pfäffikon", parent: 351 }],
  ]);
  const farm = {
    id: 1,
    slug: "alpakahof-theilingen",
    link: "https://www.zuerioberland.ch/erlebnisse/alpakahof-theilingen/",
    title: { rendered: "Alpakahof Theilingen" },
    modified_gmt: "2026-10-01T10:00:00",
    categories: [51, 288, 291, 376, 71],
  };

  it("turns a family experience into an outing with town and setting", () => {
    expect(zoActivity(farm, categories)).toEqual({
      id: "zuerioberland:alpakahof-theilingen",
      source: "zuerioberland",
      title: "Alpakahof Theilingen",
      url: "https://www.zuerioberland.ch/erlebnisse/alpakahof-theilingen/",
      kind: "Animals",
      setting: "outdoor",
      place: "Pfäffikon",
      tags: ["Tiere & Bauernhöfe"],
    });
  });

  it("leaves out places to eat and gives snow its season", () => {
    expect(zoActivity({ ...farm, title: { rendered: "Sticki Kaffee" }, categories: [51, 1105] }, categories)).toBeNull();
    expect(zoActivity({ ...farm, title: { rendered: "Schlittelweg Bachtel" }, categories: [51, 287] }, categories)).toMatchObject({
      kind: "Sledding",
      months: [12, 1, 2, 3],
    });
  });

  it("places hikes by the names in their title, picking namesakes that lie together", () => {
    expect(placeQueries("Naturrundweg Illnau–Agasul")).toEqual(["Illnau", "Agasul"]);
    expect(placeQueries("Wetter. Wunder. Wissen.")).toEqual(["Wetter", "Wunder", "Wissen"]);
    const ottikonGossau: [number, number] = [47.294, 8.778];
    const ottikonKemptthal: [number, number] = [47.434, 8.717];
    expect(pickPlace([[ottikonGossau, ottikonKemptthal], [[47.437, 8.736]]])).toEqual(ottikonKemptthal);
    expect(pickPlace([[], [ottikonGossau]])).toEqual(ottikonGossau);
    expect(pickPlace([[], []])).toBeNull();
  });

  it("reads coordinates from the TouristAttraction", () => {
    expect(parseGeo(`{"@type":"TouristAttraction","address":{"@type":"PostalAddress"},"geo":{"@type":"GeoCoordinates","latitude":47.30499,"longitude":8.89571}}`)).toEqual([
      47.30499, 8.89571,
    ]);
  });
});

describe("zuerich", () => {
  const jucker: ZtPlace = {
    identifier: "2659",
    "@type": "CivicStructure",
    name: { de: "Juckerhof Seegräben – Der Erlebnisbauernhof am Pfäffikersee", en: "Juckerhof Seegräben" },
    geoCoordinates: { latitude: 47.343803, longitude: 8.772844 },
    address: { addressLocality: "Seegräben", url: "https://www.juckerfarm.ch" },
    price: { de: null },
    specialOpeningHoursSpecification: { de: "<p>Finden Sie hier die <a href='x'>Öffnungszeiten</a></p>" },
    place: ["Outdoors"],
  };
  const page = "https://www.zuerich.com/de/besuchen/natur/juckerhof-seegraeben-der-erlebnisbauernhof-am-pfaeffikersee";
  const pages = new Map([[pageSlug(jucker.name.de), page]]);

  it("turns a place into an outing with its zuerich.com page", () => {
    expect(zuerichActivity(jucker, [99, 161], pages)).toEqual({
      id: "zuerich:2659",
      source: "zuerich",
      title: "Juckerhof Seegräben – Der Erlebnisbauernhof am Pfäffikersee",
      url: page,
      kind: "Animals",
      setting: "outdoor",
      lat: 47.343803,
      lng: 8.772844,
      place: "Seegräben",
    });
    expect(zuerichActivity(jucker, [99], new Map())?.url).toBe("https://www.juckerfarm.ch");
  });

  it("skips far-away places, restaurants and closed ones", () => {
    expect(zuerichActivity({ ...jucker, geoCoordinates: { latitude: 46.547, longitude: 7.985 } }, [99], pages)).toBeNull();
    expect(zuerichActivity({ ...jucker, "@type": "Restaurant" }, [99], pages)).toBeNull();
    expect(zuerichActivity({ ...jucker, specialOpeningHoursSpecification: { de: "Vorübergehend geschlossen" } }, [99], pages)).toBeNull();
  });

  it("knows the season of markets, snow and summer places", () => {
    const at = (name: string, categories: number[], extra: Partial<ZtPlace> = {}) =>
      zuerichActivity({ ...jucker, name: { de: name }, specialOpeningHoursSpecification: null, ...extra }, categories, pages);
    expect(at("Zürcher Weihnachtsallee", [418])?.months).toEqual([11, 12]);
    expect(at("Rodeln am Bachtel", [99, 153])).toMatchObject({ kind: "Sledding", months: [12, 1, 2, 3] });
    expect(at("Langlauf am Bachtel", [99])).toMatchObject({ kind: "Snow", months: [12, 1, 2, 3] });
    expect(at("Rigi im Sommer", [99])?.months).toEqual([5, 6, 7, 8, 9, 10]);
    expect(at("Strandbad Mythenquai", [141])?.months).toEqual([5, 6, 7, 8, 9]);
    expect(at("Hallenbad City", [141], { place: ["Indoors"] })).toMatchObject({ setting: "indoor" });
    expect(at("Hallenbad City", [141], { place: ["Indoors"] })?.months).toBeUndefined();
  });

  it("reads seasonal closures as the months that are left", () => {
    expect(openMonths("Saisonbedingt geschlossen von Mittwoch, 24. Dezember 2025 bis Donnerstag, 19. November 2026.")).toEqual([11, 12]);
    expect(openMonths("Saisonbedingt geschlossen von Montag, 15. September 2025 bis Freitag, 15. Mai 2026.")).toEqual([5, 6, 7, 8, 9]);
    expect(openMonths("Rund um die Uhr geöffnet")).toBeUndefined();
  });
});

describe("parseSitemap", () => {
  it("reads urls and lastmod", () => {
    const xml = `<urlset><url><loc>https://a/x/</loc><lastmod>2026-10-12T08:00:00+00:00</lastmod></url><url><loc>https://a/y?a=1&amp;b=2</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual([
      { loc: "https://a/x/", lastmod: "2026-10-12T08:00:00+00:00" },
      { loc: "https://a/y?a=1&b=2", lastmod: undefined },
    ]);
  });
});
