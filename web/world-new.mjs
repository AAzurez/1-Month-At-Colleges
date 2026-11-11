import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const statePath = join(dirname(fileURLToPath(import.meta.url)), "state.json");
const ENERGY_MAX = 5;
// The game runs from Thursday, October 1 until it reaches November 1.
// day 0 is October 1; day END_DAY is November 1, when the game ends.
export const CALENDAR = { year: 2026, startMonth: 9, startDate: 1, endDay: 31, startHour: 7 };
// Soft skills Sam builds up, 0 to 100. Events raise them through their skills field.
export const SKILLS = {
  communication: "Communication",
  teamwork: "Teamwork",
  leadership: "Leadership",
  networking: "Networking",
  timeManagement: "Time management",
};
// Interests Sam can pick up, 0 to 100 proficiency. Sam starts with none;
// an interest appears the first time a choice raises it.
export const INTERESTS = {
  coding: "Coding",
  soccer: "Soccer",
  debate: "Debate",
  boardGames: "Board games",
  film: "Film",
  hiking: "Hiking",
  volunteering: "Volunteering",
  fitness: "Fitness",
  personalHobby: "Personal hobby",
  research: "Research",
  internetCulture: "Internet culture",
  art: "Art",
  music: "Music",
  cooking: "Cooking",
  gaming: "Gaming",
  reading: "Reading",
};
// Weather is rolled once a day. weight is how likely each kind is in October.
// mood: happiness added to every choice except sleeping and napping.
// outdoor: extra effects on outdoor events (soccer, hiking). cancelled stops them for the day.
export const WEATHER = {
  sunny: { label: "Sunny", weight: 30, mood: 1, outdoor: { happiness: 3 } },
  partlyCloudy: { label: "Partly cloudy", weight: 25, mood: 0, outdoor: { happiness: 1 } },
  cloudy: { label: "Cloudy", weight: 20, mood: 0, outdoor: {} },
  rain: { label: "Rain", weight: 20, mood: -1, outdoor: { happiness: -4, health: -1, burnout: 3 } },
  storm: { label: "Thunderstorm", weight: 5, mood: -2, outdoor: { cancelled: true } },
};

// Burnout, 0 to 100. Each event's burnout field raises or lowers it.
// At BURNOUT_LIMIT or above Sam is burnt out: every choice costs 2 extra happiness and 1 health.
export const BURNOUT_LIMIT = 70;
// At STRAIN_LIMIT or above, ordinary choices that cost energy cost 1 more energy and 1 more happiness.
// Choices tied to Sam's interests (clubs, hobbies, the gym, research) are exempt and take off 3 extra burnout.
export const STRAIN_LIMIT = 50;

// What Sam does besides studying. Everyone starts as a student.
// pay, energy, burnout, happiness, health and hours are what one "Go to work" shift does.
export const OCCUPATIONS = {
  student: { label: "Student", detail: "Full-time student" },
  campus: { label: "Campus job", detail: "Barista", pay: 15, energy: 2, burnout: 5, happiness: -2, health: 0, hours: 3 },
  offCampus: { label: "Off-campus job", detail: "Assistant at a downtown tech office", pay: 35, energy: 3, burnout: 8, happiness: -3, health: -1, hours: 4 },
};
const STARTING_BURNOUT = 0;
// Sam loses 1 energy for every ENERGY_DRAIN_HOURS hours that pass.
export const ENERGY_DRAIN_HOURS = 3;

function rollWeather() {
  const total = Object.values(WEATHER).reduce((sum, kind) => sum + kind.weight, 0);
  let pick = Math.random() * total;
  for (const [id, kind] of Object.entries(WEATHER)) {
    pick -= kind.weight;
    if (pick < 0) return id;
  }
  return "sunny";
}
const STARTING_SKILLS = { communication: 10, teamwork: 10, leadership: 5, networking: 5, timeManagement: 10 };
// Hunger is a fullness meter: 100 is full, 0 is starving.

export const EVENTS = {
  go_to_class: {
    weekdaysOnly: true,
    hours: 2,
    title: "Go to class",
    summary: "Went to class and took notes.",
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: -1, person1: 2, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 1 },
    burnout: 4,
  },
  go_to_work: {
    title: "Go to work",
    group: "Work",
    summary: "Worked a shift.",
    // Pay and cost come from Sam's job in OCCUPATIONS.
    workShift: true,
    requires: { occupations: ["campus", "offCampus"] },
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 0, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { teamwork: 1, timeManagement: 1 },
  },
  find_campus_job: {
    hours: 1,
    title: "Find a campus job",
    group: "Work",
    summary: "Got hired as a barista at the campus cafe.",
    requires: { occupations: ["student"] },
    setsOccupation: "campus",
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 1, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 1 },
    burnout: 1,
  },
  find_offcampus_job: {
    hours: 2,
    title: "Apply for an off-campus job",
    group: "Work",
    summary: "Interviewed downtown and got hired as an office assistant.",
    // Needs networking 12 or communication 15 to get hired.
    requires: { occupations: ["student", "campus"], anySkill: { networking: 12, communication: 15 } },
    setsOccupation: "offCampus",
    roam: true,
    energyCost: 2,
    energyGain: 0,
    moneyCost: 5,
    happiness: { sam: 3, person1: 2, person2: 0 },
    money: { sam: -5, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { networking: 1 },
    burnout: 2,
  },
  quit_job: {
    hours: 0,
    title: "Quit your job",
    group: "Work",
    summary: "Quit the job to focus on being a student.",
    requires: { occupations: ["campus", "offCampus"] },
    setsOccupation: "student",
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: -1, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    burnout: -6,
  },
  do_homework: {
    hours: 2,
    title: "Do homework",
    summary: "Sat down and finished the problem set.",
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: -2, person1: 1, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 2 },
    burnout: 5,
  },
  work_on_hobby: {
    hours: 1,
    title: "Work on a hobby",
    group: "Personal",
    summary: "Spent an hour on a hobby just for fun.",
    // Adds hobbyBoost to Sam's strongest interest, or starts "Personal hobby" if there is none.
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 8, person1: 0, person2: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 1, person1: 0, person2: 0 },
    hobbyBoost: 4,
    burnout: -6,
  },
  grab_a_meal: {
    hours: 1,
    title: "Grab a meal",
    summary: "Got food at the dining hall.",
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 6,
    happiness: { sam: 2, person1: 0, person2: 0, person3: 1 },
    money: { sam: -6, person1: 0, person2: 0 },
    health: { sam: 1, person1: 0, person2: 0 },
    hunger: { sam: 35 },
    burnout: -2,
  },
  nap: {
    hours: 1,
    title: "Take a nap",
    summary: "Slept for an hour and got some energy back.",
    roam: true,
    energyCost: 0,
    energyGain: 1,
    moneyCost: 0,
    happiness: { sam: 2, person1: 0, person2: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 5, person1: 0, person2: 0 },
    burnout: -4,
  },
  go_to_gym: {
    hours: 1,
    title: "Go to the gym",
    summary: "Worked out at the campus gym.",
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 1, person2: 0, person3: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 5, person1: 0, person2: 0 },
    hunger: { sam: -10 },
    interests: { fitness: 4 },
    burnout: -5,
  },
  go_to_sleep: {
    title: "Go to sleep",
    summary: "Went to sleep and woke up at 7 AM.",
    roam: true,
    sleep: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 0, person2: 0, person3: 2 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 5, person1: 0, person2: 0 },
    burnout: -15,
  },
  do_research: {
    hours: 1,
    title: "Do some research",
    group: "Personal",
    summary: "Spent an hour reading up on something Sam is curious about.",
    // Builds Research and also deepens Sam's strongest interest.
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 1, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    interests: { research: 3 },
    hobbyBoost: 2,
    burnout: 1,
  },
  doomscroll: {
    title: "Doomscroll",
    group: "Personal",
    summary: "Lost an hour scrolling on the phone.",
    // Free and feels good, but burns an hour of the day and adds burnout.
    roam: true,
    hours: 1,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 3, person1: 0, person2: 0, person3: -1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    interests: { internetCulture: 2 },
    burnout: 2,
  },
  office_hours: {
    title: "Go to office hours",
    summary: "Went to office hours and finally understood the problem set.",
    hours: 1,
    weekdaysOnly: true,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 2, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 1, communication: 1 },
    burnout: -1,
  },
  library_study: {
    title: "Study at the library",
    summary: "Put in a focused study session at the library.",
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: -1, person1: 2, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 2 },
    burnout: 3,
  },
  cram: {
    title: "Cram for a quiz",
    summary: "Crammed for tomorrow's quiz with too much coffee.",
    hours: 2,
    roam: true,
    energyCost: 2,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: -2, person1: 1, person2: 0, person3: -1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 1 },
    burnout: 6,
  },
  dinner_friends: {
    title: "Get dinner with friends",
    summary: "Got dinner with friends at the dining hall and stayed talking.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 8,
    happiness: { sam: 4, person1: 0, person2: 2, person3: 1 },
    money: { sam: -8, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    hunger: { sam: 35 },
    skills: { networking: 1, communication: 1 },
    burnout: -3,
  },
  takeout: {
    title: "Order takeout",
    summary: "Ordered takeout and ate it in bed.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 14,
    happiness: { sam: 3, person1: 0, person2: 0, person3: -1 },
    money: { sam: -14, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    hunger: { sam: 40 },
    burnout: -1,
  },
  campus_walk: {
    title: "Take a walk around campus",
    summary: "Took a slow walk around campus to clear Sam's head.",
    hours: 1,
    outdoor: true,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 0, person2: 0, person3: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 1, person1: 0, person2: 0 },
    burnout: -3,
  },
  laundry: {
    title: "Do laundry",
    summary: "Finally did laundry. Clean socks for days.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 3,
    happiness: { sam: 1, person1: 1, person2: 0, person3: 1 },
    money: { sam: -3, person1: 0, person2: 0 },
    health: { sam: 1, person1: 0, person2: 0 },
    burnout: -1,
  },
  clean_room: {
    title: "Clean your room",
    summary: "Cleaned Sam's room top to bottom.",
    hours: 1,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 1, person2: 0, person3: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 1 },
    burnout: -2,
  },
  health_center: {
    title: "Visit the health center",
    summary: "Got checked out at the campus health center.",
    hours: 1,
    weekdaysOnly: true,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 0, person2: 0, person3: 2 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 8, person1: 0, person2: 0 },
    burnout: -2,
  },
  career_center: {
    title: "Visit the career center",
    summary: "Got a resume review at the career center.",
    hours: 1,
    weekdaysOnly: true,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 2, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { networking: 2, communication: 1 },
    burnout: 1,
  },
  call_home: {
    title: "Call home",
    group: "Personal",
    summary: "Called home and caught up with family.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 4, person1: 0, person2: 0, person3: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    burnout: -4,
  },
  journal: {
    title: "Write in a journal",
    group: "Personal",
    summary: "Wrote a page in Sam's journal about the week.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 0, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 1 },
    burnout: -3,
  },
  meditate: {
    title: "Meditate",
    group: "Personal",
    summary: "Did a short guided meditation.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 0, person2: 0, person3: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    burnout: -5,
  },
  watch_movie: {
    title: "Watch a movie",
    group: "Personal",
    summary: "Watched a movie in the lounge.",
    hours: 2,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 3, person1: 0, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    interests: { film: 2 },
    burnout: -4,
  },
  video_games: {
    title: "Play video games",
    group: "Personal",
    summary: "Played video games with the floor.",
    hours: 2,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 4, person1: 0, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { teamwork: 1 },
    interests: { gaming: 3 },
    burnout: -2,
  },
  read_novel: {
    title: "Read a novel",
    group: "Personal",
    summary: "Got lost in a novel for an hour.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 0, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    interests: { reading: 3 },
    burnout: -3,
  },
  online_shopping: {
    title: "Online shopping",
    group: "Personal",
    summary: "Bought a few things online that Sam didn't really need.",
    hours: 1,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 20,
    happiness: { sam: 5, person1: -1, person2: 0, person3: -1 },
    money: { sam: -20, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    burnout: -1,
  },
  sell_textbooks: {
    title: "Sell old textbooks",
    group: "Work",
    summary: "Sold last year's textbooks to the campus bookstore.",
    hours: 1,
    once: true,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 0, person2: 0, person3: 0 },
    money: { sam: 25, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
  },
  scholarship: {
    title: "Apply for a scholarship",
    group: "Work",
    summary: "Wrote a strong essay and won a small scholarship.",
    hours: 2,
    once: true,
    // Needs time management 20 or communication 25 to win it.
    requires: { anySkill: { timeManagement: 20, communication: 25 } },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 6, person1: 4, person2: 1, person3: 1 },
    money: { sam: 150, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 1 },
    burnout: 2,
  },
  grab_caffeine: {
    hours: 0,
    title: "Grab caffeine",
    summary: "Grabbed a coffee to push through.",
    roam: true,
    energyCost: 0,
    energyGain: 1,
    moneyCost: 4,
    happiness: { sam: 1, person1: 0, person2: 0, person3: -1 },
    money: { sam: -4, person1: 0, person2: 0 },
    health: { sam: -1, person1: 0, person2: 0 },
    burnout: 2,
  },
  club_coding: {
    hours: 2,
    title: "Coding Club meetup",
    group: "Today's events",
    summary: "Went to the Monday Coding Club meetup and paired on a side project.",
    when: { weekdays: ["Monday"] },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 4, person1: 0, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { teamwork: 2, communication: 1 },
    interests: { coding: 5 },
    burnout: 2,
  },
  club_soccer: {
    hours: 2,
    outdoor: true,
    title: "Intramural soccer",
    group: "Today's events",
    summary: "Played the Tuesday intramural soccer game.",
    when: { weekdays: ["Tuesday"] },
    roam: true,
    energyCost: 2,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 6, person1: 0, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 4, person1: 0, person2: 0 },
    hunger: { sam: -10 },
    skills: { teamwork: 3, leadership: 1 },
    interests: { soccer: 5 },
    burnout: -5,
  },
  club_debate: {
    hours: 2,
    title: "Debate Club practice",
    group: "Today's events",
    summary: "Argued a mock round at Wednesday Debate Club.",
    when: { weekdays: ["Wednesday"] },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 2, person1: 0, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 3, leadership: 2 },
    interests: { debate: 5 },
    burnout: 3,
  },
  club_board_games: {
    hours: 2,
    title: "Board Game Club",
    group: "Today's events",
    summary: "Went to Thursday Board Game Club and chipped in for pizza.",
    when: { weekdays: ["Thursday"] },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 3,
    happiness: { sam: 6, person1: 0, person2: 3 },
    money: { sam: -3, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    hunger: { sam: 15 },
    skills: { teamwork: 1, communication: 2 },
    interests: { boardGames: 5 },
    burnout: -6,
  },
  club_film: {
    hours: 2,
    title: "Film Club screening",
    group: "Today's events",
    summary: "Watched the Friday Film Club screening and stayed for the discussion.",
    when: { weekdays: ["Friday"] },
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 5, person1: 0, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 1, networking: 1 },
    interests: { film: 5 },
    burnout: -6,
  },
  club_hiking: {
    hours: 4,
    outdoor: true,
    title: "Hiking Club trip",
    group: "Today's events",
    summary: "Went on the Saturday Hiking Club trip off campus.",
    when: { weekdays: ["Saturday"] },
    roam: true,
    energyCost: 2,
    energyGain: 0,
    moneyCost: 5,
    happiness: { sam: 7, person1: 0, person2: 0 },
    money: { sam: -5, person1: 0, person2: 0 },
    health: { sam: 5, person1: 0, person2: 0 },
    hunger: { sam: -15 },
    skills: { teamwork: 2, leadership: 1 },
    interests: { hiking: 6 },
    burnout: -8,
  },
  club_volunteer: {
    hours: 2,
    title: "Volunteer Club shift",
    group: "Today's events",
    summary: "Helped at the Sunday Volunteer Club food drive.",
    when: { weekdays: ["Sunday"] },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 4, person1: 0, person2: 0, person3: 3 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { leadership: 2, teamwork: 2 },
    interests: { volunteering: 5 },
    burnout: 1,
  },
  open_mic: {
    title: "Open mic night",
    group: "Today's events",
    summary: "Watched (and maybe sang at) Monday open mic in the student union.",
    when: { weekdays: ["Monday"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 5, person1: 0, person2: 3, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 1 },
    interests: { music: 4 },
    burnout: -5,
  },
  trivia_night: {
    title: "Trivia night",
    group: "Today's events",
    summary: "Played Tuesday trivia with a team of near-strangers.",
    when: { weekdays: ["Tuesday"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 3,
    happiness: { sam: 4, person1: 0, person2: 2, person3: 0 },
    money: { sam: -3, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { teamwork: 2 },
    burnout: -3,
  },
  farmers_market: {
    title: "Farmers market",
    group: "Today's events",
    summary: "Wandered the Wednesday farmers market on the quad and grabbed lunch.",
    when: { weekdays: ["Wednesday"] },
    hours: 1,
    outdoor: true,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 5,
    happiness: { sam: 3, person1: 0, person2: 0, person3: 2 },
    money: { sam: -5, person1: 0, person2: 0 },
    health: { sam: 2, person1: 0, person2: 0 },
    hunger: { sam: 30 },
    interests: { cooking: 3 },
    burnout: -2,
  },
  guest_lecture: {
    title: "Guest lecture",
    group: "Today's events",
    summary: "Sat in on a Thursday guest lecture about AI and jobs.",
    when: { weekdays: ["Thursday"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 2, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { networking: 1, communication: 1 },
    interests: { research: 4 },
    burnout: 1,
  },
  friday_party: {
    title: "Friday night party",
    group: "Today's events",
    summary: "Went to a house party off campus and stayed out late.",
    when: { weekdays: ["Friday"] },
    hours: 3,
    roam: true,
    energyCost: 2,
    energyGain: 0,
    moneyCost: 5,
    happiness: { sam: 8, person1: -2, person2: 4, person3: -1 },
    money: { sam: -5, person1: 0, person2: 0 },
    health: { sam: -2, person1: 0, person2: 0 },
    hunger: { sam: -10 },
    skills: { networking: 2 },
    burnout: -8,
  },
  football_game: {
    title: "Football game",
    group: "Today's events",
    summary: "Cheered at the Saturday football game in the stands.",
    when: { weekdays: ["Saturday"] },
    hours: 3,
    outdoor: true,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 8,
    happiness: { sam: 6, person1: 0, person2: 3, person3: 0 },
    money: { sam: -8, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    hunger: { sam: -10 },
    skills: { networking: 1 },
    burnout: -6,
  },
  study_group: {
    title: "Library study group",
    group: "Today's events",
    summary: "Worked through the week's problem sets with a Sunday study group.",
    when: { weekdays: ["Sunday"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 3, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 2, teamwork: 1 },
    burnout: 3,
  },
  welcome_bbq: {
    title: "Welcome back BBQ",
    group: "Today's events",
    summary: "Got free burgers at the welcome back BBQ on the lawn.",
    when: { dates: ["10-2"] },
    hours: 1,
    outdoor: true,
    roam: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 4, person1: 0, person2: 2, person3: 1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    hunger: { sam: 40 },
    skills: { networking: 1 },
    burnout: -3,
  },
  midterm_review: {
    title: "Midterm review session",
    group: "Today's events",
    summary: "Went to the professor's midterm review session.",
    when: { dates: ["10-9"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: -1, person1: 3, person2: 0, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 3 },
    burnout: 3,
  },
  hackathon: {
    title: "Campus hackathon",
    group: "Today's events",
    summary: "Spent the afternoon building a scrappy app at the campus hackathon.",
    when: { dates: ["10-17"] },
    hours: 5,
    roam: true,
    energyCost: 2,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 5, person1: 1, person2: 3, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    hunger: { sam: -15 },
    skills: { teamwork: 3, leadership: 1 },
    interests: { coding: 8 },
    burnout: 4,
  },
  midterm_exam: {
    title: "Chemistry midterm",
    group: "Today's events",
    summary: "Sat the chemistry midterm.",
    when: { dates: ["10-21"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: -3, person1: 2, person2: -1, person3: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { timeManagement: 2 },
    burnout: 6,
  },
  fall_concert: {
    title: "Fall concert",
    group: "Today's events",
    summary: "Went to the fall concert at the amphitheater.",
    when: { dates: ["10-23"] },
    hours: 3,
    outdoor: true,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 10,
    happiness: { sam: 7, person1: 0, person2: 3, person3: 0 },
    money: { sam: -10, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { networking: 1 },
    interests: { music: 5 },
    burnout: -7,
  },
  pumpkin_patch: {
    title: "Pumpkin patch trip",
    group: "Today's events",
    summary: "Took the club shuttle to a pumpkin patch and picked a lopsided pumpkin.",
    when: { dates: ["10-24"] },
    hours: 4,
    outdoor: true,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 6,
    happiness: { sam: 6, person1: 0, person2: 2, person3: 2 },
    money: { sam: -6, person1: 0, person2: 0 },
    health: { sam: 2, person1: 0, person2: 0 },
    hunger: { sam: -10 },
    skills: { teamwork: 1 },
    burnout: -6,
  },
  haunted_house: {
    title: "Haunted house",
    group: "Today's events",
    summary: "Walked through the student-run haunted house in the old science building.",
    when: { dates: ["10-29"] },
    hours: 2,
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 5,
    happiness: { sam: 5, person1: 0, person2: 4, person3: 0 },
    money: { sam: -5, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { teamwork: 1 },
    burnout: -4,
  },
  career_fair: {
    hours: 3,
    title: "Career fair",
    group: "Today's events",
    summary: "Missed chemistry lab. Met a recruiter at the career fair.",
    when: { dates: ["10-14"] },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 8,
    happiness: { sam: 4, person1: -6, person2: 8 },
    money: { sam: -8, person1: 0, person2: -4 },
    health: { sam: -3, person1: 0, person2: -1 },
    skills: { networking: 6, communication: 2 },
    burnout: 6,
  },
  halloween_party: {
    hours: 3,
    title: "Halloween party",
    group: "Today's events",
    summary: "Went to the campus Halloween party in costume.",
    when: { dates: ["10-31"] },
    roam: true,
    energyCost: 1,
    energyGain: 0,
    moneyCost: 5,
    happiness: { sam: 10, person1: 0, person2: 6 },
    money: { sam: -5, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { networking: 3, communication: 2 },
    burnout: -10,
  },
  captain_talk: {
    npc: "captain",
    action: "talk",
    title: "Talk to Captain",
    summary: "Talked with Captain about the lab schedules and the skipped chemistry section.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 1, person1: 6, person2: 0 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 1, timeManagement: 1 },
    burnout: 1,
  },
  captain_busy: {
    npc: "captain",
    action: "busy",
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
    npc: "spark",
    action: "talk",
    title: "Talk to Spark",
    summary: "Talked with Spark about the club night they spent the afternoon pitching.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 3, person1: 0, person2: 6 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
    skills: { communication: 1, networking: 1 },
    burnout: -3,
  },
  sage_talk: {
    npc: "sage",
    action: "talk",
    title: "Talk to Sage",
    summary: "Sat with Sage on the quad bench and talked about how Sam is really doing.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 3, person1: 0, person2: 0, person3: 6 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 1, person1: 0, person2: 0 },
    skills: { communication: 1 },
    burnout: -4,
  },
  sage_busy: {
    npc: "sage",
    action: "busy",
    title: "Tell Sage you are busy",
    summary: "Kindly told Sage this was a bad time. Sage said to take care and headed off.",
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: { sam: 0, person1: 0, person2: 0, person3: -1 },
    money: { sam: 0, person1: 0, person2: 0 },
    health: { sam: 0, person1: 0, person2: 0 },
  },
  spark_busy: {
    npc: "spark",
    action: "busy",
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
// Everyone Sam can bump into on campus (up to 10). The first three have their own agents and stats
// (person1 to person3). The others are classmates with canned lines.
// spiel is what they say on a first meeting; grudge lines replace it once Sam has ignored them
// (the first line after 1 ignore, the second after 2, the last for 3 or more).
// talk is what talking to them does for Sam (classmates only; the main three use their events above).
export const NPCS = {
  captain: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["research", "debate"],
    role: "campus coach",
    name: "Captain",
    agent: "person1",
    color: "#2f5f8a",
    spiel: "Captain flags you down. Their morning was a stack of lab schedules, and they are still sore that the chemistry section went uncovered.",
    grudge: [
      "Captain blocks your path. \"You walked right past me last time. I noticed.\"",
      "Captain folds their arms. \"Twice now. Are you dodging me?\"",
      "Captain sighs. \"I have stopped counting how often you ignore me. Well, I have not. It is a lot.\"",
    ],
    lines: {
      busy: ["Fine. Finish what you started.", "Then go. Don't waste the hour."],
      ignore: ["Captain shakes their head and writes something down.", "Captain mutters, \"Noted.\""],
    },
  },
  spark: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["music", "boardGames", "film"],
    role: "social organizer",
    name: "Spark",
    agent: "person2",
    color: "#d4538a",
    spiel: "Spark catches your sleeve. They spent the afternoon pitching a last-minute club night, and they want to tell you how it went.",
    grudge: [
      "Spark waves, a little unsure. \"Hey... you didn't see me last time, right?\"",
      "Spark hesitates. \"Did I do something? You keep walking past me.\"",
      "Spark looks at the ground. \"I get it if you don't want to talk to me.\"",
    ],
    lines: {
      busy: ["Oh! Totally, no worries. Later?", "Okay okay, go go go!"],
      ignore: ["Spark's wave drops halfway.", "Spark pretends to check their phone."],
    },
  },
  sage: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["volunteering", "cooking"],
    role: "resident advisor",
    name: "Sage",
    agent: "person3",
    color: "#2f8f4e",
    spiel: "Sage waves you over to the quad bench. They spent the morning restocking the campus food pantry and want to know if you have eaten today.",
    grudge: [
      "Sage smiles gently. \"You looked rushed last time. Everything okay?\"",
      "Sage tilts their head. \"You've walked past a couple of times. I'm here when you're ready.\"",
      "Sage just nods at you. \"No pressure. The bench is always here.\"",
    ],
    lines: {
      busy: ["Of course. Drink some water, okay?", "Go on. Take care of yourself."],
      ignore: ["Sage lets you go without a word.", "Sage watches you go, a little worried."],
    },
  },
  mo: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["cooking", "music"],
    role: "cafe coworker",
    name: "Mo",
    color: "#8c5a2b",
    spiel: "Mo, your coworker from the campus cafe, raises a coffee cup at you. \"You on shift later?\"",
    grudge: ["Mo smirks. \"Too famous to say hi now?\"", "Mo raises an eyebrow. \"Again with the walk-by?\"", "Mo doesn't bother with the coffee cup this time."],
    talk: { happiness: 2, skills: { networking: 1 }, burnout: -1 },
    lines: {
      talk: ["Manager's in a mood today. Bring snacks.", "Tips were great this morning. You should pick up a shift."],
      busy: ["Cool, cool. See you at the counter."],
      ignore: ["Mo shrugs and sips their coffee."],
    },
  },
  priya: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["research"],
    role: "lab partner",
    name: "Priya",
    color: "#6b5ca5",
    spiel: "Priya, your chem lab partner, jogs over with a stack of notes. \"Did you finish the prelab?\"",
    grudge: ["Priya frowns. \"You know we share a grade, right?\"", "Priya sighs. \"I'll just do the prelab myself again.\"", "Priya walks past you without looking up."],
    talk: { happiness: 1, skills: { timeManagement: 1, teamwork: 1 }, burnout: 1 },
    lines: {
      talk: ["Let's split it: you take the data table, I'll write the intro.", "The TA said the quiz is on titrations. Study with me?"],
      busy: ["Okay, but text me tonight about the lab."],
      ignore: ["Priya clutches her notes and keeps going."],
    },
  },
  jules: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["film", "music"],
    role: "roommate",
    name: "Jules",
    color: "#c23b3b",
    spiel: "Jules, your roommate, bumps your shoulder. \"There's leftover pizza in the fridge. You're welcome.\"",
    grudge: ["Jules squints. \"You ignored me in public. Bold.\"", "Jules: \"Roommate code says you have to wave.\"", "Jules just points at you and says nothing."],
    talk: { happiness: 3, burnout: -2 },
    lines: {
      talk: ["Movie night Friday? I'll pick something bad on purpose.", "Our neighbor's playing guitar again. It's actually kind of good."],
      busy: ["Go. I'll eat your pizza."],
      ignore: ["Jules yells, \"Rude!\" from across the quad."],
    },
  },
  dev: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["debate"],
    role: "Debate Club president",
    name: "Dev",
    color: "#4a7c8c",
    spiel: "Dev, the Debate Club president, hands you a flyer. \"Wednesday. Be there. We need a fourth speaker.\"",
    grudge: ["Dev: \"I'll take your silence as a maybe.\"", "Dev: \"Strong strategy, avoiding the recruiter.\"", "Dev quietly takes the flyer back."],
    talk: { happiness: 1, skills: { leadership: 1, communication: 1 } },
    lines: {
      talk: ["You'd be good at rebuttals. You think fast.", "Tip: argue the side you disagree with. It makes you sharper."],
      busy: ["Wednesday. I'm holding a spot."],
      ignore: ["Dev pins the flyer to a tree near you instead."],
    },
  },
  rosa: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["coding"],
    role: "CS TA",
    name: "Rosa",
    color: "#a36a1f",
    spiel: "Rosa, the CS TA, stops you. \"Office hours are open today if you're stuck on the lab.\"",
    grudge: ["Rosa: \"Office hours are still open... if you want them.\"", "Rosa gives a small, tired wave.", "Rosa doesn't stop this time."],
    talk: { happiness: 1, skills: { timeManagement: 1, communication: 1 } },
    lines: {
      talk: ["Start the lab early. The last test case is the tricky one.", "Write the tests first. Trust me."],
      busy: ["No problem. Hours are on the course page."],
      ignore: ["Rosa goes back to grading on her laptop."],
    },
  },
  theo: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["fitness", "soccer", "hiking"],
    role: "gym regular",
    name: "Theo",
    color: "#6f7d2a",
    spiel: "Theo, a gym regular, jogs up beside you. \"Leg day. You in?\"",
    grudge: ["Theo: \"Skipping me AND leg day?\"", "Theo jogs a slow circle around you.", "Theo just flexes and jogs off."],
    talk: { happiness: 1, health: 1, burnout: -1 },
    lines: {
      talk: ["Hydrate before, not after. Game changer.", "Ten-minute walk after dinner. Try it for a week."],
      busy: ["All good. Gym's open till eleven."],
      ignore: ["Theo shrugs and keeps jogging."],
    },
  },
  kai: {
    // Interests this person can inspire in Sam (plus one random extra each game).
    inspires: ["art"],
    role: "art student",
    name: "Kai",
    color: "#d07a2f",
    spiel: "Kai, an art student, is sketching on the steps. \"Hold still. You've got a good silhouette.\"",
    grudge: ["Kai: \"You ruined the sketch last time by leaving.\"", "Kai keeps sketching but glances up at you.", "Kai turns their sketchbook away from you."],
    talk: { happiness: 2, burnout: -2 },
    lines: {
      talk: ["Drawing is just noticing things slowly.", "Come to the open studio Thursday. Bring nothing."],
      busy: ["Go, go. I'll draw you from memory."],
      ignore: ["Kai erases something on the page."],
    },
  },
};

// Each person's popup choices. Every choice sends them away for a while.
export const MEETINGS = Object.fromEntries(
  Object.entries(NPCS).map(([id, npc]) => [
    id,
    {
      name: npc.name,
      agent: npc.agent ?? null,
      color: npc.color,
      spiel: npc.spiel,
      grudge: npc.grudge,
      lines: npc.lines,
      options: [
        { eventId: `${id}_talk`, label: "Talk to them", hint: "Stay and hear the rest", leaves: true },
        { eventId: `${id}_busy`, label: "Kindly tell them you are busy", hint: "They head off", leaves: true },
        { eventId: `${id}_ignore`, label: "Ignore", hint: "They remember", leaves: true },
        { eventId: `${id}_hangout`, label: "Invite them to grab food", hint: "1 hour, $6", leaves: true },
      ],
    },
  ]),
);

// Classmates' talk and busy choices, and everyone's ignore and hang-out choices, are built from the roster.
// "quiet" choices are saved but do not wait for an agent reply.
const STAT_IDS = { captain: "person1", spark: "person2", sage: "person3" };
for (const [id, npc] of Object.entries(NPCS)) {
  const statId = STAT_IDS[id];
  if (npc.agent === undefined) {
    EVENTS[`${id}_talk`] = {
      title: `Talk to ${npc.name}`,
      summary: `Chatted with ${npc.name}.`,
      npc: id,
      action: "talk",
      quiet: true,
      energyCost: 0,
      energyGain: 0,
      moneyCost: 0,
      happiness: { sam: npc.talk.happiness ?? 0 },
      money: { sam: 0 },
      health: { sam: npc.talk.health ?? 0 },
      skills: npc.talk.skills,
      interests: npc.talk.interests,
      burnout: npc.talk.burnout,
    };
    EVENTS[`${id}_busy`] = {
      title: `Tell ${npc.name} you are busy`,
      summary: `Kindly told ${npc.name} this was a bad time.`,
      npc: id,
      action: "busy",
      quiet: true,
      energyCost: 0,
      energyGain: 0,
      moneyCost: 0,
      happiness: { sam: 0 },
      money: { sam: 0 },
      health: { sam: 0 },
    };
  }
  // Grabbing food together: costs an hour and $6, feeds Sam, and means a lot more than a quick hello.
  // With Captain, Spark or Sage it waits for their agent's reply like a talk does.
  EVENTS[`${id}_hangout`] = {
    title: `Grab food with ${npc.name}`,
    summary: `Grabbed food with ${npc.name} and actually caught up.`,
    npc: id,
    action: "hangout",
    quiet: npc.agent === undefined,
    hours: 1,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 6,
    happiness: statId ? { sam: 4, [statId]: 6 } : { sam: 4 },
    money: { sam: -6 },
    health: { sam: 0 },
    hunger: { sam: 30 },
    skills: { networking: 1, communication: 1 },
    burnout: -3,
  };
  EVENTS[`${id}_ignore`] = {
    title: `Ignored ${npc.name}`,
    summary: `Walked right past ${npc.name} without saying anything.`,
    npc: id,
    action: "ignore",
    quiet: true,
    energyCost: 0,
    energyGain: 0,
    moneyCost: 0,
    happiness: statId ? { sam: 0, [statId]: -3 } : { sam: 0 },
    money: { sam: 0 },
    health: { sam: 0 },
  };
}


// ---- Passions: special choices that unlock as an interest grows ----------------------------------
// At Developing (25) and Skilled (50), each interest adds a choice to the "Passions" section.
// Each one deepens the interest, eases burnout (it's something Sam enjoys) and sometimes pays.
const PASSION_PATHS = {
  coding: [
    { title: "Build a side project", summary: "Spent the afternoon building a small app of Sam's own.", hours: 2, gain: 5, skills: { timeManagement: 1 } },
    { title: "Freelance a small app", summary: "Built a simple website for a local shop and got paid.", hours: 3, gain: 6, money: 40, skills: { networking: 1, communication: 1 } },
  ],
  soccer: [
    { title: "Practice free kicks", summary: "Stayed after practice drilling free kicks.", hours: 1, gain: 5, health: 2, outdoor: true },
    { title: "Captain a pickup match", summary: "Organized and captained a pickup match on the turf.", hours: 2, gain: 6, health: 2, skills: { leadership: 2, teamwork: 1 }, outdoor: true },
  ],
  debate: [
    { title: "Write a mock case", summary: "Drafted a full mock case for next week's motion.", hours: 2, gain: 5, skills: { communication: 1 } },
    { title: "Enter a debate tournament", summary: "Competed in a weekend debate tournament.", hours: 4, energy: 2, gain: 7, skills: { communication: 2, leadership: 1 } },
  ],
  boardGames: [
    { title: "Design a board game", summary: "Sketched rules and cards for an original board game.", hours: 2, gain: 5, skills: { teamwork: 1 } },
    { title: "Host a game night", summary: "Hosted a packed game night in the lounge.", hours: 3, money: -6, gain: 6, skills: { leadership: 1, networking: 1 } },
  ],
  film: [
    { title: "Shoot a short film", summary: "Shot a two-minute short on a phone around campus.", hours: 2, gain: 5, skills: { teamwork: 1 } },
    { title: "Submit to the student film fest", summary: "Edited the short and submitted it to the student film festival.", hours: 3, gain: 7, skills: { communication: 1, networking: 1 } },
  ],
  hiking: [
    { title: "Scout a new trail", summary: "Scouted a trail at the edge of town.", hours: 3, gain: 5, health: 3, outdoor: true },
    { title: "Lead a sunrise hike", summary: "Led a group up the hill for sunrise.", hours: 4, energy: 2, gain: 6, health: 3, skills: { leadership: 2 }, outdoor: true },
  ],
  volunteering: [
    { title: "Tutor at the community center", summary: "Tutored middle schoolers at the community center.", hours: 2, gain: 5, skills: { communication: 1 } },
    { title: "Organize a donation drive", summary: "Organized a campus-wide donation drive.", hours: 3, gain: 7, skills: { leadership: 2, networking: 1 } },
  ],
  fitness: [
    { title: "Train for the campus 5K", summary: "Did an interval run training for the campus 5K.", hours: 1, gain: 5, health: 3, hunger: -10 },
    { title: "Run the campus 5K", summary: "Ran the campus 5K and beat Sam's goal time.", hours: 2, energy: 2, gain: 7, health: 4, hunger: -15, outdoor: true },
  ],
  personalHobby: [
    { title: "Make something just for fun", summary: "Lost track of time making something just for fun.", hours: 2, gain: 5 },
    { title: "Share a hobby project online", summary: "Shared a hobby project online and people loved it.", hours: 2, gain: 6, skills: { networking: 1 } },
  ],
  research: [
    { title: "Read a research paper", summary: "Worked through a research paper and took notes.", hours: 2, gain: 5, skills: { timeManagement: 1 } },
    { title: "Assist in a research lab", summary: "Helped run an experiment in a professor's lab.", hours: 3, gain: 7, money: 20, skills: { networking: 1, teamwork: 1 } },
  ],
  internetCulture: [
    { title: "Start a meme page", summary: "Started a campus meme page. It got a few followers.", hours: 1, gain: 5, skills: { communication: 1 } },
    { title: "Grow the meme page", summary: "The meme page went semi-viral on campus.", hours: 2, gain: 6, skills: { networking: 2 } },
  ],
  art: [
    { title: "Paint in the studio", summary: "Painted for a while in the open studio.", hours: 2, gain: 5 },
    { title: "Show work in the student gallery", summary: "Hung a piece in the student gallery show.", hours: 3, gain: 7, money: 15, skills: { networking: 1, communication: 1 } },
  ],
  music: [
    { title: "Practice guitar", summary: "Practiced guitar until the chord changes felt easy.", hours: 1, gain: 5 },
    { title: "Play a paid gig", summary: "Played a short paid set at the campus cafe.", hours: 3, gain: 7, money: 30, skills: { communication: 1 } },
  ],
  gaming: [
    { title: "Stream a game night", summary: "Streamed a game night for friends online.", hours: 2, gain: 5, skills: { communication: 1 } },
    { title: "Enter a campus esports match", summary: "Played in a campus esports match and made it to the semis.", hours: 3, gain: 7, skills: { teamwork: 2 } },
  ],
  reading: [
    { title: "Join a book club", summary: "Joined a book club and argued about the ending.", hours: 2, gain: 5, skills: { communication: 1 } },
    { title: "Review a book for the student paper", summary: "Wrote a book review that ran in the student paper.", hours: 2, gain: 7, money: 15, skills: { communication: 2 } },
  ],
  cooking: [
    { title: "Try a new recipe", summary: "Cooked a new recipe in the dorm kitchen.", hours: 1, money: -4, gain: 5, hunger: 35 },
    { title: "Cook dinner for friends", summary: "Cooked a big dinner for friends on the floor.", hours: 2, money: -10, gain: 6, hunger: 40, skills: { teamwork: 1, networking: 1 } },
  ],
};
export const PASSION_LEVELS = [25, 50];

for (const [interest, steps] of Object.entries(PASSION_PATHS)) {
  steps.forEach((step, index) => {
    const money = step.money ?? 0;
    EVENTS[`passion_${interest}_${index + 1}`] = {
      title: step.title,
      group: "Passions",
      summary: step.summary,
      hours: step.hours,
      outdoor: step.outdoor,
      requires: { interest: { [interest]: PASSION_LEVELS[index] } },
      passion: interest,
      roam: true,
      energyCost: step.energy ?? 1,
      energyGain: 0,
      moneyCost: money < 0 ? -money : 0,
      happiness: { sam: 3 + index, person1: 0, person2: 0 },
      money: { sam: money, person1: 0, person2: 0 },
      health: { sam: step.health ?? 0, person1: 0, person2: 0 },
      ...(step.hunger ? { hunger: { sam: step.hunger } } : {}),
      skills: step.skills,
      interests: { [interest]: step.gain },
      burnout: -3 - index,
    };
  });
}

export function passionFor(interest, level) {
  const index = PASSION_LEVELS.indexOf(level);
  return index >= 0 ? EVENTS[`passion_${interest}_${index + 1}`] ?? null : null;
}

// ---- Random cast and start ----------------------------------------------------------------------
// Every new game gives everyone a fresh name, Sam random soft skills and a first interest,
// and each person a slightly different mood and one extra interest they can inspire.
const NAME_POOL = [
  "Alex", "Avery", "Bea", "Cam", "Dani", "Eli", "Emi", "Finn", "Gabe", "Hana", "Ines", "Jae", "Jo", "Kai", "Lena",
  "Leo", "Luz", "Maya", "Mo", "Nia", "Noor", "Omar", "Priya", "Quinn", "Rafa", "Remy", "Rosa", "Ravi", "Sage", "Sol",
  "Tara", "Theo", "Uma", "Vic", "Wren", "Yara", "Yusuf", "Zane", "Zoe", "Ash", "Bo", "Cleo", "Dev", "Ezra", "Ivy",
];
const PLAYER_NAMES = [
  "Sam", "Riley", "Jordan", "Casey", "Morgan", "Taylor", "Jamie", "Robin", "Skyler", "Harper", "Rowan", "Parker",
  "Emerson", "Logan", "Reese", "Drew", "Kendall", "Blake", "Hayden", "Marlowe", "Arden", "Sasha", "Nico", "Kiran",
];
const STARTER_INTERESTS = ["coding", "music", "art", "fitness", "film", "cooking", "hiking", "research", "debate", "boardGames"];

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomCast(playerName) {
  const names = shuffled(NAME_POOL.filter((name) => name !== playerName)).slice(0, Object.keys(NPCS).length);
  return Object.fromEntries(Object.keys(NPCS).map((id, i) => [id, names[i]]));
}

function randomInspires() {
  const all = Object.keys(INTERESTS).filter((id) => id !== "personalHobby");
  return Object.fromEntries(
    Object.entries(NPCS).map(([id, npc]) => {
      const extra = shuffled(all.filter((interest) => !npc.inspires.includes(interest)))[0];
      return [id, [...npc.inspires, extra]];
    }),
  );
}

export function nameOf(state, id) {
  if (id === "sam") return playerName(state);
  return state?.names?.[id] ?? NPCS[id]?.name ?? id;
}

// The player's first name this game (content is written with "Sam").
export function playerName(state) {
  return state?.sam?.name ?? "Sam";
}

// Only swaps "Sam" for the player's name. Use it on text whose other names are already this game's names.
export function withPlayer(text, state) {
  if (typeof text !== "string") return text;
  const name = playerName(state);
  return name === "Sam" ? text : text.replace(/\bSam\b/g, name);
}

// Swaps the default names in any text (lines, titles, summaries) for this game's names.
const DEFAULT_NAMES = [...Object.entries(NPCS).map(([id, npc]) => [id, npc.name]), ["sam", "Sam"]].map(([id, name]) => [id, new RegExp(`\\b${name}\\b`, "g")]);
export function personalize(text, state) {
  if (typeof text !== "string" || !state) return text;
  let out = text;
  for (const [id, pattern] of DEFAULT_NAMES) out = out.replace(pattern, `\u0000${id}\u0000`);
  return out.replace(/\u0000(\w+)\u0000/g, (_, id) => nameOf(state, id));
}

function personalizeDeep(value, state) {
  if (typeof value === "string") return personalize(value, state);
  if (Array.isArray(value)) return value.map((item) => personalizeDeep(item, state));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, personalizeDeep(v, state)]));
  return value;
}

// Events and meetings with this game's names, as sent to the page.
export function castView(state) {
  const events = {};
  for (const [id, event] of Object.entries(EVENTS)) {
    events[id] = { ...event, title: personalize(event.title, state), summary: personalize(event.summary, state) };
  }
  return { events, meetings: personalizeDeep(MEETINGS, state) };
}

// Talking to someone Sam has ignored is awkward: -1 happiness per ignore, up to -3.
export const GRUDGE_MAX = 3;
// Classmates' moods: where they start, how Sam's choices move them, and what a chat between two people adds.
const STARTING_MOOD = 60;
const CLASSMATE_MOOD = { talk: 3, busy: -1, ignore: -3, hangout: 6 };
const CHAT_MOOD = 1;
// Inspiration from a conversation: more if Sam already shares the interest.
const INSPIRE_SHARED = 4;
const INSPIRE_NEW = 3;

function startingState() {
  return {
    hungerIsFullness: true,
    time: { day: 0, hour: CALENDAR.startHour },
    over: false,
    weather: rollWeather(),
    // Today's events (events with "when") Sam already did today. Cleared at midnight.
    doneToday: [],
    // How Sam has treated each person: { captain: { talk: 2, busy: 0, ignore: 1 }, ... }
    relations: {},
    hoursSinceDrain: 0,
    // Lets the page tell games apart, so it can keep the feed across refreshes.
    gameId: Math.random().toString(36).slice(2, 10),
    // Classmates' mood, 0 to 100 (Captain, Spark and Sage use their own happiness instead).
    moods: Object.fromEntries(Object.keys(NPCS).filter((id) => !(id in STAT_IDS)).map((id) => [id, STARTING_MOOD])),
    // This game's names for everyone, and who can inspire which interests.
    names: {},
    inspires: {},
    // One compact snapshot per game hour: [hour of the month, health, hunger, happiness, money, energy, burnout].
    history: [],
    // What happened, for the end-of-game recap (see web/recap.mjs):
    // log: every choice as [hour of the month, eventId].
    // tally: per choice, how often it was picked, hours spent, and what it did to Sam and the agents.
    // moments: memorable things (firsts, milestones, grudges) with the choices that led to them.
    log: [],
    tally: {},
    moments: [],
    sam: { name: "Sam", health: 100, hunger: 100, happiness: 50, money: 100, energy: ENERGY_MAX, energyMax: ENERGY_MAX, burnout: STARTING_BURNOUT, occupation: "student", skills: { ...STARTING_SKILLS }, interests: {} },
    person1: { name: "Captain", health: 90, hunger: 90, happiness: 50, money: 80 },
    person2: { name: "Spark", health: 75, hunger: 65, happiness: 50, money: 15 },
    person3: { name: "Sage", health: 85, hunger: 80, happiness: 60, money: 45 },
  };
}

export function formatClock(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:00 ${suffix}`;
}

// Burnout drifts each waking hour from how Sam is doing: low energy, low happiness and low hunger
// each push it up (1 or 2 points); when all three are in good shape it eases down by 1.
// Asleep, it eases down by 1 an hour.
export function burnoutDrift(sam, asleep = false) {
  if (asleep) return -1;
  let drift = 0;
  if (sam.energy <= 1) drift += 2;
  else if (sam.energy <= 2) drift += 1;
  if (sam.happiness < 30) drift += 2;
  else if (sam.happiness < 50) drift += 1;
  if (sam.hunger < 25) drift += 2;
  else if (sam.hunger < 50) drift += 1;
  if (drift === 0 && sam.energy >= 3 && sam.happiness >= 60 && sam.hunger >= 50) drift = -1;
  return drift;
}

export function advanceHour(state, asleep = false) {
  if (state.over) return state;
  const next = structuredClone(state);
  next.time.hour = (next.time.hour + 1) % 24;
  if (next.time.hour === 0) {
    next.time.day += 1;
    next.weather = rollWeather();
    next.doneToday = [];
  }
  if (next.time.day >= CALENDAR.endDay) {
    next.time.day = CALENDAR.endDay;
    next.time.hour = 0;
    next.over = true;
  }
  for (const id of ["sam", "person1", "person2", "person3"]) {
    next[id].hunger = Math.max(0, next[id].hunger - 5);
  }
  next.hoursSinceDrain = (next.hoursSinceDrain ?? 0) + 1;
  if (next.hoursSinceDrain >= ENERGY_DRAIN_HOURS) {
    next.hoursSinceDrain = 0;
    next.sam.energy = Math.max(0, next.sam.energy - 1);
  }
  next.sam.burnout = clampHundred((next.sam.burnout ?? 0) + burnoutDrift(next.sam, asleep));
  next.history = [...(state.history ?? []), snapshot(next)];
  noticeHourly(state, next);
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
      // Fill in missing fields of objects (sam, person1, ...). Lists like history and doneToday are kept as they are.
      if (typeof base[id] !== "object" || base[id] === null || Array.isArray(base[id])) continue;
      parsed[id] = { ...base[id], ...parsed[id] };
    }
    if (oldHungerScale) {
      for (const id of ["sam", "person1", "person2", "person3"]) {
        parsed[id].hunger = 100 - parsed[id].hunger;
      }
      parsed.hungerIsFullness = true;
    }
    if (typeof parsed.time.day !== "number") parsed.time.day = 0;
    parsed.over = parsed.time.day >= CALENDAR.endDay;
    if (WEATHER[parsed.weather] === undefined) parsed.weather = rollWeather();
    if (!Array.isArray(parsed.doneToday)) parsed.doneToday = [];
    if (typeof parsed.gameId !== "string") parsed.gameId = "legacy";
    if (typeof parsed.names !== "object" || parsed.names === null) parsed.names = {};
    if (typeof parsed.inspires !== "object" || parsed.inspires === null) parsed.inspires = {};
    if (typeof parsed.relations !== "object" || parsed.relations === null) parsed.relations = {};
    if (!Array.isArray(parsed.history)) parsed.history = [];
    if (!Array.isArray(parsed.log)) parsed.log = [];
    if (!Array.isArray(parsed.moments)) parsed.moments = [];
    if (typeof parsed.tally !== "object" || parsed.tally === null || Array.isArray(parsed.tally)) parsed.tally = {};
    parsed.moods = { ...base.moods, ...parsed.moods };
    parsed.sam.skills = { ...STARTING_SKILLS, ...parsed.sam.skills };
    if (typeof parsed.sam.burnout !== "number") parsed.sam.burnout = STARTING_BURNOUT;
    if (OCCUPATIONS[parsed.sam.occupation] === undefined) parsed.sam.occupation = "student";
    parsed.sam.interests = { ...parsed.sam.interests };
    parsed.sam.energyMax = ENERGY_MAX;
    parsed.sam.energy = Math.min(parsed.sam.energy, ENERGY_MAX);
    return parsed;
  } catch {
    // No save yet: start a game and save it, so every request sees the same random cast.
    const fresh = newGame();
    try {
      await saveState(fresh);
    } catch {
      // Read-only folder: the game still runs, it just won't persist.
    }
    return fresh;
  }
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function calendarDate(day) {
  return new Date(CALENDAR.year, CALENDAR.startMonth, CALENDAR.startDate + day);
}

export function dayName(day) {
  return DAYS[calendarDate(day).getDay()];
}

// An event with "when" only shows up on matching weekdays or dates ("10-14" is October 14).
export function isAvailable(event, day) {
  const date = calendarDate(day);
  // weekdaysOnly: Monday to Friday (classes).
  if (event.weekdaysOnly && (date.getDay() === 0 || date.getDay() === 6)) return false;
  if (event.when === undefined) return true;
  const key = `${date.getMonth() + 1}-${date.getDate()}`;
  if (event.when.weekdays?.includes(DAYS[date.getDay()])) return true;
  if (event.when.dates?.includes(key)) return true;
  return false;
}

export function dateText(day) {
  const date = calendarDate(day);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}


// ---- Memories for the recap ------------------------------------------------------------------

const MOMENT_LIMIT = 150;
const SAM_FIELDS = ["health", "hunger", "happiness", "money", "energy", "burnout"];
const INTEREST_LEVELS = [[75, "Expert"], [50, "Skilled"], [25, "Developing"]];
const SKILL_MARKS = [50, 35, 20];

export function hourOfMonth(state) {
  return state.time.day * 24 + state.time.hour;
}

// Adds a moment to state.moments (once per key). t defaults to the state's own clock.
function remember(state, key, moment, t = hourOfMonth(state)) {
  state.moments = state.moments ?? [];
  if (key && state.moments.some((item) => item.key === key)) return;
  state.moments.push({ t, key, ...moment });
  if (state.moments.length > MOMENT_LIMIT) state.moments.shift();
}

// The choices that did the most for one measure so far (sign -1 for the ones that lowered it most).
// Returns [{ e: eventId, n: times picked, v: total effect }].
export function topContributors(state, measure, sign = 1, limit = 2) {
  return Object.entries(state.tally ?? {})
    .map(([e, record]) => ({ e, n: record.n, v: measure(record) ?? 0 }))
    .filter((item) => item.v * sign > 0)
    .sort((a, b) => b.v * sign - a.v * sign)
    .slice(0, limit);
}

const NOTABLE_FIRSTS = new Set(["go_to_work", "go_to_class", "go_to_gym", "do_research", "work_on_hobby"]);

// Called once per choice, after its effects and before any hours pass.
function recordChoice(before, next, eventId, hours) {
  const event = EVENTS[eventId];
  next.log = [...(before.log ?? []), [hourOfMonth(before), eventId]];
  const tally = { ...(before.tally ?? {}) };
  const record = structuredClone(tally[eventId] ?? { n: 0, hours: 0, d: {}, sk: {}, in: {}, p: {} });
  record.n += 1;
  record.hours += hours;
  for (const field of SAM_FIELDS) record.d[field] = (record.d[field] ?? 0) + ((next.sam[field] ?? 0) - (before.sam[field] ?? 0));
  for (const id of Object.keys(SKILLS)) {
    const delta = (next.sam.skills?.[id] ?? 0) - (before.sam.skills?.[id] ?? 0);
    if (delta) record.sk[id] = (record.sk[id] ?? 0) + delta;
  }
  for (const id of Object.keys(INTERESTS)) {
    const delta = (next.sam.interests?.[id] ?? 0) - (before.sam.interests?.[id] ?? 0);
    if (delta) record.in[id] = (record.in[id] ?? 0) + delta;
  }
  for (const id of Object.keys(NPCS)) {
    const delta = moodOf(next, id) - moodOf(before, id);
    if (delta) record.p[id] = (record.p[id] ?? 0) + delta;
  }
  tally[eventId] = record;
  next.tally = tally;
  next.moments = [...(before.moments ?? [])];

  const why = (measure, sign = 1) => topContributors(next, measure, sign);
  // Moments from a choice are stamped with the time the choice was made.
  const note = (key, moment) => remember(next, key, moment, hourOfMonth(before));

  // Firsts worth remembering: special events, jobs, and the first real conversation with each person.
  if (event.when || event.setsOccupation || event.once || NOTABLE_FIRSTS.has(eventId) || (event.npc && (event.action === "talk" || event.action === "hangout"))) {
    note(`first:${eventId}`, { kind: "first", e: eventId, text: firstText(event, before) });
  }
  if (event.setsOccupation && event.setsOccupation !== before.sam.occupation) {
    const job = OCCUPATIONS[event.setsOccupation];
    const gate = event.requires?.anySkill;
    const because = gate ? why((r) => Object.keys(gate).reduce((sum, skill) => sum + (r.sk[skill] ?? 0), 0)) : [{ e: eventId, n: 1, v: 1 }];
    note(`job:${event.setsOccupation}:${before.time.day}`, {
      kind: "job",
      text: event.setsOccupation === "student" ? "Quit the job to focus on school." : `Got hired: ${job.detail}.`,
      because,
    });
  }
  for (const id of Object.keys(INTERESTS)) {
    const was = before.sam.interests?.[id] ?? 0;
    const now = next.sam.interests?.[id] ?? 0;
    for (const [mark, level] of INTEREST_LEVELS) {
      if (was < mark && now >= mark) {
        const unlocked = passionFor(id, mark);
        const extra = unlocked ? ` New choice: ${unlocked.title}.` : "";
        note(`interest:${id}:${mark}`, { kind: "growth", text: `${INTERESTS[id]} became ${level} (${now}).${extra}`, because: why((r) => r.in[id]) });
        break;
      }
    }
  }
  for (const id of Object.keys(SKILLS)) {
    const was = before.sam.skills?.[id] ?? 0;
    const now = next.sam.skills?.[id] ?? 0;
    for (const mark of SKILL_MARKS) {
      if (was < mark && now >= mark) {
        note(`skill:${id}:${mark}`, { kind: "growth", text: `${SKILLS[id]} reached ${now}.`, because: why((r) => r.sk[id]) });
        break;
      }
    }
  }
  if (event.npc) {
    const relation = next.relations?.[event.npc] ?? {};
    const name = nameOf(before, event.npc);
    if (event.action === "ignore" && relation.ignore === 3) {
      note(`grudge:${event.npc}`, { kind: "people", text: `${name} stopped expecting a hello.`, because: [{ e: eventId, n: 3, v: 3 }] });
    }
    if ((event.action === "talk" || event.action === "hangout") && (relation.talk ?? 0) + (relation.hangout ?? 0) === 3) {
      note(`friend:${event.npc}`, { kind: "people", text: `${name} started to feel like a friend.`, because: [{ e: eventId, n: 3, v: 3 }] });
    }
  }
  if (before.sam.money >= 10 && next.sam.money < 10) {
    note(`broke:${before.time.day}`, { kind: "warning", text: `Money ran down to $${next.sam.money}.`, because: why((r) => r.d.money, -1) });
  }
  for (const mark of [200, 300, 500]) {
    if (before.sam.money < mark && next.sam.money >= mark) {
      note(`money:${mark}`, { kind: "growth", text: `Savings passed $${mark}.`, because: why((r) => r.d.money) });
    }
  }
}

function firstText(event, state) {
  if (event.npc && event.action === "talk") return `First real talk with ${nameOf(state, event.npc)}.`;
  if (event.npc && event.action === "hangout") return `First time grabbing food with ${nameOf(state, event.npc)}.`;
  if (event.setsOccupation) return `${pastTense(event.title)}.`.replace(/^./, (c) => c.toUpperCase());
  return `First time: ${pastTense(event.title)}.`;
}

// Burnout, energy and hunger milestones that happen as time passes.
function noticeHourly(before, next) {
  const burnoutWhy = () => topContributors(next, (r) => r.d.burnout);
  const was = before.sam.burnout ?? 0;
  const now = next.sam.burnout ?? 0;
  const day = next.time.day;
  if (was < BURNOUT_LIMIT && now >= BURNOUT_LIMIT) {
    remember(next, `burnt:${day}`, { kind: "warning", text: `Hit burnout (${now}).`, because: burnoutWhy() });
  } else if (was < STRAIN_LIMIT && now >= STRAIN_LIMIT) {
    remember(next, `strain:${day}`, { kind: "warning", text: `Started burning out (${now}).`, because: burnoutWhy() });
  } else if (was >= STRAIN_LIMIT && now < STRAIN_LIMIT) {
    remember(next, `recover:${day}`, { kind: "growth", text: "Burnout eased back below 50.", because: topContributors(next, (r) => r.d.burnout, -1) });
  }
  if (before.sam.energy > 0 && next.sam.energy === 0) {
    remember(next, `empty:${day}`, { kind: "warning", text: "Ran out of energy.", because: topContributors(next, (r) => r.d.energy, -1) });
  }
  if (before.sam.hunger >= 15 && next.sam.hunger < 15) {
    remember(next, `hungry:${day}`, { kind: "warning", text: "Went too long without food.", because: [] });
  }
}

// "Go to class" -> "went to class", "Talk to Mo" -> "talked to Mo", "Coding Club meetup" -> "went to Coding Club meetup".
export function pastTense(title) {
  const rules = [
    [/^Go to /, "went to "],
    [/^Do /, "did "],
    [/^Grab /, "grabbed "],
    [/^Take /, "took "],
    [/^Work on /, "worked on "],
    [/^Find /, "found "],
    [/^Apply for /, "applied for "],
    [/^Quit your /, "quit your "],
    [/^Talk to /, "talked to "],
    [/^Tell (\w+) you are busy$/, "brushed off $1"],
    [/^Doomscroll$/, "doomscrolled"],
    [/^Ignored /, "ignored "],
  ];
  for (const [pattern, replacement] of rules) if (pattern.test(title)) return title.replace(pattern, replacement);
  return `went to ${title}`;
}

export function newGame() {
  const state = startingState();
  state.sam.name = shuffled(PLAYER_NAMES)[0];
  state.names = randomCast(state.sam.name);
  state.inspires = randomInspires();
  for (const id of Object.keys(SKILLS)) state.sam.skills[id] = randomInt(3, 16);
  const starter = shuffled(STARTER_INTERESTS)[0];
  state.sam.interests = { [starter]: randomInt(6, 14) };
  for (const id of Object.keys(state.moods)) state.moods[id] = randomInt(48, 72);
  // Where everything started, for the recap.
  state.start = {
    skills: { ...state.sam.skills },
    interests: { ...state.sam.interests },
    moods: Object.fromEntries(Object.keys(NPCS).map((id) => [id, moodOf(state, id)])),
  };
  state.history = [snapshot(state)];
  return state;
}

export const HISTORY_FIELDS = ["t", "health", "hunger", "happiness", "money", "energy", "burnout"];

function snapshot(state) {
  const sam = state.sam;
  return [state.time.day * 24 + state.time.hour, sam.health, sam.hunger, sam.happiness, sam.money, sam.energy, sam.burnout ?? 0];
}

// Mood of anyone on the roster: happiness for the three agents, the moods table for classmates.
export function moodOf(state, npcId) {
  const statId = STAT_IDS[npcId];
  return statId ? state[statId].happiness : state.moods?.[npcId] ?? STARTING_MOOD;
}

function changeMood(state, npcId, delta) {
  const statId = STAT_IDS[npcId];
  if (statId) state[statId].happiness = clampHundred(state[statId].happiness + delta);
  else state.moods = { ...(state.moods ?? {}), [npcId]: clampHundred((state.moods?.[npcId] ?? STARTING_MOOD) + delta) };
}

// Two people on the map stopped to chat: both feel a little better.
export function applyChat(state, aId, bId) {
  if (!NPCS[aId] || !NPCS[bId] || aId === bId) throw new Error("Unknown people.");
  const next = structuredClone(state);
  changeMood(next, aId, CHAT_MOOD);
  changeMood(next, bId, CHAT_MOOD);
  return next;
}

export async function saveState(state) {
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

// Choices tied to Sam's interests: they stay normal (and help more) when Sam is strained.
export function isInterestChoice(event) {
  return Boolean(event.interests || event.hobbyBoost);
}

// How many in-game hours a choice takes. The clock moves forward that much after the choice,
// so hunger, the energy drain and burnout keep ticking. Talking to people and sleeping are special.
export function hoursFor(event, state) {
  if (event.sleep) return 0;
  if (event.workShift) return (OCCUPATIONS[state.sam.occupation] ?? {}).hours ?? 0;
  return event.hours ?? 0;
}

export function energyCostFor(event, state) {
  const job = OCCUPATIONS[state.sam.occupation] ?? OCCUPATIONS.student;
  let cost = event.workShift ? job.energy ?? 0 : event.energyCost;
  if (cost > 0 && (state.sam.burnout ?? 0) >= STRAIN_LIMIT && !isInterestChoice(event) && !event.npc) cost += 1;
  return cost;
}

// Why Sam can't pick this choice right now (job or skill requirements), or null.
export function blockedReason(event, state) {
  if (event.once && (state.log ?? []).some(([, id]) => EVENTS[id] === event)) return "Already done this month.";
  const needs = event.requires;
  if (!needs) return null;
  if (needs.occupations && !needs.occupations.includes(state.sam.occupation ?? "student")) {
    return withPlayer(event.workShift ? "Sam needs a job first." : "That does not fit Sam's current job.", state);
  }
  if (needs.interest) {
    const [interest, min] = Object.entries(needs.interest)[0];
    if ((state.sam.interests?.[interest] ?? 0) < min) return `Unlocks when ${INTERESTS[interest]} reaches ${min}.`;
  }
  if (needs.anySkill) {
    const ok = Object.entries(needs.anySkill).some(([skill, min]) => (state.sam.skills?.[skill] ?? 0) >= min);
    if (!ok) {
      const list = Object.entries(needs.anySkill).map(([skill, min]) => `${SKILLS[skill].toLowerCase()} ${min}`).join(" or ");
      return event.setsOccupation ? `Not hired yet: needs ${list}.` : `Needs ${list}.`;
    }
  }
  return null;
}

export function applyEvent(state, eventId) {
  const event = EVENTS[eventId];
  if (event === undefined) {
    throw new Error("Unknown event.");
  }
  if (state.over) {
    throw new Error("It is November 1. The game is over.");
  }
  if (!isAvailable(event, state.time.day)) {
    throw new Error(`${event.title} is not on today.`);
  }
  const weather = WEATHER[state.weather] ?? WEATHER.sunny;
  if (event.outdoor && weather.outdoor.cancelled) {
    throw new Error(`${event.title} is cancelled because of the ${weather.label.toLowerCase()}.`);
  }
  if (event.when !== undefined && (state.doneToday ?? []).includes(eventId)) {
    throw new Error(`${playerName(state)} already did ${personalize(event.title, state)} today.`);
  }
  const blocked = blockedReason(event, state);
  if (blocked) throw new Error(blocked);
  const energyCost = energyCostFor(event, state);
  if (state.sam.energy < energyCost) {
    throw new Error(`${playerName(state)} has ${state.sam.energy} energy. This choice costs ${energyCost}.`);
  }
  if (state.sam.money < event.moneyCost) {
    throw new Error(`${playerName(state)} has $${state.sam.money}. This choice costs $${event.moneyCost}.`);
  }
  const next = structuredClone(state);
  if (event.when !== undefined) next.doneToday = [...(next.doneToday ?? []), eventId];
  next.sam.energy = Math.min(
    next.sam.energyMax,
    next.sam.energy - energyCost + event.energyGain,
  );
  for (const [id, delta] of Object.entries(event.happiness)) {
    next[id].happiness = clampHundred(next[id].happiness + delta);
  }
  for (const [id, delta] of Object.entries(event.health)) {
    next[id].health = clampHundred(next[id].health + delta);
  }
  for (const [id, delta] of Object.entries(event.hunger ?? {})) {
    next[id].hunger = clampHundred(next[id].hunger + delta);
  }
  for (const [id, delta] of Object.entries(event.money)) {
    next[id].money = Math.max(0, next[id].money + delta);
  }
  for (const [skill, delta] of Object.entries(event.skills ?? {})) {
    next.sam.skills[skill] = clampHundred((next.sam.skills[skill] ?? 0) + delta);
  }
  // Weather and burnout effects on Sam.
  const restful = event.sleep || eventId === "nap";
  const brushOff = event.action === "ignore" || event.action === "busy";
  let extraHappiness = restful || brushOff ? 0 : weather.mood;
  let extraHealth = 0;
  let extraBurnout = 0;
  if (event.outdoor) {
    extraHappiness += weather.outdoor.happiness ?? 0;
    extraHealth += weather.outdoor.health ?? 0;
    extraBurnout += weather.outdoor.burnout ?? 0;
  }
  if (state.sam.burnout >= BURNOUT_LIMIT && !restful) {
    extraHappiness -= 2;
    extraHealth -= 1;
  }
  let extraBurnoutFromStrain = 0;
  if ((state.sam.burnout ?? 0) >= STRAIN_LIMIT && !restful) {
    if (isInterestChoice(event)) extraBurnoutFromStrain = -3;
    else if (energyCost > 0 && !event.npc) extraHappiness -= 1;
  }
  if (event.workShift) {
    const job = OCCUPATIONS[state.sam.occupation] ?? OCCUPATIONS.student;
    next.sam.money = Math.max(0, next.sam.money + (job.pay ?? 0));
    extraHappiness += job.happiness ?? 0;
    extraHealth += job.health ?? 0;
    extraBurnoutFromStrain += job.burnout ?? 0;
  }
  if (event.setsOccupation) next.sam.occupation = event.setsOccupation;
  if (event.npc) {
    const record = { talk: 0, busy: 0, ignore: 0, hangout: 0, ...(state.relations?.[event.npc] ?? {}) };
    if (event.action === "talk" || event.action === "hangout") extraHappiness -= Math.min(record.ignore, GRUDGE_MAX);
    record[event.action] += 1;
    next.relations = { ...(state.relations ?? {}), [event.npc]: record };
    if (!(event.npc in STAT_IDS)) changeMood(next, event.npc, CLASSMATE_MOOD[event.action] ?? 0);
  }
  next.sam.happiness = clampHundred(next.sam.happiness + extraHappiness);
  next.sam.health = clampHundred(next.sam.health + extraHealth);
  next.sam.burnout = clampHundred((next.sam.burnout ?? STARTING_BURNOUT) + (event.burnout ?? 0) + extraBurnout + extraBurnoutFromStrain);
  next.sam.interests = { ...next.sam.interests };
  for (const [interest, delta] of Object.entries(event.interests ?? {})) {
    next.sam.interests[interest] = clampHundred((next.sam.interests[interest] ?? 0) + delta);
  }
  if (event.hobbyBoost) {
    const strongest = Object.entries(next.sam.interests).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "personalHobby";
    next.sam.interests[strongest] = clampHundred((next.sam.interests[strongest] ?? 0) + event.hobbyBoost);
  }
  // Talking with someone can inspire Sam: it deepens an interest they share, or sparks a new one.
  next.lastInspiration = null;
  if (event.npc && (event.action === "talk" || event.action === "hangout")) {
    const options = state.inspires?.[event.npc] ?? NPCS[event.npc].inspires ?? [];
    const shared = options.filter((id) => (next.sam.interests?.[id] ?? 0) > 0).sort((a, b) => next.sam.interests[b] - next.sam.interests[a]);
    const interest = shared[0] ?? options[Math.floor(Math.random() * options.length)];
    if (interest) {
      const amount = shared.length > 0 ? INSPIRE_SHARED : INSPIRE_NEW;
      next.sam.interests = { ...next.sam.interests, [interest]: clampHundred((next.sam.interests?.[interest] ?? 0) + amount) };
      next.lastInspiration = { npc: event.npc, interest, amount, isNew: shared.length === 0, at: (state.log ?? []).length + 1 };
    }
  }
  const hours = hoursFor(event, state);
  recordChoice(state, next, eventId, event.sleep ? 0 : hours);
  if (event.sleep) return sleepUntilMorning(next);
  let after = next;
  for (let hour = 0; hour < hours && !after.over; hour += 1) after = advanceHour(after);
  return after;
}

// Sleep skips to the next 7 AM (later the same night if it is already past midnight),
// lets hunger drop for each hour slept, and refills Sam's energy.
export function sleepUntilMorning(state) {
  const wake = CALENDAR.startHour;
  let next = state;
  do {
    next = advanceHour(next, true);
  } while (!next.over && next.time.hour !== wake);
  next = structuredClone(next);
  next.sam.energy = next.sam.energyMax;
  return next;
}

export function formatStats(state) {
  const lines = [
    `${dayName(state.time.day)}, ${dateText(state.time.day)}, ${formatClock(state.time.hour)}.`,
    `Sam health ${state.sam.health}, hunger ${state.sam.hunger}/100 full, happiness ${state.sam.happiness}, money $${state.sam.money}, energy ${state.sam.energy}/${state.sam.energyMax}.`,
    `Sam's occupation: ${(OCCUPATIONS[state.sam.occupation] ?? OCCUPATIONS.student).label} (${(OCCUPATIONS[state.sam.occupation] ?? OCCUPATIONS.student).detail}).`,
    `Sam burnout ${state.sam.burnout ?? 0}/100${(state.sam.burnout ?? 0) >= BURNOUT_LIMIT ? " (burnt out)" : ""}.`,
    `Sam soft skills: ${Object.entries(SKILLS).map(([id, label]) => `${label.toLowerCase()} ${state.sam.skills?.[id] ?? 0}`).join(", ")}.`,
    `People Sam has ignored: ${Object.entries(state.relations ?? {}).filter(([, r]) => r.ignore > 0).map(([id, r]) => `${nameOf(state, id)} ${r.ignore} time${r.ignore === 1 ? "" : "s"}`).join(", ") || "nobody"}.`,
    `Weather: ${(WEATHER[state.weather]?.label ?? "Sunny").toLowerCase()}.`,
    `Sam interests: ${Object.entries(state.sam.interests ?? {}).map(([id, value]) => `${(INTERESTS[id] ?? id).toLowerCase()} ${value}`).join(", ") || "none yet"}.`,
    `Names this game: person1 (the campus coach) is ${nameOf(state, "captain")}, person2 (the social organizer) is ${nameOf(state, "spark")}, person3 (the resident advisor) is ${nameOf(state, "sage")}. Use these names, including for yourself.`,
    `${nameOf(state, "captain")} health ${state.person1.health}, hunger ${state.person1.hunger}/100 full, happiness ${state.person1.happiness}, money $${state.person1.money}.`,
    `${nameOf(state, "spark")} health ${state.person2.health}, hunger ${state.person2.hunger}/100 full, happiness ${state.person2.happiness}, money $${state.person2.money}.`,
    `${nameOf(state, "sage")} health ${state.person3.health}, hunger ${state.person3.hunger}/100 full, happiness ${state.person3.happiness}, money $${state.person3.money}.`,
  ];
  return [`The player's name is ${playerName(state)}.`, ...lines.map((line) => withPlayer(line, state))].join(" ");
}
