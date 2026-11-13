-- RSVPlay — open Bakersfield, CA
--
-- City #12. Bakersfield sits about 110 miles north of Los Angeles, so its
-- 30-mile metro does not touch LA's 60: a member in either is placed in their
-- own city, never the other's. sort_order 35 lists it with the other
-- California cities, after San Diego (30) and before Phoenix (40).
--
-- The same entry is mirrored in mobile/src/data/cities.js and the city lists in
-- app/index.html, admin/index.html and landing/index.html.

insert into public.cities (slug, name, state, lat, lng, metro_radius_mi, launched, sort_order)
values ('bakersfield', 'Bakersfield', 'CA', 35.373, -119.019, 30, true, 35)
on conflict (slug) do nothing;
