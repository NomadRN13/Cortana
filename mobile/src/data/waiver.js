// The event waiver and code of conduct a member accepts with every RSVP — the
// text of docs/event-waiver.md, point for point. It is a DRAFT for counsel.
// When the wording changes there, change it here and bump WAIVER_VERSION to
// match current_waiver_version() in the database: the server records which
// version each member accepted, so the app must show the one it records.
export const WAIVER_VERSION = '2026-11-draft';

export const WAIVER_INTRO = 'By RSVPing to and attending an RSVPlay event, I confirm that:';

export const WAIVER_POINTS = [
  { head: 'I am 18 or older', body: 'and so is anyone playing on my profile as a doubles partner.' },
  { head: 'I am playing at my own risk.', body: 'Racquet and paddle sports involve physical exertion and a risk of injury. I am fit to take part, I will stop if I am not, and I am responsible for my own equipment.' },
  { head: 'The venue’s rules apply.', body: 'Courts, hours, fees and facilities belong to the venue. RSVPlay organises the meetup; it does not own or supervise the courts unless the event says so.' },
  { head: 'I will follow the code of conduct:', body: 'be on time, play the level I said I play, rotate when the format rotates, call lines honestly, and treat every player, host and venue staff member with respect. Harassment, threats, or unwanted contact get a player removed on the spot and reported to the desk.' },
  { head: 'Photos.', body: 'Events may be photographed for RSVPlay’s own channels. I can tell the host I do not want to be photographed and they will respect it.' },
  { head: 'Hosts can remove a player', body: 'from an event for breaking these rules, and RSVPlay can suspend or ban an account.' },
  { head: 'Meeting people is my choice.', body: 'RSVPlay does not run criminal background checks or verify identity beyond a phone number. I will meet in public places and use the in-app block and report tools if anything feels wrong.' },
];
