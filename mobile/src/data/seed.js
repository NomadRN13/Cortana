// Demo data for the pre-backend build. Every shape here matches a table in
// docs/system-architecture.md §3, so swapping in Supabase queries is a
// drop-in change behind src/state.js — screens never touch this directly.

export const PROFILES = [
  { id: 'maya', name: 'Maya', age: 31, dist: 1.2, sports: ['Tennis'], skill: 'Advanced', rating: '4.0', isNew: true, verified: true, avail: 'Weekday evenings · Sat mornings', bio: 'Litigator by day, baseline grinder by night. Looking for someone who can keep a rally going — in conversation too.' },
  { id: 'diego', name: 'Diego', age: 38, dist: 2.8, sports: ['Padel', 'Pickleball'], skill: 'Intermediate', rating: '', isNew: true, verified: false, avail: 'Weekends', bio: 'Moved here from Madrid two years ago — converting Indy to padel one pickleball game at a time.' },
  { id: 'priya', name: 'Priya', age: 29, dist: 0.8, sports: ['Tennis', 'Pickleball'], skill: 'Intermediate', rating: '3.5', isNew: true, verified: true, avail: 'Sun + Wed evenings', bio: 'Product designer who treats every third ball like a drop-shot opportunity. Winner picks the coffee spot after.' },
  { id: 'sam', name: 'Sam', age: 45, dist: 3.1, sports: ['Pickleball'], skill: 'Competitive', rating: '4.2', isNew: false, verified: true, avail: 'Early mornings, most days', bio: 'Recovering marathoner, fully converted to the kitchen line. I play hard and brunch harder.' },
  { id: 'elena', name: 'Elena', age: 52, dist: 1.9, sports: ['Pickleball'], skill: 'Intermediate', rating: '3.4', isNew: false, verified: true, avail: 'Weekday mornings', bio: 'Retired teacher, new to the city, and pickleball has been the best welcome committee.' },
  { id: 'marcus', name: 'Marcus', age: 34, dist: 4.5, sports: ['Squash'], skill: 'Advanced', rating: '', isNew: false, verified: false, avail: 'Tue + Thu after 6', bio: 'Architect who thinks best inside four glass walls. If you can hold a T, you already have my attention.' },
  { id: 'jordan', name: 'Jordan', age: 30, dist: 3.0, sports: ['Tennis', 'Pickleball'], skill: 'Advanced', rating: '4.0', isNew: true, verified: true, avail: 'Flexible — I make time', bio: 'Coach says my forehand is a weapon; my dog says I need to get out more. They can both be right.' },
  { id: 'grace', name: 'Grace', age: 41, dist: 5.2, sports: ['Tennis', 'Padel'], skill: 'Advanced', rating: '4.5', isNew: false, verified: true, avail: 'Sat + Sun mornings', bio: 'ER nurse with a wicked slice. Weekends are sacred court time — see if you can break serve.' },
  { id: 'theo', name: 'Theo', age: 58, dist: 2.2, sports: ['Racquetball'], skill: 'Intermediate', rating: '', isNew: false, verified: false, avail: 'Mon/Wed/Fri lunch', bio: 'Thirty years of racquetball and still learning new angles. Grandkids say I’m cool; verify in person.' },
  { id: 'nadia', name: 'Nadia', age: 33, dist: 6.7, sports: ['Pickleball'], skill: 'Beginner', rating: '', isNew: false, verified: true, avail: 'Weekend afternoons', bio: 'Food scientist who joined a pickleball league on a dare and stayed for the people. Post-game taco recs are my specialty.' },
  { id: 'chris', name: 'Chris', age: 48, dist: 3.8, sports: ['Pickleball', 'Tennis'], skill: 'Advanced', rating: '4.0', isNew: false, verified: true, avail: 'Evenings after 7', bio: 'Two kids, one dog, zero interest in small talk at bars. Ten minutes of doubles tells you more than any bio could.' },
  { id: 'lena', name: 'Lena', age: 25, dist: 9.8, sports: ['Squash', 'Tennis'], skill: 'Competitive', rating: '', isNew: false, verified: false, avail: 'Weekday evenings', bio: 'Grad student and former junior squash champ. Fair warning: I call every let.' },
];

export const EVENTS = [
  { id: 'e1', week: 'This week', dow: 'Fri', dom: '7', title: 'Sunset Doubles Social', venue: 'Riverside Park Tennis Complex', time: '6:00 PM', sport: 'Tennis', level: 'All levels', spots: 6 },
  { id: 'e2', week: 'This week', dow: 'Sat', dom: '8', title: 'Beginner Pickleball Mixer', venue: 'Broad Ripple Park', time: '10:00 AM', sport: 'Pickleball', level: 'Beginner–Int.', spots: 12 },
  { id: 'e3', week: 'This week', dow: 'Sun', dom: '9', title: '40/Love Round Robin', venue: 'Tarkington Park', time: '2:00 PM', sport: 'Tennis', level: 'NTRP 3.0–4.0', spots: 3 },
  { id: 'e4', week: 'Next week', dow: 'Wed', dom: '12', title: 'Pickleball Under the Lights', venue: 'Ellenberger Park', time: '7:30 PM', sport: 'Pickleball', level: 'All levels', spots: 8 },
  { id: 'e5', week: 'Next week', dow: 'Sat', dom: '15', title: 'Cardio Tennis + Coffee', venue: 'Tarkington Park', time: '9:00 AM', sport: 'Tennis', level: 'Int. and up', spots: 10 },
  { id: 'e6', week: 'Next week', dow: 'Sun', dom: '16', title: 'Ladder League Kickoff', venue: 'Indy Pickleball Club', time: '1:00 PM', sport: 'Pickleball', level: 'DUPR 3.0+', spots: 5 },
];

export const THREADS = [
  {
    id: 'maya',
    unread: true,
    yourServe: true,
    msgs: [
      { who: 'them', text: 'Okay your backhand slice is genuinely rude 😄', when: 'Yesterday 8:42 PM' },
      { who: 'me', text: 'Years of being too lazy to hit topspin finally paying off', when: 'Yesterday 8:50 PM' },
      { who: 'them', text: 'Rematch this weekend? Loser buys smoothies', when: 'Yesterday 9:03 PM' },
    ],
  },
  {
    id: 'sam',
    unread: false,
    yourServe: false,
    msgs: [
      { who: 'them', text: 'Great meeting you at the mixer! You held that kitchen line like a pro', when: 'Tue 7:15 PM' },
      { who: 'me', text: 'Ha, I was terrified the whole time. Let’s play again soon?', when: 'Tue 7:31 PM' },
      { who: 'them', kind: 'court', court: 'Broad Ripple Park', day: 'Sat', time: '9:00 AM', sport: 'Pickleball', when: 'Tue 7:40 PM' },
      { who: 'me', text: 'Booked it. Bringing my A-game and electrolytes', when: 'Tue 8:02 PM' },
    ],
  },
  {
    id: 'priya',
    unread: false,
    yourServe: true,
    msgs: [
      { who: 'them', text: 'So verdict on the new courts at Riverside?', when: 'Mon 6:20 PM' },
      { who: 'them', text: 'Also I found a coffee place two blocks away. Strategic post-match option 👀', when: 'Mon 6:21 PM' },
    ],
  },
];

export const CANNED_REPLIES = {
  maya: 'Deal. Saturday, 10am, bring your rude slice 😤',
  sam: 'That’s what I like to hear. See you at the kitchen line!',
  priya: 'Right?? Okay — Riverside Thursday, coffee verdict after 🎾',
};

export const NOTIFICATIONS = [
  { ico: 'heart', txt: 'It’s a Match Point! You and Maya matched.', sub: 'Yesterday 9:05 PM' },
  { ico: 'tennisball', txt: 'Your serve — Priya sent you two messages.', sub: 'Mon 6:21 PM' },
  { ico: 'calendar', txt: 'Sunset Doubles Social is this Friday at 6:00 PM — 6 spots left.', sub: 'Mon 9:00 AM' },
];

export const COURTS = ['Riverside Park Tennis Complex', 'Tarkington Park', 'Broad Ripple Park'];
export const SPORTS = ['Tennis', 'Pickleball', 'Padel', 'Racquetball', 'Squash'];
export const SKILLS = ['Beginner', 'Intermediate', 'Advanced', 'Competitive'];
