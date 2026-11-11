import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const statePath = join(dirname(fileURLToPath(import.meta.url)), "state.json");
const ENERGY_MAX = 5;
// Hunger is a fullness meter: 100 is full, 0 is starving.

export const EVENTS = {
  career_fair: {
    title: "Go to the career fair",
    summary: "Missed chemistry lab. Met a recruiter.",
    energyCost: 1,
    energyGain: 0,
    moneyCost: 8,
    happiness: { sam: 4, person1: -6, person2: 8 },
    money: { sam: -8, person1: 0, person2: -4 },
    health: { sam: -3, person1: 0, person2: -1 },
  },
  nap: {
    title: "Take a nap",
    summary: "Slept for an hour and got some energy back.",
    energyCost: 0,
    energyGain: 1,
    moneyCost: 0,
    happiness: { sam: 2, person1: 0, person2: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 5, person1: 0, person2: 0 },
  },
  captain_talk: {
    title: "Talk to Captain",
    summary: "Talked with Captain about the lab schedules and the skipped chemistry section.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 6, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
  },
  captain_busy: {
    title: "Tell Captain you are busy",
    summary: "Kindly told Captain this was a bad time. Captain headed off.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: -1, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
  },
  spark_talk: {
    title: "Talk to Spark",
    summary: "Talked with Spark about the club night they spent the afternoon pitching.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 3, person1: 0, person2: 6 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
  },
  spark_busy: {
    title: "Tell Spark you are busy",
    summary: "Kindly told Spark this was a bad time. Spark headed off.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 0, person2: -2 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
  },
};

// Who you can bump into on campus, and the choices each encounter offers.
// eventId null means the choice stays on the page (no stat change, no agent call).
// leaves: true sends the character away for a few hours after the choice.
export const MEETINGS = {
  captain: {
    name: "Captain",
    agent: "person1",
    spiel: "Captain flags you down. Their morning was a stack of lab schedules, and they are still sore that the chemistry section went uncovered.",
    options: [
      { eventId: "captain_talk", label: "Talk to them", hint: "Stay and hear the rest", leaves: true },
      { eventId: "captain_busy", label: "Kindly tell them you are busy", hint: "They head off", leaves: true },
      { eventId: null, label: "Ignore", hint: "Keep walking", leaves: false },
    ],
  },
  spark: {
    name: "Spark",
    agent: "person2",
    spiel: "Spark catches your sleeve. They spent the afternoon pitching a last-minute club night, and they want to tell you how it went.",
    options: [
      { eventId: "spark_talk", label: "Talk to them", hint: "Stay and hear the rest", leaves: true },
      { eventId: "spark_busy", label: "Kindly tell them you are busy", hint: "They head off", leaves: true },
      { eventId: null, label: "Ignore", hint: "Keep walking", leaves: false },
    ],
  },
};

function startingState() {
  return {
    hungerIsFullness: true,
    time: { day: 0, hour: 7 },
    sam: { name: "Sam", health: 80, hunger: 80, happiness: 50, money: 40, energy: ENERGY_MAX, energyMax: ENERGY_MAX },
    person1: { name: "Captain", health: 90, hunger: 90, happiness: 50, money: 80 },
    person2: { name: "Spark", health: 75, hunger: 65, happiness: 50, money: 15 },
  };
}

export function formatClock(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:00 ${suffix}`;
}

export function advanceHour(state) {
  const next = structuredClone(state);
  next.time.hour = (next.time.hour + 1) % 24;
  if (next.time.hour === 0) next.time.day += 1;
  for (const id of ["sam", "person1", "person2"]) {
    next[id].hunger = Math.max(0, next[id].hunger - 5);
  }
  return next;
}

function clampHundred(value) {
  return Math.max(0, Math.min(100, value));
}

export async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    const base = startingState();
    const oldHungerScale = parsed.hungerIsFullness !== true;
    for (const id of Object.keys(base)) {
      if (typeof base[id] !== "object") continue;
      parsed[id] = { ...base[id], ...parsed[id] };
    }
    if (oldHungerScale) {
      for (const id of ["sam", "person1", "person2"]) {
        parsed[id].hunger = 100 - parsed[id].hunger;
      }
      parsed.hungerIsFullness = true;
    }
    if (typeof parsed.time.day !== "number") parsed.time.day = 0;
    parsed.sam.energyMax = ENERGY_MAX;
    parsed.sam.energy = Math.min(parsed.sam.energy, ENERGY_MAX);
    return parsed;
  } catch {
    return startingState();
  }
}

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dayName(day) {
  return DAYS[day % 7];
}

export function newGame() {
  return startingState();
}

export async function saveState(state) {
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

export function applyEvent(state, eventId) {
  const event = EVENTS[eventId];
  if (event === undefined) {
    throw new Error("Unknown event.");
  }
  if (state.sam.energy < event.energyCost) {
    throw new Error(`Sam has ${state.sam.energy} energy. This choice costs ${event.energyCost}.`);
  }
  if (state.sam.money < event.moneyCost) {
    throw new Error(`Sam has $${state.sam.money}. This choice costs $${event.moneyCost}.`);
  }
  const next = structuredClone(state);
  next.sam.energy = Math.min(
    next.sam.energyMax,
    next.sam.energy - event.energyCost + event.energyGain,
  );
  for (const [id, delta] of Object.entries(event.happiness)) {
    next[id].happiness = clampHundred(next[id].happiness + delta);
  }
  for (const [id, delta] of Object.entries(event.health)) {
    next[id].health = clampHundred(next[id].health + delta);
  }
  for (const [id, delta] of Object.entries(event.money)) {
    next[id].money = Math.max(0, next[id].money + delta);
  }
  return next;
}

export function formatStats(state) {
  return [
    `${dayName(state.time.day)}, ${formatClock(state.time.hour)}.`,
    `Sam health ${state.sam.health}, hunger ${state.sam.hunger}/100 full, happiness ${state.sam.happiness}, money $${state.sam.money}, energy ${state.sam.energy}/${state.sam.energyMax}.`,
    `Captain health ${state.person1.health}, hunger ${state.person1.hunger}/100 full, happiness ${state.person1.happiness}, money $${state.person1.money}.`,
    `Spark health ${state.person2.health}, hunger ${state.person2.hunger}/100 full, happiness ${state.person2.happiness}, money $${state.person2.money}.`,
  ].join(" ");
}
