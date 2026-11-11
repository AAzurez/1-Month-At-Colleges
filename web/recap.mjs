// End-of-game recap: what Sam's decisions led to, how Sam affected everyone else, and a look at
// how the month was spent. Built from state.log, state.tally, state.moments and state.history,
// which world-new.mjs records during play. Served by GET /recap.
import { EVENTS, INTERESTS, NPCS, OCCUPATIONS, SKILLS, dateText, moodOf, nameOf, newGame, pastTense, personalize, playerName, withPlayer } from "./world-new.mjs";

const MONTHS_SHORT = { October: "Oct", November: "Nov" };

export function whenText(t) {
  const day = Math.floor(t / 24);
  const hour = t % 24;
  const clock = `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
  const [month, date] = dateText(day).split(" ");
  return `${MONTHS_SHORT[month] ?? month} ${date}, ${clock}`;
}

// [{ e, n }] -> "went to Coding Club meetup 3× and went to work 2×"
export function becausePhrase(list) {
  const parts = (list ?? [])
    .filter((item) => EVENTS[item.e])
    .map((item) => `${pastTense(EVENTS[item.e].title)}${item.n > 1 ? ` ${item.n}×` : ""}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// How each choice is grouped when looking at how the month was spent.
const STUDY = new Set(["go_to_class", "do_homework", "study_group", "midterm_review", "midterm_exam", "guest_lecture", "do_research", "office_hours", "library_study", "cram"]);
const WORK = new Set(["go_to_work", "find_campus_job", "find_offcampus_job", "quit_job", "career_center", "sell_textbooks", "scholarship"]);
const REST = new Set(["go_to_sleep", "nap"]);
const HEALTH = new Set(["go_to_gym", "grab_a_meal", "grab_caffeine", "farmers_market", "takeout", "campus_walk", "health_center"]);
const SCREEN = new Set(["doomscroll", "video_games", "watch_movie", "online_shopping"]);
const SOCIAL = new Set(["dinner_friends", "call_home"]);

export function categoryOf(eventId) {
  const event = EVENTS[eventId];
  if (!event) return "Other";
  if (STUDY.has(eventId)) return "Study";
  if (WORK.has(eventId)) return "Work";
  if (REST.has(eventId)) return "Rest";
  if (HEALTH.has(eventId)) return "Health & food";
  if (SCREEN.has(eventId)) return "Screen time";
  if (event.npc || SOCIAL.has(eventId)) return "People";
  if (event.when) return "Clubs & events";
  return "Personal";
}

const CATEGORY_ORDER = ["Study", "Work", "Clubs & events", "People", "Personal", "Health & food", "Screen time", "Rest"];

function sum(list, fn) {
  return list.reduce((total, item) => total + (fn(item) ?? 0), 0);
}

function countNights(log) {
  return log.filter(([, e]) => e === "go_to_sleep").length;
}

// Recap text is written with "Sam"; this swaps in the player's name everywhere in the result.
function namePlayer(value, state) {
  if (typeof value === "string") return withPlayer(value, state);
  if (Array.isArray(value)) return value.map((item) => namePlayer(item, state));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, namePlayer(v, state)]));
  return value;
}

export function buildRecap(state) {
  return namePlayer({ player: playerName(state), ...recapFor(state) }, state);
}

function recapFor(state) {
  const named = (text) => personalize(text, state);
  const phrase = (list) => named(becausePhrase(list));
  const tally = state.tally ?? {};
  const log = state.log ?? [];
  const moments = state.moments ?? [];
  const history = state.history ?? [];
  // Where this game started (skills, moods and the first interest are random each game).
  const fresh = newGame();
  const start = {
    sam: { ...fresh.sam, skills: state.start?.skills ?? fresh.sam.skills, happiness: fresh.sam.happiness },
    moods: state.start?.moods ?? null,
  };
  const daysPlayed = Math.max(1, state.time.day + (state.time.hour >= 7 ? 1 : 0));
  const records = Object.entries(tally).map(([e, record]) => ({ e, ...record }));

  // ---- Highlights: because you did X -> that led to Y ----------------------------------------
  const highlights = [];
  const add = (because, effect, t, tone = "neutral", times = 1) => {
    if (because && effect) highlights.push({ because, effect, t, tone, times });
  };
  // Repeats of the same kind of moment (running out of energy, burning out, ...) become one
  // highlight with a count, using the causes from the latest time it happened.
  const groups = new Map();
  for (const moment of moments) {
    if (!moment.because || moment.because.length === 0) continue;
    const group = (moment.key ?? moment.text).split(":")[0] === "interest" || (moment.key ?? "").startsWith("skill") || (moment.key ?? "").startsWith("money")
      ? moment.key
      : (moment.key ?? moment.text).split(":")[0];
    const entry = groups.get(group);
    if (entry) {
      entry.times += 1;
      entry.last = moment;
    } else {
      groups.set(group, { first: moment, last: moment, times: 1 });
    }
  }
  for (const { first, last, times } of groups.values()) {
    const tone = first.kind === "warning" ? "bad" : first.kind === "growth" || first.kind === "job" ? "good" : "neutral";
    const text = last.text.replace(/\.$/, "");
    const effect = times > 1 ? `${text.replace(/\s*\(\d+\)$/, "")}: ${times} times, first on ${whenText(first.t).split(",")[0]}` : text;
    add(phrase(last.because), effect, first.t, tone, times);
  }

  // Outcomes that only make sense once the month is over.
  const work = tally.go_to_work;
  if (work) {
    const burnout = work.d.burnout ?? 0;
    add(
      `worked ${work.n} shift${work.n > 1 ? "s" : ""} (${work.hours} hours)`,
      `earned $${Math.max(0, work.d.money ?? 0)}${burnout > 0 ? ` but took on +${burnout} burnout` : ""}`,
      null,
      burnout > 15 ? "mixed" : "good",
    );
  }
  const scroll = tally.doomscroll;
  if (scroll && scroll.n >= 2) {
    const lift = scroll.d.happiness ?? 0;
    add(`doomscrolled ${scroll.hours} hours`, `lost that time and picked up +${scroll.d.burnout ?? 0} burnout${lift > 0 ? ` for a quick +${lift} happiness` : ""}`, null, "bad");
  }
  const topInterest = Object.entries(state.sam.interests ?? {}).sort((a, b) => b[1] - a[1])[0];
  if (topInterest && topInterest[1] >= 10) {
    const [id, value] = topInterest;
    const feeders = records.filter((r) => (r.in?.[id] ?? 0) > 0).sort((a, b) => b.in[id] - a.in[id]).slice(0, 2);
    add(phrase(feeders), `${INTERESTS[id]} became Sam's strongest interest (${value})`, null, "good");
  }
  const nights = countNights(log);
  const emptyHours = history.filter((row) => row[5] === 0).length;
  if (daysPlayed >= 3 && nights < daysPlayed - 1) {
    add(`went to sleep only ${nights} of ${daysPlayed} nights`, `Sam spent ${emptyHours} hours at 0 energy`, null, "bad");
  }
  const biggestFix = records.filter((r) => (r.d.burnout ?? 0) < 0).sort((a, b) => a.d.burnout - b.d.burnout)[0];
  if (biggestFix && biggestFix.d.burnout <= -10) {
    add(phrase([biggestFix]), `took ${-biggestFix.d.burnout} points of burnout off over the month`, null, "good");
  }
  // Keep the timeline order, strongest stories first within it, and no duplicates.
  const seen = new Set();
  const uniqueHighlights = highlights.filter((h) => {
    const key = `${h.because}|${h.effect}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ---- Impact on others ---------------------------------------------------------------------
  const impact = Object.entries(NPCS).map(([id, npc]) => {
    const relation = { talk: 0, busy: 0, ignore: 0, hangout: 0, ...(state.relations?.[id] ?? {}) };
    const together = relation.talk + relation.hangout;
    const before = start.moods?.[id] ?? moodOf(fresh, id);
    const after = moodOf(state, id);
    const effects = records
      .filter((r) => (r.p?.[id] ?? 0) !== 0)
      .sort((a, b) => Math.abs(b.p[id]) - Math.abs(a.p[id]));
    const biggest = effects[0];
    let verdict = "Barely met";
    if (relation.ignore >= 3) verdict = "Holding a grudge";
    else if ((together >= 3 || relation.hangout >= 2) && relation.ignore === 0) verdict = "Close friend";
    else if (together > relation.ignore && together > 0) verdict = "Friendly";
    else if (relation.ignore > together) verdict = "Feels ignored";
    else if (relation.busy > 0 && together === 0) verdict = "Kept at a distance";
    else if (after - before >= 5) verdict = "Liked Sam's choices from afar";
    else if (after - before <= -5) verdict = "Disliked Sam's choices from afar";
    else if (after - before !== 0) verdict = "Acquaintance";
    return {
      id,
      name: nameOf(state, id),
      role: npc.role ?? "",
      color: npc.color,
      verdict,
      moodBefore: before,
      moodAfter: after,
      ...relation,
      biggest: biggest ? { title: named(EVENTS[biggest.e]?.title ?? biggest.e), change: biggest.p[id] } : null,
    };
  });
  const better = impact.filter((p) => p.moodAfter > p.moodBefore).length;
  const worse = impact.filter((p) => p.moodAfter < p.moodBefore).length;

  // ---- Decisions ------------------------------------------------------------------------------
  const hoursBy = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  const countBy = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const r of records) {
    const category = categoryOf(r.e);
    hoursBy[category] = (hoursBy[category] ?? 0) + r.hours;
    countBy[category] = (countBy[category] ?? 0) + r.n;
  }
  hoursBy.Rest += nights * 9; // a night's sleep is roughly 10 PM to 7 AM (not shown in the bars)
  const totalHours = Math.max(1, sum(Object.values(hoursBy), (h) => h));
  const earned = sum(records, (r) => Math.max(0, r.d.money ?? 0));
  const spent = sum(records, (r) => Math.max(0, -(r.d.money ?? 0)));
  const favorites = records
    .filter((r) => !EVENTS[r.e]?.sleep)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((r) => ({ title: named(EVENTS[r.e]?.title ?? r.e), n: r.n }));
  const clubsTried = records.filter((r) => EVENTS[r.e]?.when).length;
  const ignoredTotal = sum(impact, (p) => p.ignore);
  const talkedTotal = sum(impact, (p) => p.talk + p.hangout);
  const peakBurnout = Math.max(0, ...history.map((row) => row[6]));
  const share = (category) => hoursBy[category] / totalHours;
  const awakeHours = Math.max(1, totalHours - hoursBy.Rest);
  const awakeShare = (category) => hoursBy[category] / awakeHours;

  const insights = [];
  const insight = (text, tone) => insights.push({ text, tone });
  if (awakeShare("Study") < 0.12) insight(`Only ${Math.round(awakeShare("Study") * 100)}% of Sam's planned time went to classes and studying.`, "bad");
  else if (awakeShare("Study") > 0.35) insight(`Studying took ${Math.round(awakeShare("Study") * 100)}% of Sam's planned time. Grades first.`, "good");
  if (awakeShare("Work") > 0.35) insight(`Work took ${Math.round(awakeShare("Work") * 100)}% of Sam's planned time.`, "mixed");
  if (clubsTried >= 4) insight(`Tried ${clubsTried} different clubs and events. Sam explored a lot.`, "good");
  else if (clubsTried === 0) insight("Never went to a club or campus event.", "bad");
  if ((tally.doomscroll?.hours ?? 0) >= 4) insight(`${tally.doomscroll.hours} hours went to doomscrolling.`, "bad");
  if (talkedTotal >= 6 && ignoredTotal <= 2) insight(`Talked with people ${talkedTotal} times and rarely brushed anyone off.`, "good");
  if (ignoredTotal >= 4) insight(`Ignored people ${ignoredTotal} times. They noticed.`, "bad");
  if (peakBurnout >= 70) insight(`Burnout peaked at ${peakBurnout}.`, "bad");
  else if (peakBurnout < 40 && daysPlayed >= 5) insight(`Burnout never went above ${peakBurnout}. Sam kept a sustainable pace.`, "good");
  if (daysPlayed >= 3 && nights < daysPlayed - 1) insight(`Slept through only ${nights} of ${daysPlayed} nights.`, "bad");
  // Weekdays (Mon-Fri) that went by without going to class.
  const classDays = new Set(log.filter(([, e]) => e === "go_to_class").map(([t]) => Math.floor(t / 24)));
  let weekdays = 0;
  for (let day = 0; day < daysPlayed; day += 1) {
    const weekday = new Date(2026, 9, 1 + day).getDay();
    if (weekday >= 1 && weekday <= 5) weekdays += 1;
  }
  const skipped = Math.max(0, weekdays - [...classDays].filter((day) => {
    const weekday = new Date(2026, 9, 1 + day).getDay();
    return weekday >= 1 && weekday <= 5;
  }).length);
  if (weekdays >= 3) insight(skipped === 0 ? `Went to class every weekday.` : `Skipped class on ${skipped} of ${weekdays} weekdays.`, skipped === 0 ? "good" : skipped > weekdays / 2 ? "bad" : "mixed");
  if (talkedTotal < 3 && daysPlayed >= 5) insight(`Barely talked to anyone: ${talkedTotal} conversation${talkedTotal === 1 ? "" : "s"} all month.`, "bad");
  const happinessChange = state.sam.happiness - start.sam.happiness;
  if (Math.abs(happinessChange) >= 10) insight(`Happiness went from ${start.sam.happiness} to ${state.sam.happiness}.`, happinessChange > 0 ? "good" : "bad");
  if (favorites[0]) insight(`Most-picked choice: ${favorites[0].title} (${favorites[0].n} times).`, "neutral");
  if (earned > 0) insight(`Earned $${earned} and spent $${spent}.`, earned >= spent ? "good" : "mixed");
  if (insights.length === 0) insight("A quiet month. Sam kept things simple.", "neutral");

  // A one-line read on how Sam played the month.
  const styles = [
    { name: "The Grinder", when: awakeShare("Work") + awakeShare("Study") > 0.55, line: "Work and school came first, nearly every day." },
    { name: "The Social Butterfly", when: awakeShare("Clubs & events") + awakeShare("People") > 0.4 || talkedTotal >= 10, line: "Sam was out and about, meeting people and joining things." },
    { name: "The Explorer", when: clubsTried >= 5, line: "Sam tried a bit of everything campus had to offer." },
    { name: "The Night Owl", when: (tally.doomscroll?.hours ?? 0) >= 6 || (daysPlayed >= 4 && nights < daysPlayed / 2), line: "Late nights and screens shaped a lot of the month." },
    { name: "Running on Empty", when: peakBurnout >= 70, line: "Sam pushed hard enough to burn out." },
  ];
  const style = styles.find((s) => s.when) ?? { name: "The Balanced Student", line: "Sam spread time across school, people and rest." };

  return {
    daysPlayed,
    endedAt: whenText(state.time.day * 24 + state.time.hour),
    occupation: OCCUPATIONS[state.sam.occupation]?.detail ?? "Full-time student",
    highlights: uniqueHighlights,
    impact,
    impactSummary: { better, worse, same: impact.length - better - worse },
    decisions: {
      style,
      choices: log.length,
      nights,
      naps: tally.nap?.n ?? 0,
      hoursBy: CATEGORY_ORDER.map((name) => ({ name, hours: hoursBy[name], count: countBy[name] })).filter((c) => c.hours > 0 || c.count > 0),
      favorites,
      earned,
      spent,
      insights,
      skillsGained: Object.entries(SKILLS)
        .map(([id, label]) => ({ label, gained: (state.sam.skills?.[id] ?? 0) - (start.sam.skills?.[id] ?? 0) }))
        .filter((s) => s.gained > 0)
        .sort((a, b) => b.gained - a.gained),
    },
    memories: moments.map((m) => ({ t: m.t, when: whenText(m.t), kind: m.kind, text: m.text, because: phrase(m.because) })),
  };
}
