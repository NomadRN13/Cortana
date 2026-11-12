// Birthdate entry, shared by signup and the add-a-partner form in Settings.

// "MM/DD/YYYY" → "YYYY-MM-DD", or null if not a real calendar date
export function parseBirthdate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(mm) || d.getUTCDate() !== Number(dd)) return null;
  return iso;
}

// Puts the slashes in as the digits are typed: "03151990" → "03/15/1990".
// The field uses the number pad, which has no "/" key on an iPhone — without
// this there is no way to type a date the parser above accepts.
//
// A slash only appears once there is a digit to follow it. Adding it eagerly
// ("03" → "03/") makes backspace a trap: delete the slash, the formatter puts
// it straight back, and the field can never be cleared.
export function formatBirthdateInput(text) {
  // Someone typing or pasting their own slashes ("3/5/1990") means a one-digit
  // month or day that they have already closed off: pad it ("03", "05") before
  // the digits are run together, or "3/5/1990" would be re-cut as "35/19/90".
  const parts = String(text || '').split('/');
  const d = parts
    .map((part, i) => {
      const digits = part.replace(/\D/g, '');
      const closed = i < parts.length - 1;          // a slash follows this segment
      return closed && i < 2 && digits.length === 1 ? `0${digits}` : digits;
    })
    .join('')
    .slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// "YYYY-MM-DD" → "MM/DD/YYYY", for putting a saved date back in the field.
export function birthdateToText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}
