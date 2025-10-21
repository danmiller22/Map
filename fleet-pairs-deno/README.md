# Fleet Pairs Map (Deno Deploy)

Minimal, free stack. Deno Deploy + Deno KV + MapLibre + OSM.

## Deploy quickstart
1) Create a GitHub repo and push these files.
2) Deno Deploy: New Project → Connect repo.
3) Set environment variables in Deno Deploy:
   - `SAMSARA_TOKEN` (Bearer token)
   - `SKYBITZ_USERNAME`
   - `SKYBITZ_PASSWORD`
   - `YARD_LAT` (e.g., 41.43063)
   - `YARD_LON` (e.g., -88.19651)
   - `YARD_RADIUS_MI` (e.g., 0.5)
4) In Deno Deploy, add a Cron Trigger: every 10 minutes.
5) Open the site. Left panel lists pairs. Map shows trucks (triangles) and trailers (squares).

## Notes
- All trailers are paired to the nearest truck. Exception: trailers inside the yard geofence are allowed to be solo.
- If no trucks exist yet, trailers outside the yard are flagged as `no_truck` in the API until the next cycle.
- API endpoints: `/api/pairs`, `/api/health`.
