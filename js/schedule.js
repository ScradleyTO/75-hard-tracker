// Weekly workout template, keyed by JS Date.getDay() (0 = Sunday ... 6 = Saturday).
// Repeats forever, independent of which challenge day / attempt you're on.
const WEEKLY_SCHEDULE = {
  0: { label: "Sun", session1: "Gym 07:00", session2: "Walk 12:00" },
  1: { label: "Mon", session1: "Walk 06:30", session2: "Gym 16:00" },
  2: { label: "Tue", session1: "Walk 06:30", session2: "Taekwondo (TKD) 17:00" },
  3: { label: "Wed", session1: "Walk 06:30", session2: "TKD 19:00" },
  4: { label: "Thu", session1: "Walk 06:30", session2: "TKD 19:00" },
  5: { label: "Fri", session1: "Gym 07:00", session2: "Walk 12:00" },
  6: { label: "Sat", session1: "Gym 07:00", session2: "Walk 12:00" },
};

function scheduleForDate(date) {
  return WEEKLY_SCHEDULE[date.getDay()];
}

function scheduleForOffset(daysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return { date: d, ...scheduleForDate(d) };
}
